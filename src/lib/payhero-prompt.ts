/**
 * How long an M-Pesa PIN prompt can plausibly still be live.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
 *
 * Both the server and the donor's browser need this number, and they must not
 * hold two copies of it:
 *
 *   - `payhero-abuse-guard.ts` refuses a second prompt to the same phone while
 *     one is still live, and `status/route.ts` uses it to decide when to stop
 *     telling the client to poll;
 *   - `MpesaDonationForm` derives its own poll ceiling from it, and that
 *     ceiling MUST exceed the lifetime or the browser gives up while the
 *     prompt is still answerable (`docs/159`).
 *
 * It used to live in `payhero-abuse-guard.ts`, which imports `@/db` — so a
 * client component could not reach it without pulling the database client into
 * the bundle. `docs/139` §7 is the rule: a constant shared across the
 * server/client boundary lives in a module neither side owns. ⛔ This file
 * must therefore import NOTHING.
 */

/**
 * Three minutes. Safaricom's STK prompt expires well before this; the margin
 * is deliberate, because the consequence of being too SHORT is refusing a
 * donor who is still typing their PIN, and the consequence of being too long
 * is only a slightly later retry.
 */
export const PROMPT_LIFETIME_MS = 3 * 60_000;
