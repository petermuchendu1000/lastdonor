/**
 * ⛔ NOT WIRED TO ANYTHING. Do not re-render this in the UI without first
 * building the feature behind it. See `docs/76`.
 *
 * Until 2026-10-16 the create wizard showed an "Automated goal setting"
 * toggle, defaulted ON and badged "Recommended", which said *"we'll
 * gradually adjust your goal as donations come in"* and then printed
 * **"Your starting goal would be: $600"** under a $25,000 entry.
 *
 * None of that happened. `autoGoal` was never in the POST body,
 * `goalAmount` was always sent at the full typed figure, no column stores a
 * starting goal, and no job anywhere raises one. The toggle was a promise
 * with no implementation, on a page about other people's money, so the UI
 * was removed rather than the promise softened.
 *
 * The function survives because the anchor table below is researched work
 * worth keeping for whoever builds the real thing. Building it needs: a
 * column for the published goal distinct from the target, a job that raises
 * it, and a decision about what donors are shown while it ramps - which is
 * `docs/33` territory, not a UI change.
 *
 * Computes a lower starting goal by piecewise linear interpolation in
 * log10 space, capped at $2,600.
 *
 * Anchor points (matching GoFundMe):
 *   $100     → $100
 *   $1,000   → $300
 *   $10,000  → $600
 *   $100,000 → $1,200
 *   $1M+     → $2,600 (cap)
 */
export function computeStartingGoal(amount: number): number {
  if (amount <= 0) return 0;
  if (amount <= 100) return amount;
  if (amount >= 1_000_000) return 2600;

  const tiers = [
    { amt: 100, goal: 100 },
    { amt: 1_000, goal: 300 },
    { amt: 10_000, goal: 600 },
    { amt: 100_000, goal: 1_200 },
    { amt: 1_000_000, goal: 2_600 },
  ];

  const log = Math.log10(amount);
  for (let i = 0; i < tiers.length - 1; i++) {
    const logLow = Math.log10(tiers[i].amt);
    const logHigh = Math.log10(tiers[i + 1].amt);
    if (log <= logHigh) {
      const t = (log - logLow) / (logHigh - logLow);
      return Math.round(tiers[i].goal + t * (tiers[i + 1].goal - tiers[i].goal));
    }
  }

  return 2600;
}
