import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { db } from '@/db';
import { users, donations, campaigns, auditLogs } from '@/db/schema';
import { eq, desc, and, sql, count, gte } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { updateDonorProfileSchema } from '@/lib/validators/donor';
import { refreshDonorScore } from '@/lib/donor-scoring.server';
import type { ApiError } from '@/types/api';
import type { UserRole } from '@/types';
import { notifyRoleChange, notifyAccountDeletion } from '@/lib/notifications';
import { anonymiseAccount } from '@/lib/account-erasure';
import { logError } from '@/lib/errors';

type RouteContext = { params: Promise<{ id: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ROLES: UserRole[] = ['donor', 'editor', 'admin'];

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  const { id } = await context.params;

  try {
    await requireRole(['admin']);
  } catch {
    const error: ApiError = {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required', requestId },
    };
    return NextResponse.json(error, { status: 403 });
  }

  if (!UUID_REGEX.test(id)) {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID format', requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  try {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      phone: users.phone,
      donorType: users.donorType,
      organizationName: users.organizationName,
      address: users.address,
      location: users.location,
      avatarUrl: users.avatarUrl,
      totalDonated: users.totalDonated,
      campaignsSupported: users.campaignsSupported,
      lastDonorCount: users.lastDonorCount,
      lastDonationAt: users.lastDonationAt,
      donorScore: users.donorScore,
      badges: users.badges,
      preferences: users.preferences,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    const error: ApiError = {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'User not found', requestId },
    };
    return NextResponse.json(error, { status: 404 });
  }

  // Fetch recent donations
  const recentDonations = await db
    .select({
      id: donations.id,
      amount: donations.amount,
      donorName: donations.donorName,
      isAnonymous: donations.isAnonymous,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      phaseAtTime: donations.phaseAtTime,
      source: donations.source,
      createdAt: donations.createdAt,
    })
    .from(donations)
    .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
    .where(eq(donations.userId, id))
    .orderBy(desc(donations.createdAt))
    .limit(20);

  // Fetch recent audit entries for this user
  const recentAuditEntries = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.actorId, id))
    .orderBy(desc(auditLogs.timestamp))
    .limit(10);

  // Donation stats for CRM context
  const [donationStats] = await db
    .select({ total: count() })
    .from(donations)
    .where(eq(donations.userId, id));

  const [recurringStats] = await db
    .select({ total: count() })
    .from(donations)
    .where(
      and(
        eq(donations.userId, id),
        eq(donations.isRecurring, true),
        gte(donations.createdAt, new Date(Date.now() - 365 * 86400000)),
      ),
    );

  return NextResponse.json({
    ok: true,
    data: {
      user,
      recentDonations,
      recentAuditEntries,
      donationCount: donationStats.total,
      hasRecurring: recurringStats.total > 0,
    },
  });
  } catch (err) {
    logError(err, 'admin-user-get', { requestId, userId: id });
    const error: ApiError = {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to load user details', requestId },
    };
    return NextResponse.json(error, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  const { id } = await context.params;

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

  if (!UUID_REGEX.test(id)) {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID format', requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  let body: { role?: string };
  try {
    body = await request.json();
  } catch {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body', requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  // Only role changes supported via this endpoint
  if (!body.role || !VALID_ROLES.includes(body.role as UserRole)) {
    const error: ApiError = {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Role must be one of: ${VALID_ROLES.join(', ')}`,
        field: 'role',
        requestId,
      },
    };
    return NextResponse.json(error, { status: 400 });
  }

  const newRole = body.role as UserRole;

  // Prevent admin from demoting themselves
  if (id === session.user?.id && newRole !== 'admin') {
    const error: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Cannot change your own role', requestId },
    };
    return NextResponse.json(error, { status: 400 });
  }

  try {
  // Verify user exists and get current role for audit
  const [existing] = await db
    .select({ id: users.id, role: users.role, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!existing) {
    const error: ApiError = {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'User not found', requestId },
    };
    return NextResponse.json(error, { status: 404 });
  }

  if (existing.role === newRole) {
    return NextResponse.json({ ok: true, data: { id, role: newRole } });
  }

  // Update role
  await db
    .update(users)
    .set({ role: newRole })
    .where(eq(users.id, id));

  // Audit log
  await db.insert(auditLogs).values({
    eventType: 'user.role_changed',
    actorId: session.user?.id ?? null,
    actorRole: session.user?.role as UserRole,
    targetType: 'user',
    targetId: id,
    severity: 'warning',
    details: {
      previousRole: existing.role,
      newRole,
      userEmail: existing.email,
    },
  });

  // Notify the user about their role change (fire-and-forget)
  notifyRoleChange({
    userId: id,
    userEmail: existing.email,
    userName: existing.name ?? '',
    previousRole: existing.role,
    newRole,
  }).catch((err) => console.error('[admin/users] role change notification error:', err));

  return NextResponse.json({
    ok: true,
    data: { id, role: newRole },
  });
  } catch (err) {
    logError(err, 'admin-user-role-change', { requestId, userId: id });
    const error: ApiError = {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update user role', requestId },
    };
    return NextResponse.json(error, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  const { id } = await context.params;

  let session;
  try {
    session = await requireRole(['admin']);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError,
      { status: 403 },
    );
  }

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID format', requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body', requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  const parsed = updateDonorProfileSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: issue.message, field: issue.path.join('.'), requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  try {
  const [existing] = await db
    .select({ id: users.id, preferences: users.preferences })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: 'User not found', requestId } } satisfies ApiError,
      { status: 404 },
    );
  }

  const updates: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};

  if (parsed.data.phone !== undefined) {
    updates.phone = parsed.data.phone;
    changes.phone = parsed.data.phone;
  }
  if (parsed.data.donorType !== undefined) {
    updates.donorType = parsed.data.donorType;
    changes.donorType = parsed.data.donorType;
  }
  if (parsed.data.organizationName !== undefined) {
    updates.organizationName = parsed.data.organizationName;
    changes.organizationName = parsed.data.organizationName;
  }
  if (parsed.data.address !== undefined) {
    updates.address = parsed.data.address;
    changes.address = parsed.data.address;
  }
  if (parsed.data.tags !== undefined) {
    const currentPrefs = (existing.preferences ?? {}) as Record<string, unknown>;
    updates.preferences = { ...currentPrefs, tags: parsed.data.tags };
    changes.tags = parsed.data.tags;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, data: { id, updated: false } });
  }

  await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id));

  // Recalculate donor score after profile changes
  const newScore = await refreshDonorScore(id);

  await db.insert(auditLogs).values({
    eventType: 'donor.profile_updated',
    actorId: session.user?.id ?? null,
    actorRole: session.user?.role as UserRole,
    targetType: 'user',
    targetId: id,
    severity: 'info',
    details: changes,
  });

  return NextResponse.json({ ok: true, data: { id, donorScore: newScore, ...changes } });
  } catch (err) {
    logError(err, 'admin-user-profile-update', { requestId, userId: id });
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update user profile', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/admin/users/[id] - Remove a person from the platform.
 *
 * ONE path, and it anonymises: `anonymiseAccount` scrubs the identifying
 * columns and the `users` row survives carrying an opaque id. Nothing is
 * hard-deleted. `docs/124`.
 *
 * ⛔ This docstring used to say "users with donations are anonymized ... users
 * with no donations are hard-deleted", which was the two-branch behaviour
 * `docs/124` replaced - and NEITHER branch had ever worked (the anonymise one
 * wrote `null` into two `NOT NULL` columns; the hard-delete one raised a
 * foreign-key violation for almost anybody). A comment that describes a
 * deleted design is worse than none: it is what a reader reaches for before
 * they read the code.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  const { id } = await context.params;

  let session;
  try {
    session = await requireRole(['admin']);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError,
      { status: 403 },
    );
  }

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID format', requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  // Prevent admin from deleting themselves
  if (id === session.user?.id) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Cannot delete your own account', requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  try {
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: 'User not found', requestId } } satisfies ApiError,
      { status: 404 },
    );
  }

  // Prevent deleting other admins (must demote first)
  if (user.role === 'admin') {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Cannot delete an admin user. Demote to donor or editor first.', requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  /*
    ONE path, and it anonymises. `docs/124`.

    This used to branch on the donation count: anonymise in place when the
    user had donations, hard-delete otherwise. BOTH branches were broken.

    ⛔ The anonymise branch wrote `badges: null, preferences: null`, and both
    columns are `NOT NULL` (`schema.ts:389-390`), so the UPDATE threw and the
    whole transaction rolled back - [VERIFIED against a real Postgres, and
    again through drizzle] the row came back completely unchanged. That branch
    had never once worked.

    ⛔ The hard-delete branch had the same foreign-key hole as the
    self-service route: 31 of the 36 references to `users.id` are `NO ACTION`
    and it cleared two of them, so it raised a violation for almost anybody.

    So neither branch could remove a person, and the donation count was never
    the right discriminator anyway - a user with no donations can still hold a
    share link, an invitation or a verification document.
  */
  const [donationCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(donations)
    .where(eq(donations.userId, id));

  await db.transaction(async (tx) => {
    await anonymiseAccount(tx, { userId: id, email: user.email });

    await tx.insert(auditLogs).values({
      eventType: 'user.anonymized',
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      targetType: 'user',
      targetId: id,
      severity: 'warning',
      details: {
        email: user.email,
        name: user.name,
        role: user.role,
        reason: 'admin_delete',
        donationCount: donationCount.total,
      },
    });
  });

  /*
    ⛔ AFTER the transaction commits, not before it.

    This ran above the transaction under the comment "Mail them BEFORE the
    address is scrubbed, or there is nowhere to send it" - and that premise is
    false: `user` is a local read at the top of this handler, so `user.email`
    survives the scrub by construction. What the ordering actually did was
    tell somebody their account had been removed and THEN try to remove it, so
    any failure inside the transaction left a person holding an email about an
    erasure that had been rolled back.

    Moving it down costs nothing: `sendEmailOnly` catches everything it can
    throw (`notifications.ts:182-195`), so a delivery failure cannot turn a
    completed erasure into a 500. An unsent email is a delivery failure; a sent
    one about work that did not happen is a false statement. `docs/133`.
  */
  await notifyAccountDeletion({ userEmail: user.email, userName: user.name ?? '' });

  return NextResponse.json({
    ok: true,
    data: {
      id,
      action: 'anonymized',
      reason:
        'Personal identifiers removed. The account row is kept so financial and audit records stay intact.',
    },
  });
  } catch (err) {
    logError(err, 'admin-user-delete', { requestId, userId: id });
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete user', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
