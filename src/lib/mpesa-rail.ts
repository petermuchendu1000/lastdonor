/**
 * Which M-Pesa rail collects a given currency, and what an M-Pesa charge is
 * denominated in.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 *
 * There are now TWO M-Pesa rails (`docs/92` PayHero, `docs/180`-`docs/183`
 * Palpluss) serving the identical pair of routes, and until this landed the
 * donor-facing surfaces each decided between them by hand:
 *
 *   - `MpesaDonationForm` fetched `/api/v1/donations/payhero/initiate` and
 *     `.../payhero/status` as literals, so it could only ever drive one rail
 *     however the currency table was configured;
 *   - `campaigns/[slug]/donate/client.tsx` gated on
 *     `getCurrency(currency).gateway === 'payhero'`;
 *   - `donate/page.tsx` gated on the same literal comparison;
 *   - `campaigns/[slug]/donate/page.tsx` quoted its FX target from
 *     `payHeroChargeCurrency()`, which **throws** when no currency routes to
 *     PayHero — the trap `docs/182` §6 reported and could not fix without
 *     this module.
 *
 * Four sites, four chances to forget, and the owner's next step is a one-line
 * change to the currency table. `docs/146` is the rule: the predicate that
 * decides a thing must be the predicate every surface asks. `docs/147` is the
 * same rule for a listing, and `docs/165` is what happens when a sweep guards
 * the question it was written for and not its sibling.
 *
 * ── The invariant ─────────────────────────────────────────────────────────
 *
 * **The rail that charges is the rail whose currency is on the pay button.**
 *
 * That is the whole point of deriving rather than passing a prop. The form
 * already computes the currency the donor is billed in, because it has to
 * print that figure (`docs/168`: the button must not say "$5.00" while
 * Ksh 650.00 leaves their account). Taking the rail from the SAME value makes
 * it impossible for the displayed charge and the API that performs it to
 * disagree. A `rail` prop would be a second answer to a question already
 * answered, settable wrongly at either of two render sites — `docs/119`'s
 * `_hasCampaigns` and `docs/125`'s defaulted parameter are both that shape.
 */

import {
  SUPPORTED_CURRENCY_CODES,
  getCurrency,
  isSupportedCurrency,
  type CurrencyDefinition,
} from '@/lib/money/currencies';

/**
 * A gateway that collects over M-Pesa.
 *
 * ⛔ DERIVED BY EXCLUSION, with no list to drift. Stripe is the card rail and
 * has an entirely different client flow (an embedded checkout, not a push to
 * a handset); everything else in the union is a push rail serving
 * `…/<rail>/initiate` and `…/<rail>/status`.
 *
 * ⚠️ That derivation is only safe because something fails the build when it
 * stops being true. Two things do, and both are load-bearing:
 *
 *   1. `Record<MpesaRail, …>` — the path table in `MpesaDonationForm` — so a
 *      fourth gateway cannot compile until somebody declares its routes.
 *      `docs/144`: a Record enumerates, an array with a lookup compiles with
 *      a hole in it, which is how a whole category went missing there.
 *   2. `mpesa-rail.test.ts` reads the route tree from disk and asserts every
 *      non-Stripe gateway really does serve both routes. A card gateway added
 *      to this union would be claimed as M-Pesa by the function below, and
 *      that test is what refuses it rather than hoping nobody does.
 */
export type MpesaRail = Exclude<CurrencyDefinition['gateway'], 'stripe'>;

/**
 * The M-Pesa rail that collects this currency, or `null` if none does.
 *
 * `null` covers both the card rail and an unknown code, because the caller's
 * question is the same either way: *may I show the M-Pesa form?* It is not an
 * error — every USD campaign answers null and is served the card form.
 */
export function mpesaRailFor(currency: string): MpesaRail | null {
  if (!isSupportedCurrency(currency)) return null;
  const { gateway } = getCurrency(currency);
  // Narrows to MpesaRail, which is what makes the exclusion above type-level
  // rather than a comment.
  return gateway === 'stripe' ? null : gateway;
}

/**
 * The currency an M-Pesa charge is denominated in, or `null` when there is no
 * single answer.
 *
 * [VERIFIED] both rails send `amount` with **no currency field** — the charge
 * currency is a property of the channel, not of the request (`docs/168`,
 * `payhero.ts:503`; the Palpluss client refuses a non-Kenyan number for the
 * same reason). So a donate page that wants to quote a rate needs to know
 * what the far side of that quote is, and this is it.
 *
 * ⛔ `null` for NONE **and** for AMBIGUOUS, and the two are deliberately the
 * same answer. A caller cannot act on "there are two" any more than on
 * "there are none": picking one of two silently is how a donor is charged in
 * the wrong money. `palplussChargeCurrency()` already made exactly that
 * argument for a single rail (`docs/182` §4).
 *
 * ⚠️ This REPLACED `payHeroChargeCurrency()` at the donate-page call site,
 * which throws on both of those cases. A throw in a server component is not a
 * 500: it renders the error boundary inside a 200, on the public donate page
 * of every live campaign at once (`docs/88` F9, `docs/182` §6). The per-rail
 * throwing helpers are kept and still used by each initiate route, where they
 * mean something different and correct — *this rail must charge in exactly
 * one currency before it collects anything* — rather than *which rail*.
 */
export function mpesaChargeCurrency(): string | null {
  const codes = SUPPORTED_CURRENCY_CODES.filter((code) => mpesaRailFor(code) !== null);
  return codes.length === 1 ? codes[0] : null;
}
