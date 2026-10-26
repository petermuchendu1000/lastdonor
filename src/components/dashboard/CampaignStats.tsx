import { Money } from '@/components/ui/Money';

/**
 * The figures an organiser came for, above the list.
 *
 * ── WHY THIS DID NOT EXIST AND SHOULD HAVE ──────────────────────────────────
 *
 * The screen opened straight onto a list of cards, so somebody with four
 * campaigns had to add them up in their head to answer "how much have I
 * raised". Every dashboard reference puts a small strip of figures above the
 * fold, and the useful version pairs each figure with the context that makes
 * it mean something - a count alone is trivia.
 *
 * ⛔ TOTALS ARE PER CURRENCY AND ARE NEVER SUMMED ACROSS THEM.
 *
 * `docs/92`: a campaign has exactly one currency and two currencies are never
 * added together. An organiser with a KES campaign and a USD one has two
 * totals, not one, and a single blended number would be the most confident
 * lie on the screen. This renders one tile per currency.
 *
 * ⚠️ These are HEADLINE totals. `raised_amount` is blended with fabricated
 * seed money (`docs/101`), so it is not a payable figure and must never be
 * labelled as money owed.
 */

export interface CampaignStatsInput {
  currency: string;
  raisedAmount: number;
  donorCount: number;
  status: string;
}

/** Live statuses, i.e. the ones a donor can actually give to. */
const LIVE = new Set(['active', 'last_donor_zone']);

export function CampaignStats({ campaigns }: { campaigns: CampaignStatsInput[] }) {
  if (campaigns.length === 0) return null;

  const byCurrency = new Map<string, { raised: number; donors: number }>();
  for (const c of campaigns) {
    const t = byCurrency.get(c.currency) ?? { raised: 0, donors: 0 };
    t.raised += c.raisedAmount;
    t.donors += c.donorCount;
    byCurrency.set(c.currency, t);
  }

  const live = campaigns.filter((c) => LIVE.has(c.status)).length;
  const totals = [...byCurrency.entries()];

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {totals.map(([currency, t]) => (
        <Tile
          key={currency}
          label={totals.length > 1 ? `Raised (${currency})` : 'Raised'}
          value={<Money minor={t.raised} currency={currency} />}
          hint={`${t.donors} ${t.donors === 1 ? 'donor' : 'donors'}`}
        />
      ))}
      <Tile
        label="Campaigns"
        value={String(campaigns.length)}
        hint={live === 1 ? '1 live' : `${live} live`}
      />
    </dl>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-display text-lg leading-tight font-bold tabular-nums text-foreground">
        {value}
      </dd>
      {/*
        The context line. A figure on its own is trivia; "Ksh 18,400" next to
        "31 donors" is a sentence somebody can act on.
      */}
      <dd className="text-[11px] text-muted-foreground">{hint}</dd>
    </div>
  );
}
