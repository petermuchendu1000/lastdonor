/**
 * The sentence under the headline on WhatsApp, Facebook and LinkedIn.
 *
 * The rule this file exists for is the first one: it must not begin with
 * the campaign title. Observed on production 2026-10-25, the live
 * `og:description` for `/campaigns/mila-ostrowski` opened with the title
 * verbatim, so the card printed the same sentence twice and clamped the
 * second copy before it reached any new information.
 *
 * It also feeds the JSON-LD description, so the two can no longer drift.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { campaignShareDescription } from '@/lib/campaign-share-copy';

/** `Intl` uses U+00A0 after a multi-character currency symbol. */
const norm = (s: string) => s.replace(/\u00a0/g, ' ');

const TITLE = "Support Mila Ostrowski's Family Through Her Medical Journey";

const copy = (over: Partial<Parameters<typeof campaignShareDescription>[0]> = {}) =>
  campaignShareDescription({
    categoryLabel: 'Medical',
    subjectName: 'Mila Ostrowski',
    location: 'Portland, Oregon',
    raisedMinor: 0,
    goalMinor: 3_500_000,
    currency: 'USD',
    donorCount: 0,
    ...over,
  });

describe('⛔ it never repeats the title', () => {
  it('does not contain the campaign title at all', () => {
    for (const raised of [0, 1_470_000, 3_500_000]) {
      const d = copy({ raisedMinor: raised, donorCount: raised ? 86 : 0 });
      expect(d, 'the title is printed above this by every platform').not.toContain(TITLE);
      expect(d.startsWith('Reviewed')).toBe(true);
    }
  });

  it('the campaign page builds its description from this module', () => {
    /*
      Derived from source rather than pinned, in the `docs/109` style: the
      defect was a template literal in `page.tsx` opening with
      `${campaign.title}`, and a test of this module alone would stay green
      while someone rebuilt that literal next door.
    */
    const src = readFileSync(
      join(process.cwd(), 'src/app/campaigns/[slug]/page.tsx'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).toContain('campaignShareDescription');
    // No description template literal may lead with the title again.
    expect(code).not.toMatch(/description\s*=\s*`\$\{campaign\.title\}/);
    expect(code).not.toMatch(/`\$\{campaign\.title\}\.\s*Reviewed/);
  });
});

describe('the zero state', () => {
  it('names the goal and asks, instead of reporting nothing raised', () => {
    const d = copy();
    expect(d).toBe(
      'Reviewed medical fundraiser for Mila Ostrowski in Portland, Oregon. '
      + '$35,000 goal. Be the first to donate.',
    );
    // What production said: "0% funded - $0.00 of $35,000.00 raised."
    expect(d).not.toMatch(/\$0\b|0%|0 donors/);
  });
});

describe('a funded campaign', () => {
  it('states percent, raised, goal and donors', () => {
    expect(copy({ raisedMinor: 1_470_000, donorCount: 86 })).toBe(
      'Reviewed medical fundraiser for Mila Ostrowski in Portland, Oregon. '
      + '42% funded - $14,700 of $35,000 raised from 86 donors.',
    );
  });

  it('omits the donor clause rather than claiming zero donors', () => {
    const d = copy({ raisedMinor: 1_470_000, donorCount: 0 });
    expect(d).not.toContain('donor');
    expect(d).toContain('42% funded');
  });

  it('says "1 donor", not "1 donors"', () => {
    expect(copy({ raisedMinor: 5_000, donorCount: 1 })).toContain('from 1 donor.');
  });
});

describe('money and missing fields', () => {
  it('uses the row\'s currency, not dollars', () => {
    const d = copy({ currency: 'KES', goalMinor: 5_000_000 });
    expect(norm(d)).toContain('Ksh 50,000 goal');
    expect(d).not.toContain('$');
  });

  it('drops the location clause when there is none', () => {
    expect(copy({ location: null })).toContain('fundraiser for Mila Ostrowski. ');
    expect(copy({ location: null })).not.toContain(' in ');
  });

  it('drops the subject clause when there is none', () => {
    expect(copy({ subjectName: null, location: null })).toContain(
      'Reviewed medical fundraiser. ',
    );
  });

  it('caps the percentage at 100 when a campaign is over its goal', () => {
    expect(copy({ raisedMinor: 9_000_000, donorCount: 4 })).toContain('100% funded');
  });
});
