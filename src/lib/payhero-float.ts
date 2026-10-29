/**
 * Whether PayHero's fee float can still pay for collections.
 *
 * ── WHY THIS IS A MODULE AND NOT TWO COPIES ─────────────────────────────────
 *
 * The check already existed, inline in `src/app/api/v1/health/route.ts`: it
 * read the wallet, divided by the per-collection fee, and flipped
 * `checks.payhero` to `error` below a count. What it could not do is TELL
 * ANYBODY - the verdict reached whoever happened to fetch `/api/v1/health`,
 * plus a `console.error` into Fly's log buffer. [VERIFIED 2026-10-29]
 * `fly.toml:289` points Fly's own check at `/api/v1/live`, not at
 * `/api/v1/health`, so a low float does not restart or drain the machine
 * either - which is correct (that route's own header forbids it) and also
 * means nothing at all escalates.
 *
 * So a cron now evaluates the same question and emails the administrators.
 * The predicate lives here, read by BOTH, because `docs/146` is about exactly
 * this shape: *"the predicate that COUNTS a group is the predicate that LISTS
 * it"* - a threshold stated twice is a threshold that drifts, and `docs/138`
 * found a third cron list on a settings screen for the same reason.
 *
 * Pure on purpose: no database, no `payhero` import, no `server-only`. The
 * arithmetic is the part that can be wrong, so it has to be the part a test
 * can execute (`docs/107`, `docs/126`, `docs/130` all moved a calculation for
 * this reason).
 *
 * ── ⛔ THE UNIT, WHICH IS THE THING THAT CAN BE 100x WRONG ──────────────────
 *
 * `getWalletBalance()` returns PayHero's raw `available_balance`, and that is
 * a **MAJOR-unit decimal**: the live wallet read `2027.6`, meaning KES 2,027.60.
 * It is NOT minor units. Everything in this file is therefore in major KES and
 * says so in its name.
 *
 * This matters because every amount COLUMN in this codebase is in minor units
 * (CLAUDE.md, `docs/92`), so the reflex when writing money code here is to
 * multiply by 100 - which is the `docs/114` defect (`Math.round(dollars * 100)`
 * in both withdraw handlers, right by coincidence for USD and KES and 100x
 * wrong for a zero-decimal currency). A `* 100` anywhere near these values
 * would make the alert fire at a hundredth of the intended balance, i.e. never.
 * `payhero-float.test.ts` asserts the units explicitly.
 */

/**
 * What PayHero actually charges this account per collection, in **major KES**.
 *
 * Measured, not read off the published fee table: `GET /api/transaction_fees`
 * advertises KES 6 for the 50-499 band, and the real charge on a KES 50
 * collection was KES 8.9 - the same as on two earlier KES 200 collections, so
 * it is flat rather than tiered. `docs/92`.
 */
export const PAYHERO_FEE_PER_COLLECTION_KES = 8.9;

/**
 * Warn at or below this balance, in **major KES**. Owner decision 2026-10-29.
 *
 * ⚠️ It replaces an existing threshold rather than joining it. The health
 * route carried `LOW_FLOAT_COLLECTIONS = 25`, which is 25 x 8.9 = **KES
 * 222.50** - less than half of this. Both were in the same units; what
 * changed is the number, and that the number is now stated in the unit the
 * decision was made in (KES) with the collection count DERIVED, rather than
 * the other way round.
 *
 * At this balance there are roughly 56 collections left. The observed drain is
 * ⚠️ **one measurement, not a rate to rely on**: 159.6 KES in 2h53m on
 * 2026-10-29 (`docs/147` §11.3), which is ~55 KES/hour and almost entirely
 * BETWOIN LTD's traffic on the shared wallet. At that rate this threshold
 * leaves about nine hours.
 */
export const LOW_FLOAT_WARN_KES = 500;

/**
 * How long to wait before emailing about a low float again, in hours.
 *
 * ⛔ THE INVARIANT, and the reason this is 6 and not 24:
 *
 *     cooldown  <  time to drain from the threshold to zero
 *
 * At the observed ~55 KES/hour, draining from `LOW_FLOAT_WARN_KES` to zero
 * takes about 9 hours. A cooldown longer than that would make the first alert
 * potentially the only one, arriving once and then going quiet while the float
 * ran out. Six hours gives at least one repeat before exhaustion.
 *
 * ⚠️ The drain rate is one measurement and the wallet is shared with another
 * company, so it can be much faster. That is an argument for a SHORTER
 * cooldown, never a longer one - which is why raising this number needs the
 * arithmetic above redone, not just a bigger figure.
 */
export const LOW_FLOAT_EMAIL_COOLDOWN_HOURS = 6;

export type FloatAssessment = {
  /** As PayHero reported it, major KES. */
  balanceKes: number;
  /** Whole collections the float can still pay for. */
  collectionsRemaining: number;
  /** At or below the warn threshold. */
  isLow: boolean;
  /** Nothing left: collections fail outright. */
  isExhausted: boolean;
};

/**
 * The one verdict, from the balance PayHero reported.
 *
 * `floor` for the count because a part-paid collection is not a collection,
 * and `<=` for the threshold because landing exactly on it is already low.
 */
export function assessFloat(balanceKes: number): FloatAssessment {
  const safe = Number.isFinite(balanceKes) ? balanceKes : 0;
  return {
    balanceKes: safe,
    collectionsRemaining: Math.max(0, Math.floor(safe / PAYHERO_FEE_PER_COLLECTION_KES)),
    isLow: safe <= LOW_FLOAT_WARN_KES,
    isExhausted: safe < PAYHERO_FEE_PER_COLLECTION_KES,
  };
}

/**
 * The warn threshold as a collection count, for the health route's message.
 *
 * DERIVED, so the two surfaces cannot disagree about where the line is.
 */
export function lowFloatCollections(): number {
  return Math.floor(LOW_FLOAT_WARN_KES / PAYHERO_FEE_PER_COLLECTION_KES);
}
