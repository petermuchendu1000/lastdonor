import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { db } from '@/db';
import { siteSettings, auditLogs } from '@/db/schema';
import { like } from 'drizzle-orm';
import { encryptSecret, verifySecurityToken } from '@/lib/crypto.server';
import { resolveEnvVar, type ManagedEnvKey } from '@/lib/settings.server';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import { getClientIp } from '@/lib/rate-limit';

/**
 * Canonical list of environment keys that can be managed through the admin UI.
 * Each key maps to a display label and the env var it overrides at runtime.
 */
const ENV_KEYS = {
  STRIPE_SECRET_KEY: { label: 'Stripe Secret Key', envVar: 'STRIPE_SECRET_KEY' },
  STRIPE_WEBHOOK_SECRET: { label: 'Stripe Webhook Secret', envVar: 'STRIPE_WEBHOOK_SECRET' },
  RESEND_API_KEY: { label: 'Resend API Key', envVar: 'RESEND_API_KEY' },
  OPENROUTER_API_KEY: { label: 'OpenRouter API Key', envVar: 'OPENROUTER_API_KEY' },
  SENTRY_DSN: { label: 'Sentry DSN', envVar: 'SENTRY_DSN' },
  // DATABASE_URL intentionally excluded: infrastructure secret, not admin-changeable
} as const;

type EnvKeyName = keyof typeof ENV_KEYS;

const VALID_KEYS = new Set(Object.keys(ENV_KEYS));

/** DB key prefix for encrypted env secrets. */
function dbKey(envKey: string): string {
  return `env.${envKey}`;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '••••••••';
  return '••••••••' + value.slice(-4);
}

/** GET: Return the status of each env key (configured via env, overridden via DB, or missing). */
export async function GET() {
  const requestId = randomUUID();

  try {
    await requireRole(['admin']);
  } catch {
    const error: ApiError = {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required', requestId },
    };
    return NextResponse.json(error, { status: 403 });
  }

  // Check which keys have DB overrides (only fetch env.* keys)
  const dbRows = await db
    .select({ key: siteSettings.key, updatedAt: siteSettings.updatedAt })
    .from(siteSettings)
    .where(like(siteSettings.key, 'env.%'));

  const dbOverrides = new Map<string, Date>();
  for (const row of dbRows) {
    if (row.key.startsWith('env.')) {
      dbOverrides.set(row.key.replace('env.', ''), row.updatedAt);
    }
  }

  const status: Record<string, { label: string; source: 'db' | 'env' | 'missing'; maskedValue: string | null; updatedAt: string | null }> = {};

  for (const [key, meta] of Object.entries(ENV_KEYS)) {
    const hasDbOverride = dbOverrides.has(key);
    const hasEnvVar = !!process.env[meta.envVar];

    if (hasDbOverride) {
      // Decrypt to get masked value
      try {
        const resolved = await resolveEnvVar(key as ManagedEnvKey);
        status[key] = {
          label: meta.label,
          source: 'db',
          maskedValue: resolved ? maskSecret(resolved) : null,
          updatedAt: dbOverrides.get(key)!.toISOString(),
        };
      } catch {
        status[key] = {
          label: meta.label,
          source: 'db',
          maskedValue: '(decryption error)',
          updatedAt: dbOverrides.get(key)!.toISOString(),
        };
      }
    } else if (hasEnvVar) {
      status[key] = {
        label: meta.label,
        source: 'env',
        maskedValue: maskSecret(process.env[meta.envVar]!),
        updatedAt: null,
      };
    } else {
      status[key] = {
        label: meta.label,
        source: 'missing',
        maskedValue: null,
        updatedAt: null,
      };
    }
  }

  return NextResponse.json({ ok: true, data: status });
}

/**
 * PATCH: Update one or more environment keys.
 * Requires a valid security token from the verify-security endpoint.
 * Body: { securityToken: string, keys: { STRIPE_SECRET_KEY?: string, ... } }
 */
export async function PATCH(request: NextRequest) {
  const requestId = randomUUID();

  let session;
  try {
    session = await requireRole(['admin']);
  } catch {
    const error: ApiError = {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required', requestId },
    };
    return NextResponse.json(error, { status: 403 });
  }

  let body: { securityToken?: string; keys?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body', requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  // Validate security token
  if (!body.securityToken) {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Security token is required. Verify your security question first.', requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  const tokenUserId = verifySecurityToken(body.securityToken);
  if (!tokenUserId || tokenUserId !== session.user.id) {
    const error: ApiError = {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Security token is invalid or expired. Please verify your security question again.', requestId },
    };
    return NextResponse.json(error, { status: 403 });
  }

  // Validate keys
  if (!body.keys || typeof body.keys !== 'object' || Object.keys(body.keys).length === 0) {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'At least one key must be provided', requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  const invalidKeys = Object.keys(body.keys).filter((k) => !VALID_KEYS.has(k));
  if (invalidKeys.length > 0) {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Unknown environment keys: ${invalidKeys.join(', ')}`, requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  // Validate value lengths (prevent unreasonable payloads)
  for (const [key, value] of Object.entries(body.keys)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      const error: ApiError = {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: `Value for ${key} must be a non-empty string`, requestId },
      };
      return NextResponse.json(error, { status: 400 });
    }
    if (value.length > 4096) {
      const error: ApiError = {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: `Value for ${key} exceeds 4096 character limit`, requestId },
      };
      return NextResponse.json(error, { status: 400 });
    }
  }

  // Encrypt and store each key in a transaction, and audit log each change
  const now = new Date();
  const updatedKeys: string[] = [];
  /*
    ⛔ `getClientIp`, not the raw header - and this is the most sensitive
    write in the product, so the audit row's actor matters most here. The
    LEFT-most `x-forwarded-for` entry is whatever the caller typed, and
    `docs/105` records that `lastdonor.fly.dev` reaches the origin directly,
    so that prefix is attacker-chosen. `getClientIp` takes the hop our own
    infrastructure appended instead. `docs/138`.
  */
  const actorIp = getClientIp(request.headers);

  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(body.keys!)) {
      if (!VALID_KEYS.has(key)) continue;
      if (typeof value !== 'string' || value.trim().length === 0) continue;

      const encrypted = encryptSecret(value.trim());

      await tx
        .insert(siteSettings)
        .values({
          key: dbKey(key),
          value: encrypted as unknown as Record<string, unknown>,
          updatedAt: now,
          updatedBy: session.user.id,
        })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: {
            value: encrypted as unknown as Record<string, unknown>,
            updatedAt: now,
            updatedBy: session.user.id,
          },
        });

      await tx.insert(auditLogs).values({
        eventType: 'env_key.updated',
        actorId: session.user.id,
        actorRole: 'admin',
        actorIp: actorIp,
        targetType: 'env_key',
        severity: 'warning',
        details: {
          key,
          label: ENV_KEYS[key as EnvKeyName].label,
          maskedValue: maskSecret(value.trim()),
        },
      });

      updatedKeys.push(key);
    }
  });

  return NextResponse.json({
    ok: true,
    /*
      ⛔ "Saved", not "Updated". Nothing reads an `env.*` row except the GET
      that draws the settings screen, so the running app is unchanged by this
      write - see the note on `EnvItemInteractive`. `docs/138`.
    */
    data: {
      updatedKeys,
      message:
        `Saved ${updatedKeys.length} environment key(s). The running app still uses ` +
        'the values it was deployed with; set them on the host and redeploy to change that.',
    },
  });
}
