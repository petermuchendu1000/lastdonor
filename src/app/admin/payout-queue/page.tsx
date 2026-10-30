import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import type { Metadata } from 'next';
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import {
  campaignPayoutDesignations,
  campaigns,
  institutionPayoutAccounts,
  trustedInstitutions,
} from '@/db/schema';
import { Money } from '@/components/ui/Money';
import { NO_RAIL_REASON, resolvePayoutRail } from '@/lib/institutional-payout/rail';
import { campaignStatusLabel, verificationStatusLabel } from '@/lib/campaign-labels';
import { INSTITUTION_KIND_LABELS } from '@/lib/validators/trust-network';

/*
  NO `revalidate` EXPORT. `src/app/admin/layout.tsx` sets `force-dynamic` for
  the whole subtree (docs/88 F14).
*/

export const metadata: Metadata = {
  title: 'Institutional payouts - Admin - LastDonor.org',
  robots: { index: false },
};

const ROW_CAP = 200;

/**
 * Screen D1 of `docs/113` §11.
 *
 * ⛔ READ-ONLY, and there is no Send button anywhere on it. Not a disabled
 * one either: `resolvePayoutRail()` returns null, so the page states WHY
 * nothing can be sent. `docs/88` F9 is the admin screen that was inert and
 * did not say so.
 *
 * ⚠️ Every figure here is expected to be ZERO. Money has never left this
 * platform (`docs/113` §2), and a screen showing plausible numbers would be
 * lying about the state of production.
 */
export default async function AdminPayoutQueuePage() {
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

  const rail = resolvePayoutRail();

  /*
    ONE query. `docs/88` F8 is the admin screen that pulled a whole table and
    tallied its tiles in JS; the join does the work, and the cap is stated to
    the reader rather than silently applied (`docs/88` F16).
  */
  const rows = await db
    .select({
      designationId: campaignPayoutDesignations.id,
      campaignId: campaigns.id,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      campaignStatus: campaigns.status,
      verificationStatus: campaigns.verificationStatus,
      currency: campaigns.currency,
      headlineRaisedMinor: campaigns.raisedAmount,
      accountReference: campaignPayoutDesignations.accountReference,
      lockedAt: campaignPayoutDesignations.lockedAt,
      institutionName: trustedInstitutions.name,
      institutionKind: trustedInstitutions.kind,
      accountIdentifier: institutionPayoutAccounts.accountIdentifier,
      accountReferenceLabel: institutionPayoutAccounts.accountReferenceLabel,
    })
    .from(campaignPayoutDesignations)
    .innerJoin(campaigns, eq(campaigns.id, campaignPayoutDesignations.campaignId))
    .innerJoin(
      institutionPayoutAccounts,
      eq(institutionPayoutAccounts.id, campaignPayoutDesignations.payoutAccountId),
    )
    .innerJoin(
      trustedInstitutions,
      eq(trustedInstitutions.id, institutionPayoutAccounts.institutionId),
    )
    .where(eq(campaignPayoutDesignations.status, 'active'))
    .orderBy(desc(campaignPayoutDesignations.designatedAt))
    .limit(ROW_CAP);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Payouts · to institutions
        </p>
        <h1 className="mt-1 font-serif text-2xl">Campaigns paid to an institution</h1>
      </div>

      {/*
        The blocker, stated. An admin looking at an empty screen needs to know
        whether that means "nothing designated" or "we cannot send anyway".
      */}
      {!rail && (
        <div className="rounded-xl border-l-4 border-destructive bg-destructive/5 p-4">
          <p className="text-sm font-semibold">No money can be sent from this screen yet</p>
          <p className="mt-1 text-sm text-muted-foreground">{NO_RAIL_REASON}</p>
        </div>
      )}

      <div className="rounded-xl border border-border">
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['Campaign', 'Destination', 'Reference', 'Headline raised', 'Campaign', 'ID check'].map(
                  (h, i) => (
                    <th
                      key={`${h}-${i}`}
                      className="whitespace-nowrap px-3 pb-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No campaign has chosen an institution yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.designationId} className="border-t border-border">
                  <td className="px-3 py-3">
                    <Link className="font-medium underline" href={`/admin/campaigns/${r.campaignId}`}>
                      {r.campaignTitle}
                    </Link>
                    {r.lockedAt && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">
                        Locked
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="block">{r.institutionName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {INSTITUTION_KIND_LABELS[
                        r.institutionKind as keyof typeof INSTITUTION_KIND_LABELS
                      ] ?? r.institutionKind}{' '}
                      · {r.accountIdentifier}
                    </span>
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    <span className="block">{r.accountReference}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.accountReferenceLabel}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {/*
                      ⚠️ `raised_amount` is blended with fabricated seed money
                      (`docs/101`), so it is NOT a payable figure and is
                      labelled "headline". The real payable amount is
                      deliberately absent until a rail exists to pay it -
                      inventing one would be the first lie on a money screen.
                    */}
                    <Money minor={r.headlineRaisedMinor} currency={r.currency} />
                  </td>
                  <td className="px-3 py-3 text-xs">{campaignStatusLabel(r.campaignStatus)}</td>
                  <td className="px-3 py-3 text-xs">
                    {verificationStatusLabel(r.verificationStatus)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* docs/88 F16: say the page range, the loaded count and the cap. */}
      <p className="text-xs text-muted-foreground">
        Showing {rows.length} of at most {ROW_CAP}. Figures are the campaign&apos;s headline total,
        which includes seed money and is not what anybody would be paid.
      </p>
    </div>
  );
}
