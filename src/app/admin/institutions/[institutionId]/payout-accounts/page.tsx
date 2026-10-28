import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { institutionPayoutAccounts, trustedInstitutions } from '@/db/schema';
import { PayoutAccountsPanel } from '@/components/admin/PayoutAccountsPanel';
import { INSTITUTION_KIND_LABELS } from '@/lib/validators/trust-network';

/* NO `revalidate`: the admin layout is `force-dynamic` (docs/88 F14). */

export const metadata: Metadata = {
  title: 'Payment details - Admin - LastDonor.org',
  robots: { index: false },
};

/**
 * Screen A1 of `docs/113` §11.
 *
 * ⚠️ Deliberately a SEPARATE screen from the institutions list, because
 * recording a payee is a separate decision from trusting a voucher
 * (`docs/108` kept payment off `trusted_institutions` for exactly that
 * reason). Reaching this page is a step somebody takes on purpose.
 *
 * Two queries, sequential, the second gated on the first (`docs/87`).
 */
export default async function PayoutAccountsPage({
  params,
}: {
  params: Promise<{ institutionId: string }>;
}) {
  /*
    ⛔ Gated for the same reason as its parent (`docs/132`), and this one holds
    MORE: an institution's payout destinations. It is not in the sidebar, so
    `admin-nav-role.ratchet.test.ts` does not require it - which is exactly why
    it is written here deliberately rather than left to a rule that cannot see
    it.
  */
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  const { institutionId } = await params;

  const [institution] = await db
    .select({
      id: trustedInstitutions.id,
      name: trustedInstitutions.name,
      kind: trustedInstitutions.kind,
      country: trustedInstitutions.country,
      status: trustedInstitutions.status,
    })
    .from(trustedInstitutions)
    .where(eq(trustedInstitutions.id, institutionId))
    .limit(1);

  if (!institution) notFound();

  const accounts = await db
    .select({
      id: institutionPayoutAccounts.id,
      currency: institutionPayoutAccounts.currency,
      rail: institutionPayoutAccounts.rail,
      accountIdentifier: institutionPayoutAccounts.accountIdentifier,
      accountReferenceLabel: institutionPayoutAccounts.accountReferenceLabel,
      status: institutionPayoutAccounts.status,
      confirmationNotes: institutionPayoutAccounts.confirmationNotes,
      confirmedAt: institutionPayoutAccounts.confirmedAt,
      retiredReason: institutionPayoutAccounts.retiredReason,
    })
    .from(institutionPayoutAccounts)
    .where(eq(institutionPayoutAccounts.institutionId, institutionId))
    .orderBy(desc(institutionPayoutAccounts.confirmedAt));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/institutions" className="text-xs underline text-muted-foreground">
          ← Trusted organisations
        </Link>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Payment details
        </p>
        <h1 className="mt-1 font-serif text-2xl">{institution.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {INSTITUTION_KIND_LABELS[institution.kind as keyof typeof INSTITUTION_KIND_LABELS] ??
            institution.kind}{' '}
          · {institution.country}
        </p>
      </div>

      <PayoutAccountsPanel
        institutionId={institution.id}
        institutionName={institution.name}
        institutionSuspended={institution.status !== 'active'}
        accounts={accounts.map((a) => ({
          ...a,
          confirmedAt: a.confirmedAt.toISOString(),
        }))}
      />
    </div>
  );
}
