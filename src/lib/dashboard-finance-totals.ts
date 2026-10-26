/**
 * The organiser's finance tiles, PER CURRENCY.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `src/components/dashboard/FinancesClient.tsx:112-118` computed four totals
 * with `campaigns.reduce((s, c) => s + c.raisedAmount, 0)` and rendered them
 * through a local `fmt()` that was literally
 * `'$' + (cents / 100).toLocaleString('en-US', …)` - a FIFTH hand-rolled
 * currency formatter, of the kind `docs/88` F4/F5 removed from admin, sitting
 * on the screen an organiser uses to take their money out.
 *
 * An organiser may hold campaigns in more than one currency: a campaign is
 * single-currency by composite FK (`docs/92`), a PERSON is not. Adding 100 KES
 * to 100 USD yields 200 of nothing, and the dollar sign then states a figure
 * the platform cannot substantiate.
 *
 * ── WHY A MODULE ────────────────────────────────────────────────────────────
 *
 * `docs/107`: logic written inline in a component is logic no test runs. This
 * is pure - no database, no React - so `dashboard-finance-totals.test.ts`
 * executes it directly.
 */

/** Only the fields the tiles need. Minor units of each row's own currency. */
export interface FinanceCampaignAmounts {
  currency: string;
  raisedAmount: number;
  totalReleasedAmount: number;
  totalWithdrawnAmount: number;
  availableBalance: number;
}

export interface FinanceCurrencyTotals {
  currency: string;
  raisedMinor: number;
  availableMinor: number;
  withdrawnMinor: number;
  /** Raised but not yet released to the organiser, floored at zero per row. */
  pendingReleaseMinor: number;
  campaignCount: number;
}

/**
 * One row per currency the organiser actually has campaigns in, biggest raise
 * first.
 *
 * ⚠️ `pendingRelease` is floored PER CAMPAIGN, not on the total. Releasing
 * more than was raised is possible in the data (seed blending, a manual
 * release), and flooring the sum would let one campaign's overage cancel
 * another's genuine shortfall - which is what the `Math.max(0, …)` inside the
 * original reduce was already doing. That behaviour is preserved deliberately.
 *
 * Returns `[]` for an organiser with no campaigns, so the caller renders
 * nothing rather than a zero in a currency they have never used.
 */
export function financeTotalsByCurrency(
  campaigns: readonly FinanceCampaignAmounts[],
): FinanceCurrencyTotals[] {
  const byCurrency = new Map<string, FinanceCurrencyTotals>();

  for (const c of campaigns) {
    let row = byCurrency.get(c.currency);
    if (!row) {
      row = {
        currency: c.currency,
        raisedMinor: 0,
        availableMinor: 0,
        withdrawnMinor: 0,
        pendingReleaseMinor: 0,
        campaignCount: 0,
      };
      byCurrency.set(c.currency, row);
    }
    row.raisedMinor += c.raisedAmount;
    row.availableMinor += c.availableBalance;
    row.withdrawnMinor += c.totalWithdrawnAmount;
    row.pendingReleaseMinor += Math.max(0, c.raisedAmount - c.totalReleasedAmount);
    row.campaignCount += 1;
  }

  return Array.from(byCurrency.values()).sort(
    (a, b) => b.raisedMinor - a.raisedMinor || a.currency.localeCompare(b.currency),
  );
}
