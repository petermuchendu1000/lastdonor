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
    /*
      `.ts` as well as `.tsx`: rule 7c reads `use-detected-locale.ts`, and a
      scan that could not see it would have reported the hook as missing
      rather than checking it.
    */
    .filter((p) => /\.tsx?$/.test(p))
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .map((p) => join(SRC, p));
}

/**
 * ⚠️ COMMENTS MUST BE STRIPPED BEFORE ANY OF THESE SCANS, and this is not
 * hypothetical tidiness - it bit this very file.
 *
 * `docs/116` §4: *"the comment explaining why an insert is no longer `active`
 * necessarily quotes `status: 'active'`, so a raw-source match reports the fix
 * as the defect"*. Here, `CampaignCard.tsx` carries a comment explaining that
 * the surfaces render `<FxAttribution>` once - so rule 7b's caller scan found
 * the card itself and demanded a `fromCurrencies` prop on a component it does
 * not render.
 *
 * ⚠️ LINE COMMENTS TOO, and that was a second hole found by injection. The
 * first version stripped `/* *\/` only, so an injection that commented a
 * guard out with `//` left the text in place and the rule stayed green - the
 * §5.1 trap of `docs/149` for the third time. `(?<![:\/])` keeps `https://`
 * and `///` intact, which is the only reason `//` was skipped at first.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:/])\/\/[^\n]*/g, '');
}

const FILES = sourceFiles().map((path) => {
  const src = readFileSync(path, 'utf8');
  return {
    rel: path.slice(SRC.length + 1),
    src,
    /** Comments removed. Use this for anything structural. */
    code: stripComments(src),
  };
});

/** Files that render a card or a grid of them, discovered from disk. */
const RENDERS_A_CARD = FILES.filter(
  (f) => /<CampaignCard\b/.test(f.code) || /<CampaignGrid\b/.test(f.code),
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
    const missing = RENDERS_A_CARD.filter((f) => !/fxSnapshot=/.test(f.code)).map((f) => f.rel);
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
      .filter((f) => !/readFxSnapshot\s*\(/.test(f.code))
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
      const inBatch = /readFxSnapshot\(\),/.test(f.code);
      expect(inBatch, `${f.rel} calls readFxSnapshot() inside an array literal`).toBe(false);
    }
  });

  it('rule 3: the card does not merely ACCEPT the snapshot, it renders with it', () => {
    // The docs/119 / docs/132 shape: a prop declared, destructured away, and
    // never used. Rules 1 and 2 would be fully satisfied by that.
    expect(CARD.code).toMatch(/fxSnapshot\?:/); // declared
    expect(CARD.code).toMatch(/^\s*fxSnapshot,$/m); // destructured
    /*
      ⚠️ `\b` is load-bearing. The first version was `/<LocalAmount/`, and an
      injection renaming the component to `<LocalAmountXX` DID NOT FIRE -
      the broken text still contains the pattern as a substring. Gate 4's
      named trap: a grep that matches both the fixed and the broken version.
    */
    expect(CARD.code).toMatch(/<LocalAmount\b/); // and rendered
    expect(CARD.code).toMatch(/snapshot=\{fxSnapshot/); // with THIS prop, not something else
  });

  it('rule 4: the grid forwards it to the cards it appends in the browser', () => {
    /*
      `CampaignGrid` builds cards client-side after a "Load more" fetch
      (`docs/145`), so a figure rendered on the server reaches page 1 and not
      page 2 - which is the exact shape `docs/115` found on this component
      when appended cards rendered every amount in dollars.
    */
    expect(GRID.code).toMatch(/^\s*fxSnapshot,$/m);
    expect(GRID.code).toMatch(/fxSnapshot=\{fxSnapshot\}/);
  });

  it('rule 6: the card suppresses its own provider credit', () => {
    /*
      `ApproxMoney` renders the credit as an `<a>`, and `CampaignCard` wraps
      its whole body in one `<Link>` - so a credit rendered there is an anchor
      inside an anchor. Measured live on v141 from `Africa/Nairobi`, with New
      York as the control: 8 nested `<a>` on `/campaigns` against 0, and the
      card link's accessible name grew from 127 to 211 characters, ending with
      the provider's name, so a screen reader read it on every card.

      ⚠️ The server HTML was innocent - a USD card renders nothing until
      detection resolves - and React inserted the nested anchor afterwards, so
      the HTML parser never normalised it. Clicking still navigated, which is
      why nothing short of the E2E run noticed.
    */
    expect(CARD.code).toMatch(/hideAttribution/);
  });

  it('rule 7: and every surface that converts still renders the credit ONCE', () => {
    /*
      ⛔ THIS IS THE OTHER HALF OF RULE 6, AND IT IS THE IMPORTANT ONE.

      The credit is a LICENCE TERM (`fx-providers.ts` §TERMS: the free
      endpoint "requires attribution"). Rule 6 on its own would be satisfied
      by a build that shows converted figures and credits nobody - which is a
      breach, and a silent one, because nothing renders differently.

      Three ways to satisfy it, and all three are real in this tree:
        - render `<FxAttribution>` (the homepage, the category page),
        - render `<CampaignGrid>`, which renders it for its own cards
          (`/campaigns`, `/completed-campaigns`),
        - render a `LocalAmount` of its own that does NOT suppress the credit
          (`campaigns/[slug]`, for the campaign's goal - that figure is not
          inside an anchor, so it is valid where it stands).
    */
    const offenders = RENDERS_A_CARD.filter((f) => {
      if (f.rel === 'components/campaign/CampaignCard.tsx') return false; // the card itself
      if (/<FxAttribution\b/.test(f.code)) return false;
      if (/<CampaignGrid\b/.test(f.code)) return false;
      // Its own un-suppressed figure also carries the credit.
      return !(/<LocalAmount\b/.test(f.code) && !/hideAttribution/.test(f.code));
    }).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('rule 7b: the credit follows the FIGURES, not merely the snapshot', () => {
    /*
      ⚠️ My own first version of `FxAttribution` took only the snapshot and
      rendered whenever one existed - so a reader in the United States looking
      at dollar campaigns, who sees NO converted figure at all because
      `LocalAmount` refuses to convert a currency into itself, would have been
      shown a credit for a rate that was never used. A claim about our own
      conduct, on pages that exist to be trusted.

      It therefore asks the same question the figures ask, through the same
      `convertMinor` and the same detection hook. These assertions are what
      stops it drifting back to "a snapshot exists, so print the credit".
    */
    const fx = FILES.find((f) => f.rel === 'components/money/FxAttribution.tsx');
    expect(fx, 'FxAttribution.tsx not found - rules 7 and 7a would be vacuous').toBeDefined();
    /*
      ⚠️ `.code`, not `.src`, and that is load-bearing. The first version read
      raw source, so an injection that merely COMMENTED OUT the guard left the
      text in place and the rule stayed green - the same trap §5.1 of
      `docs/149` recorded against this very file, met a second time.
    */
    expect(fx!.code).toMatch(/useDetectedLocale\(\)/);
    expect(fx!.code).toMatch(/convertMinor\(/);
    expect(fx!.code).toMatch(/if \(!converts\) return null;/);
    // And every call site must tell it which currencies are on the page.
    const callers = FILES.filter((f) => /<FxAttribution\b/.test(f.code));
    expect(callers.length).toBeGreaterThanOrEqual(3);
    for (const c of callers) {
      expect(/fromCurrencies=\{/.test(c.code), `${c.rel} renders FxAttribution without fromCurrencies`).toBe(true);
    }
  });

  it('rule 7c: detection is ONE hook, not a copy per component', () => {
    /*
      `docs/99` §8: the two dark-mode toggles each held their own copy of the
      theme, so using one made the other's next press a silent no-op. Two
      components deciding where the reader is, separately, is the same shape.
    */
    const hook = FILES.find((f) => f.rel === 'components/money/use-detected-locale.ts');
    const local = FILES.find((f) => f.rel === 'components/money/LocalAmount.tsx');
    expect(hook, 'the shared hook is missing').toBeDefined();
    expect(local!.code).toMatch(/useDetectedLocale\(\)/);
    // Neither consumer may re-implement it.
    for (const rel of ['components/money/LocalAmount.tsx', 'components/money/FxAttribution.tsx']) {
      const f = FILES.find((x) => x.rel === rel)!;
      expect(/detectLocale\(/.test(f.code), `${rel} calls detectLocale directly instead of the hook`).toBe(false);
    }
  });

  it('rule 7a: FxAttribution renders nothing without a snapshot, and credits the provider', () => {
    /*
      The anti-vacuity guard for rule 7: a component that rendered
      unconditionally, or that rendered no link at all, would satisfy rule 7
      while being wrong in opposite directions. Rule 7b covers the stronger
      condition (it must follow the FIGURES, not just the snapshot).
    */
    const fx = FILES.find((f) => f.rel === 'components/money/FxAttribution.tsx');
    expect(fx, 'FxAttribution.tsx not found - rule 7 would be vacuous').toBeDefined();
    expect(fx!.code).toMatch(/if \(!snapshot \|\| !detected\) return null;/);
    expect(fx!.code).toMatch(/FX_ATTRIBUTION\.href/);
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
    expect(CARD.code).toMatch(/fallbackCurrency=\{[^}]*'USD'\s*\?\s*null/);
  });
});
