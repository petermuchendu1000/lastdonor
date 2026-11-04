/**
 * A campaign's STORED hero URL never reaches `<Image>`.
 *
 * ── WHY THIS SWEEP EXISTS ───────────────────────────────────────────────────
 *
 * `docs/170` moved the decision into the render path and pinned it with tests
 * over the PURE FUNCTION - `resolveCampaignHero` resolves correctly, the panel
 * is not captioned with a named person's crisis, every category has a file.
 * All of that passed, and FOUR render sites went on passing
 * `campaigns.hero_image_url` straight to `<Image src={...} alt={title}>`:
 *
 *   src/app/dashboard/(index)/page.tsx
 *   src/app/dashboard/supported/page.tsx
 *   src/app/dashboard/subscriptions/client.tsx   (x2)
 *
 * Nothing asked *"who else renders a campaign hero?"*, which is the gap
 * `docs/110` §9.2 names: the second instance of one rule is a SWEEP, not a
 * third per-file assertion. Those four are behind auth and `noindex`, so they
 * were never an indexing problem - a donor reading "campaigns you supported"
 * simply saw a stranger's photograph under the beneficiary's name.
 *
 * ⚠️ The sweep is over the RENDER SITES, because that is what the pure-function
 * tests cannot see. A resolver that is correct and uncalled is the defect.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.tsx') && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

/** Comments quote the forbidden shape in order to explain it (`docs/116` §4). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const files = walk(SRC).map((path) => ({
  path: path.slice(process.cwd().length + 1),
  code: stripComments(readFileSync(path, 'utf8')),
}));

/**
 * Every `<Image …>` / `<img …>` tag in a file, as whole tags.
 *
 * ⚠️ It walks to the `>` that closes the TAG, tracking brace depth, rather
 * than taking the first `>` - JSX routinely contains one inside
 * `onError={() => …}`, which is `docs/153` §5's trap and would truncate the
 * tag before its `src` (or, worse, end it early and read the next element's).
 */
function imageTags(code: string): string[] {
  const out: string[] = [];
  const opener = /<(?:Image|img)\b/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(code)) !== null) {
    let depth = 0;
    for (let i = m.index; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) {
        out.push(code.slice(m.index, i + 1));
        break;
      }
    }
  }
  return out;
}

/**
 * A `src` bound to something named `heroImageUrl`.
 *
 * ⛔ The subject is the real image ELEMENT, not any component: the first
 * version of this rule matched `src={…}` on anything and flagged THREE
 * correct call sites that pass the stored URL into `<CampaignHeroImage>`,
 * which is the component whose whole job is to resolve it. The rule was
 * wrong, not the code (`docs/119`, `docs/134`).
 */
const STORED_HERO_SRC = /\bsrc=\{[^}]*\b[hH]eroImageUrl\b[^}]*\}/;

/**
 * The two `heroImageUrl` values that are NOT a campaign's stored column.
 *
 * ⚠️ Neither is a bare allowlist entry. Each exemption is re-checked below
 * against the property it rests on, so it fails rather than silently covering
 * a real defect if that property stops holding (`docs/165`: an allowlist is a
 * hole).
 */
const NOT_A_STORED_CAMPAIGN_HERO: Record<string, string> = {
  // Site art committed under public/images/categories/, same field name.
  'src/components/campaign/CategoryHeroSection.tsx': 'CATEGORY_CONTENT',
  // The create wizard previewing the photo the organiser just chose.
  'src/app/share-your-story/ShareYourStoryForm.tsx': 'unsaved form state',
};

describe('⛔ the stored hero URL never reaches an image element', () => {
  it('no <Image>/<img> is bound to a campaign heroImageUrl', () => {
    const offenders = files
      .filter((f) => !(f.path in NOT_A_STORED_CAMPAIGN_HERO))
      .flatMap((f) =>
        imageTags(f.code)
          .filter((tag) => STORED_HERO_SRC.test(tag))
          .map((tag) => `${f.path}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`),
      );

    expect(
      offenders,
      `these render the STORED column; resolve with resolveCampaignHero first (docs/170):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('⚠️ CONTROL: passing the stored URL to <CampaignHeroImage> is CORRECT', () => {
    /*
      That component resolves internally, so three legitimate call sites pass
      it the raw column. An earlier version of this rule flagged all three.
      Pinned so the rule can never be "fixed" by widening it back.
    */
    const viaResolver = files.filter(
      (f) => /<CampaignHeroImage[\s\S]{0,200}?[hH]eroImageUrl/.test(f.code),
    );
    expect(viaResolver.length).toBeGreaterThanOrEqual(3);
    for (const f of viaResolver) {
      expect(
        imageTags(f.code).filter((t) => STORED_HERO_SRC.test(t)),
        `${f.path} should pass through the resolver, not a raw <Image>`,
      ).toEqual([]);
    }
  });

  it('⚠️ CONTROL: the sweep can see a src binding at all', () => {
    /*
      Anti-vacuity. The rule above is an emptiness assertion, so a scanner
      that matched nothing - a bad glob, a comment stripper that ate the
      file - would satisfy it silently (`docs/163` §5.1).
    */
    expect(files.length).toBeGreaterThan(50);
    const anySrcBinding = files.filter((f) => /\bsrc=\{/.test(f.code));
    expect(anySrcBinding.length).toBeGreaterThan(5);

    // And the scanner must really see the shape it forbids, including one
    // whose tag carries a `>` inside a brace before its src.
    const trap = '<Image onError={() => setX(1)} src={c.heroImageUrl} alt="x" />';
    const seen = imageTags(trap);
    expect(seen, 'the brace-aware scanner lost the tag').toHaveLength(1);
    expect(STORED_HERO_SRC.test(seen[0])).toBe(true);
  });

  it('⚠️ the comment stripper is still removing something', () => {
    const raw = readFileSync(join(SRC, 'lib/campaign-hero.ts'), 'utf8');
    expect(raw.length - stripComments(raw).length).toBeGreaterThan(500);
  });
});

describe('⚠️ each exemption is re-derived, not asserted', () => {
  it.each(Object.keys(NOT_A_STORED_CAMPAIGN_HERO))(
    '%s still exists, so the entry cannot go stale unnoticed',
    (path) => {
      expect(
        files.find((f) => f.path === path),
        `${path} is gone - drop the exemption`,
      ).toBeDefined();
    },
  );

  it('⛔ CategoryHeroSection reads CATEGORY_CONTENT, never a campaign row', () => {
    /*
      `CATEGORY_CONTENT[...].heroImageUrl` is site art committed under
      `public/images/categories/` - the same FIELD NAME as the campaigns
      column and a completely different thing.
    */
    const code =
      files.find((f) => f.path === 'src/components/campaign/CategoryHeroSection.tsx')?.code ?? '';
    expect(code).toMatch(/CATEGORY_CONTENT|CategoryContent/);
    expect(code).not.toMatch(/\bcampaigns\.heroImageUrl\b/);
    expect(code).not.toMatch(/from '@\/db'/);
  });

  it('⛔ the wizard previews UNSAVED form state, not a stored row', () => {
    /*
      The organiser has just chosen that photo; showing it back to them is
      the point of a preview. It is not a campaign row - the campaign does
      not exist yet - so `docs/170` does not apply until it is submitted and
      a public surface renders it.
    */
    const code =
      files.find((f) => f.path === 'src/app/share-your-story/ShareYourStoryForm.tsx')?.code ?? '';
    expect(code).toMatch(/src=\{form\.heroImageUrl\}/);
    expect(code).not.toMatch(/from '@\/db'/);
  });
});

describe('the resolver is actually CALLED where campaigns are listed', () => {
  /*
    The mirror of the rule above: deleting every `<Image>` would satisfy an
    emptiness assertion, so these four sites must still resolve a hero.
  */
  const MUST_RESOLVE = [
    'src/app/dashboard/(index)/page.tsx',
    'src/app/dashboard/supported/page.tsx',
    'src/app/dashboard/subscriptions/page.tsx',
    'src/components/campaign/CampaignHeroImage.tsx',
  ];

  it.each(MUST_RESOLVE)('%s calls resolveCampaignHero', (path) => {
    const f = files.find((x) => x.path === path);
    expect(f, `${path} not found`).toBeDefined();
    expect(f?.code).toMatch(/resolveCampaignHero\s*\(/);
  });
});
