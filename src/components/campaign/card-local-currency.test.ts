/**
 * A campaign card shows its goal in the READER'S currency, and every surface
 * that renders one hands it the rates to do it with.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 *
 * `docs/102` built the whole display-FX layer - `convertMinor`, `ApproxMoney`,
 * `LocalAmount`, a daily refresh cron, a 48-hour staleness refusal, provider
 * attribution and an import allowlist - and `docs/104` fixed its reader bug
 * against a real browser at `Africa/Kampala`. Then it was wired to **exactly
 * one figure**: the goal on `campaigns/[slug]/page.tsx:639`.
 *
 * Every card a visitor actually browses - the homepage grid, `/campaigns`,
 * the category pages, similar campaigns, completed campaigns - carried no
 * local equivalent at all. So a Kenyan reading a dollar appeal had no way to
 * size it, on a platform whose only working rail is M-Pesa.
 *
 * ── WHY THESE RULES AND NOT "THE CARD CONVERTS" ─────────────────────────────
 *
 * Rule 3 is the one that earns its place. The defect this codebase keeps
 * repeating is **a prop that is declared and never read**: `docs/119`'s
 * `hasCampaigns`, destructured as `_hasCampaigns` and thrown away after
 * costing a query; `docs/132`'s `isAdmin`, declared on `AdminDashboard` and
 * destructured away, so an editor saw donor names against gift amounts. A
 * card that accepts `fxSnapshot` and renders nothing with it would satisfy
 * rules 1 and 2 completely.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((p) => /\.tsx$/.test(p))
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .map((p) => join(SRC, p));
}

const FILES = sourceFiles().map((path) => ({
  rel: path.slice(SRC.length + 1),
  src: readFileSync(path, 'utf8'),
}));

/** Files that render a card or a grid of them, discovered from disk. */
const RENDERS_A_CARD = FILES.filter(
  (f) => /<CampaignCard\b/.test(f.src) || /<CampaignGrid\b/.test(f.src),
);

const CARD = FILES.find((f) => f.rel === 'components/campaign/CampaignCard.tsx')!;
const GRID = FILES.find((f) => f.rel === 'components/campaign/CampaignGrid.tsx')!;

describe('every surface that renders a campaign card can convert its goal', () => {
  it('finds the render sites at all', () => {
    // Anti-vacuity. A discovery that found nothing would pass every rule
    // below without reading a single surface.
    expect(FILES.length).toBeGreaterThan(100);
    expect(RENDERS_A_CARD.length).toBeGreaterThanOrEqual(5);
    const rels = RENDERS_A_CARD.map((f) => f.rel);
    expect(rels).toContain('app/(home)/page.tsx');
    expect(rels).toContain('app/campaigns/(index)/page.tsx');
    expect(rels).toContain('components/campaign/CampaignGrid.tsx');
  });

  it('rule 1: every render site passes fxSnapshot', () => {
    const missing = RENDERS_A_CARD.filter((f) => !/fxSnapshot=/.test(f.src)).map((f) => f.rel);
    expect(missing).toEqual([]);
  });

  it('rule 2: a server surface that passes it also READS it', () => {
    /*
      A page can only pass a snapshot it fetched. The two client components
      receive it as a prop instead, so they are required to DECLARE it rather
      than read it - checked by rule 3.
    */
    const clientHolders = ['components/campaign/CampaignCard.tsx', 'components/campaign/CampaignGrid.tsx'];
    const pages = RENDERS_A_CARD.filter((f) => !clientHolders.includes(f.rel));
    expect(pages.length).toBeGreaterThanOrEqual(3);

    const notReading = pages
      .filter((f) => !/readFxSnapshot\s*\(/.test(f.src))
      .map((f) => f.rel);
    expect(notReading).toEqual([]);
  });

  it('rule 2a: the read is SEQUENTIAL, never inside a Promise.all', () => {
    /*
      `docs/87` caps an entry point at three CONCURRENT queries against a pool
      of five. Proven by injection: moving the homepage's read into its
      `Promise.all` fails `src/db/pool-fanout.ratchet.test.ts`.

      That ratchet is the real enforcement; this rule is the cheap text
      tripwire beside it, because the fanout check takes seven seconds and
      this one is instant.
    */
    for (const f of RENDERS_A_CARD) {
      const inBatch = /readFxSnapshot\(\),/.test(f.src);
      expect(inBatch, `${f.rel} calls readFxSnapshot() inside an array literal`).toBe(false);
    }
  });

  it('rule 3: the card does not merely ACCEPT the snapshot, it renders with it', () => {
    // The docs/119 / docs/132 shape: a prop declared, destructured away, and
    // never used. Rules 1 and 2 would be fully satisfied by that.
    expect(CARD.src).toMatch(/fxSnapshot\?:/); // declared
    expect(CARD.src).toMatch(/^\s*fxSnapshot,$/m); // destructured
    /*
      ⚠️ `\b` is load-bearing. The first version was `/<LocalAmount/`, and an
      injection renaming the component to `<LocalAmountXX` DID NOT FIRE -
      the broken text still contains the pattern as a substring. Gate 4's
      named trap: a grep that matches both the fixed and the broken version.
    */
    expect(CARD.src).toMatch(/<LocalAmount\b/); // and rendered
    expect(CARD.src).toMatch(/snapshot=\{fxSnapshot/); // with THIS prop, not something else
  });

  it('rule 4: the grid forwards it to the cards it appends in the browser', () => {
    /*
      `CampaignGrid` builds cards client-side after a "Load more" fetch
      (`docs/145`), so a figure rendered on the server reaches page 1 and not
      page 2 - which is the exact shape `docs/115` found on this component
      when appended cards rendered every amount in dollars.
    */
    expect(GRID.src).toMatch(/^\s*fxSnapshot,$/m);
    expect(GRID.src).toMatch(/fxSnapshot=\{fxSnapshot\}/);
  });

  it('rule 5: a USD appeal does not fall back to converting USD into USD', () => {
    /*
      `fallbackCurrency` is what renders on the SERVER, before the browser
      reports where it is. A bare `'USD'` would print "Goal is about $5,000"
      under "$5,000 goal" on every dollar campaign.

      ⚠️ `LocalAmount.tsx:80-91` already refuses a same-currency conversion
      AFTER detection resolves, so this rule covers the pre-detection render
      only - the one case that component cannot guard, because it does not yet
      know where the reader is.
    */
    expect(CARD.src).toMatch(/fallbackCurrency=\{[^}]*'USD'\s*\?\s*null/);
  });
});
