import Link from 'next/link';

/**
 * The one general-fund call to action, used by every page that carries one.
 *
 * ── ⛔ WHY IT NAMES NO PAYMENT METHOD ───────────────────────────────────────
 *
 * The rail is a property of the fund's own `campaigns` row, not of this
 * component: `USD` is collected by Stripe and `KES` by M-Pesa, and
 * `/donate` reads the row and renders the matching form (`docs/147`).
 *
 * A CTA that said "donate by card" or "give with M-Pesa" would have to read
 * the database to be true, on four pages, which costs a query each
 * (`docs/87` caps an entry point at three) - and would be wrong the moment
 * the fund's currency changes. So it says what is true whatever the rail, and
 * `/donate` states the method at the moment it matters.
 *
 * ⛔ It also quotes NO processing rate and names NO processor:
 * `src/app/fee-claims.test.ts` fails the build on either, and `docs/116` §5
 * records why - nothing in this codebase deducts a processing fee at all.
 */
export function GeneralFundCta({ className = '' }: { className?: string }) {
  return (
    <section
      aria-labelledby="general-fund-cta"
      className={`rounded-2xl border border-border bg-card p-6 sm:p-8 ${className}`}
    >
      <h2
        id="general-fund-cta"
        className="font-display text-xl font-bold text-card-foreground sm:text-2xl"
      >
        Who pays for the checking?
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
        A person reads every campaign before it goes live. The general fund
        pays for that work, and for keeping the site running. It is separate
        from the fundraisers: a gift to the fund does not go to a campaign, and
        a gift to a campaign never comes to us.
      </p>
      <Link
        href="/donate"
        className="btn-press mt-5 inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        Donate to the general fund
      </Link>
    </section>
  );
}
