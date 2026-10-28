import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import type { Metadata } from 'next';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { institutionVouches, trustedInstitutions, users } from '@/db/schema';
import { TrustedInstitutions } from '@/components/admin/TrustedInstitutions';
import { VOUCH_WINDOW_DAYS } from '@/lib/trust-network/decide';

/*
  NO `revalidate` EXPORT. `src/app/admin/layout.tsx` sets `force-dynamic` for
  the whole subtree, so a page-level directive here could not take effect and
  would read as a promise that does nothing - docs/88 F14 removed sixteen of
  those from this tree.
*/

export const metadata: Metadata = {
  title: 'Trusted Organisations - Admin - LastDonor.org',
  robots: { index: false },
};

/** docs/88 F8: cap the fetch, and take the total from the database. */
const ROW_CAP = 200;

export default async function AdminInstitutionsPage() {
  /*
    ⛔ The sidebar marks this page's group `adminOnly`, and until `docs/132`
    that was the ONLY thing keeping an editor out - which is to say nothing
    kept them out, because hiding a link does not gate a URL.
    `src/app/admin/layout.tsx:30` admits `editor` as well as `admin`.
    [VERIFIED in a browser: an editor was served this page, byte-identical to
    the admin control.] `admin-nav-role.ratchet.test.ts` now derives this
    requirement from the sidebar's own `adminOnly` flag.
  */
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  const windowStart = new Date(Date.now() - VOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  /*
    Two queries, run one after the other. The two per-row counts are
    correlated scalar subqueries rather than extra round trips, which is what
    keeps this page inside the three-concurrent-query budget docs/87 sets -
    the admin layout's `auth()` already takes one of the pool's five.
  */
  const rows = await db
    .select({
      id: trustedInstitutions.id,
      name: trustedInstitutions.name,
      kind: trustedInstitutions.kind,
      country: trustedInstitutions.country,
      website: trustedInstitutions.website,
      registrationId: trustedInstitutions.registrationId,
      registrationVerifiedAt: trustedInstitutions.registrationVerifiedAt,
      status: trustedInstitutions.status,
      verifiedAt: trustedInstitutions.verifiedAt,
      verificationNotes: trustedInstitutions.verificationNotes,
      monthlyVouchLimit: trustedInstitutions.monthlyVouchLimit,
      suspendedAt: trustedInstitutions.suspendedAt,
      suspendedReason: trustedInstitutions.suspendedReason,
      verifiedByEmail: users.email,
      liveVouches: db
        .$count(
          institutionVouches,
          and(
            eq(institutionVouches.institutionId, trustedInstitutions.id),
            isNull(institutionVouches.revokedAt),
          ),
        )
        .as('live_vouches'),
      vouchesInWindow: db
        .$count(
          institutionVouches,
          and(
            eq(institutionVouches.institutionId, trustedInstitutions.id),
            gte(institutionVouches.createdAt, windowStart),
          ),
        )
        .as('vouches_in_window'),
    })
    .from(trustedInstitutions)
    .leftJoin(users, eq(users.id, trustedInstitutions.verifiedBy))
    .orderBy(desc(trustedInstitutions.createdAt))
    .limit(ROW_CAP);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(trustedInstitutions);

  return (
    <TrustedInstitutions
      institutions={rows.map((r) => ({
        ...r,
        liveVouches: Number(r.liveVouches),
        vouchesInWindow: Number(r.vouchesInWindow),
        verifiedAt: r.verifiedAt.toISOString(),
        registrationVerifiedAt: r.registrationVerifiedAt?.toISOString() ?? null,
        suspendedAt: r.suspendedAt?.toISOString() ?? null,
      }))}
      loaded={rows.length}
      total={total}
      windowDays={VOUCH_WINDOW_DAYS}
    />
  );
}
