import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getAllSettings, updateSettings } from '@/lib/settings.server';
import { SETTING_DEFAULTS, SETTING_META, type SettingsMap, type SettingKey } from '@/lib/settings';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import { logError } from '@/lib/errors';
import { getClientIp } from '@/lib/rate-limit';

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

  try {
  const settings = await getAllSettings();
  return NextResponse.json({ ok: true, data: settings });
  } catch (err) {
    logError(err, 'admin-settings-get', { requestId });
    const error: ApiError = {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to load settings', requestId },
    };
    return NextResponse.json(error, { status: 500 });
  }
}

/** Validate a single setting value against its expected type and constraints. */
function validateSettingValue(key: SettingKey, value: unknown): string | null {
  const meta = SETTING_META[key];

  switch (meta.inputType) {
    case 'number':
    case 'cents': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `${key}: must be a finite number`;
      }
      if (value < 0) {
        return `${key}: must be non-negative`;
      }
      if (meta.inputType === 'cents' && !Number.isInteger(value)) {
        return `${key}: cents values must be integers`;
      }
      // Range checks for specific fields
      if (key === 'campaign.auto_publish_threshold' && (value < 0 || value > 100)) {
        return `${key}: must be between 0 and 100`;
      }
      if (key === 'campaign.max_impact_tiers' && value > 50) {
        return `${key}: exceeds maximum of 50`;
      }
      break;
    }
    case 'text': {
      if (typeof value !== 'string') {
        return `${key}: must be a string`;
      }
      if (value.length > 500) {
        return `${key}: exceeds 500 character limit`;
      }
      if (value.trim().length === 0) {
        return `${key}: cannot be empty`;
      }
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        return `${key}: must be true or false`;
      }
      break;
    }
    case 'json': {
      const defaultVal = SETTING_DEFAULTS[key];
      if (Array.isArray(defaultVal)) {
        if (!Array.isArray(value)) {
          return `${key}: must be an array`;
        }
        if (value.length > 100) {
          return `${key}: array exceeds 100 items`;
        }
        // Numeric arrays (e.g. preset_amounts) must contain only positive numbers
        if (defaultVal.every((v) => typeof v === 'number')) {
          for (const item of value) {
            if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) {
              return `${key}: all items must be non-negative numbers`;
            }
          }
        }
        // String arrays (e.g. allowed_types)
        if (defaultVal.every((v) => typeof v === 'string')) {
          for (const item of value) {
            if (typeof item !== 'string' || item.trim().length === 0) {
              return `${key}: all items must be non-empty strings`;
            }
          }
        }
      } else if (typeof defaultVal === 'object' && defaultVal !== null) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return `${key}: must be an object`;
        }
        // Rate limit objects: must have the expected keys with positive integer values
        const expectedKeys = Object.keys(defaultVal);
        const obj = value as Record<string, unknown>;
        for (const k of expectedKeys) {
          if (!(k in obj)) {
            return `${key}: missing required field "${k}"`;
          }
          if (typeof obj[k] !== 'number' || !Number.isFinite(obj[k] as number) || (obj[k] as number) < 0) {
            return `${key}.${k}: must be a non-negative number`;
          }
        }
      }
      break;
    }
  }
  return null;
}

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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body', requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  // Validate that all keys are known setting keys
  const validKeys = new Set(Object.keys(SETTING_DEFAULTS));
  const invalidKeys = Object.keys(body).filter((k) => !validKeys.has(k));
  if (invalidKeys.length > 0) {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Unknown setting keys: ${invalidKeys.join(', ')}`, requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  if (Object.keys(body).length === 0) {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'No settings provided', requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  /*
    The donation and campaign-goal min<max cross-checks lived here. Both
    pairs of settings were removed because no money path read them
    (`docs/116`); the real bounds are per currency in `CURRENCIES`, and the
    validator that enforces them is `createCampaignSchema`.
  */

  // Validate each value against its type constraints
  const errors: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    const err = validateSettingValue(key as SettingKey, value);
    if (err) errors.push(err);
  }
  if (errors.length > 0) {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: errors.join('; '), requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  try {
  await updateSettings(body as unknown as Partial<SettingsMap>, session.user.id);

  // Audit log the settings change
  await db.insert(auditLogs).values({
    eventType: 'settings.updated',
    actorId: session.user.id,
    actorRole: 'admin',
    /*
      ⛔ `getClientIp`, not the raw header. This read
      `x-forwarded-for ?? x-real-ip` directly, and the LEFT-most XFF entry is
      whatever the caller typed - so the actor IP on an audit row was a value
      the actor chose. `docs/105` built this resolver for exactly that: it
      takes the hop our own infrastructure appended, and never falls back to
      the client-supplied prefix. 8 of the 10 `actorIp` sites in `src/`
      already used it; this route and its `environment` sibling were the two
      that did not. `docs/138`.
    */
    actorIp: getClientIp(request.headers),
    targetType: 'settings',
    severity: 'info',
    details: { keys: Object.keys(body) },
  });

  const updated = await getAllSettings();
  return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    logError(err, 'admin-settings-update', { requestId });
    const error: ApiError = {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to save settings', requestId },
    };
    return NextResponse.json(error, { status: 500 });
  }
}
