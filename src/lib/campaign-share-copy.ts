import { formatMoney } from '@/lib/money/format';

/**
 * The sentence that travels with a shared campaign link.
 *
 * ## Why this is a module
 *
 * It feeds `og:description`, `twitter:description` and the JSON-LD
 * `description` at once. Those were three separate string literals that had
 * already drifted into three different claims about the same campaign, which
 * is the `docs/110` seven-status-maps shape.
 *
 * ## ⛔ It must never begin with the campaign title
 *
 * Every platform renders `og:title` as a heading and `og:description`
 * immediately beneath it. The old string started with the title verbatim, so
 * WhatsApp and Facebook printed the headline, then the same headline again
 * in grey - and clamped it at two lines, so the reader never reached a
 * single new fact. Observed 2026-10-25 against the live tags on
 * `/campaigns/mila-ostrowski`. A test asserts it.
 *
 * ## Money
 *
 * `formatMoney(minor, currency)` - never `centsToDollars`, which hardcodes
 * USD while every amount column is in the minor units of its own row's
 * currency (`docs/92`).
 */
export interface ShareDescriptionInput {
  categoryLabel: string;
  subjectName: string | null;
  location?: string | null;
  raisedMinor: number;
  goalMinor: number;
  currency: string;
  donorCount: number;
}

export function campaignShareDescription(input: ShareDescriptionInput): string {
  const { categoryLabel, subjectName, location, raisedMinor, goalMinor, currency } = input;

  const who = subjectName ? ` for ${subjectName}` : '';
  const where = location ? ` in ${location}` : '';
  const lead = `Reviewed ${categoryLabel.toLowerCase()} fundraiser${who}${where}.`;

  const goal = formatMoney(goalMinor, currency);

  /*
    Zero is the common case here, not the edge (`docs/72`), so it gets real
    copy rather than "0% funded - $0.00 of $35,000.00 raised". Naming the
    goal is useful; naming the absence of donations is not.
  */
  if (raisedMinor <= 0) {
    return `${lead} ${goal} goal. Be the first to donate.`;
  }

  const percent = goalMinor > 0
    ? Math.min(Math.round((raisedMinor / goalMinor) * 100), 100)
    : 0;
  const raised = formatMoney(raisedMinor, currency);
  const donors = input.donorCount > 0
    ? ` from ${input.donorCount} ${input.donorCount === 1 ? 'donor' : 'donors'}`
    : '';

  return `${lead} ${percent}% funded - ${raised} of ${goal} raised${donors}.`;
}
