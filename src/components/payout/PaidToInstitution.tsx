import { institutionalPayoutCopy, type PayoutDisclosure } from '@/lib/institutional-payout/public';

/**
 * What a donor is told before they give (`docs/113` §11.3, screens C1-C2).
 *
 * ⛔ Every word comes from `institutionalPayoutCopy`. Do not write a sentence
 * about the destination inline at a call site: `public.test.ts` forbids the
 * word "verified" and pins the bill-number caveat, and a literal next door
 * would be swept by nothing. That is the `docs/110` §9.2 failure - a rule
 * asserted on two surfaces while a third said whatever it liked.
 *
 * ⚠️ The "what we checked / what we have not" pair is the whole honesty of
 * the feature, so it renders at every size. There is no compact variant that
 * drops it.
 */
export function PaidToInstitution({
  disclosure,
  className,
}: {
  disclosure: PayoutDisclosure;
  className?: string;
}) {
  const copy = institutionalPayoutCopy(disclosure);

  return (
    <section
      className={`rounded-xl border border-primary/25 bg-primary/5 p-4 ${className ?? ''}`}
      aria-label="Where this money goes"
    >
      <p className="text-sm font-semibold">{copy.headline}</p>
      <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
      <p className="mt-2 text-xs text-primary">
        <strong>What we checked:</strong> {copy.checked}
      </p>
      <p className="text-xs text-primary">
        <strong>What we have not:</strong> {copy.notChecked}
      </p>
    </section>
  );
}

/** The one-line form, for a card or a hero (`docs/113` §11, C1 badge). */
export function PaidToInstitutionBadge({ disclosure }: { disclosure: PayoutDisclosure }) {
  const copy = institutionalPayoutCopy(disclosure);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {copy.badge}
    </span>
  );
}
