/**
 * The shared list of publicly-served statuses must match the page query.
 *
 * ── WHY THE LIST IS PARSED AND NOT RETYPED ──────────────────────────────────
 *
 * `PUBLICLY_VIEWABLE_STATUSES` exists so a link to `/campaigns/<slug>` can be
 * written without guessing what that page serves - but a second copy of a list
 * is exactly how the original defect happened (`docs/109`): the wizard's
 * redirect and the dashboard's "View" button were both written against a
 * notion of the page that had stopped being true.
 *
 * So the constant is checked against the page's OWN query, read from source.
 * If anybody adds a status to one and not the other, this fails and names it.
 *
 * ⚠️ The campaign page builds its filter inline with `or(eq(...))` rather than
 * importing this constant. That is deliberate for now: refactoring the query
 * that gates the whole public page is a bigger change than this one, and this
 * test gives the same guarantee without touching it. If that query is ever
 * rewritten to use the constant, delete the parsing half - do not leave it
 * asserting that the constant equals itself.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PUBLICLY_VIEWABLE_STATUSES, hasPublicPage } from '@/lib/campaign-visibility';

const ROOT = resolve(__dirname, '../..');

/** The `getCampaign` filter in the public campaign page, read from source. */
function servedByThePage(): string[] {
  const source = readFileSync(resolve(ROOT, 'src/app/campaigns/[slug]/page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // `getCampaign` is the lookup that decides 404 vs page. `generateStaticParams`
  // and `generateMetadata` have their own, narrower filters above it, so take
  // the one inside getCampaign specifically.
  const start = source.indexOf('async function getCampaign');
  expect(start, 'getCampaign not found in the campaign page').toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf('\n}', start));

  return [
    ...new Set([...body.matchAll(/eq\(campaigns\.status,\s*'([a-z_]+)'\)/g)].map((m) => m[1])),
  ];
}

describe('PUBLICLY_VIEWABLE_STATUSES', () => {
  it('is exactly what the campaign page serves', () => {
    const served = servedByThePage();
    expect(served.length, 'parsed no statuses - the query shape changed').toBeGreaterThan(2);
    expect([...served].sort()).toEqual([...PUBLICLY_VIEWABLE_STATUSES].sort());
  });

  it('⛔ excludes the statuses a new campaign has', () => {
    // The whole point: these are what `docs/78`/`docs/79` made the default,
    // and linking to the public page for either is a 404.
    expect(PUBLICLY_VIEWABLE_STATUSES).not.toContain('under_review');
    expect(PUBLICLY_VIEWABLE_STATUSES).not.toContain('draft');
  });

  it('keeps suspended and cancelled, which the page explains rather than hides', () => {
    expect(PUBLICLY_VIEWABLE_STATUSES).toContain('suspended');
    expect(PUBLICLY_VIEWABLE_STATUSES).toContain('cancelled');
  });

  it('⛔ keeps archived, for the same reason (docs/118 §9)', () => {
    /*
      Added 2026-10-27, owner decision. `archived` is the status a CLOSED
      campaign holds, and `campaignArchivedEmail` tells its donors "We have a
      record of every donation, including yours" - so a 404 was the one answer
      that contradicted the message they had just been sent. It had been
      omitted from this list rather than decided against: the doc comment
      above already made this exact argument for `suspended` and `cancelled`.
    */
    expect(PUBLICLY_VIEWABLE_STATUSES).toContain('archived');
  });

  it('⛔ serving a status is NOT indexing it', () => {
    /*
      The control on the change above. Making a status viewable must not have
      put it in the sitemap or marked it indexable - a URL that is both
      submitted in a sitemap and served `noindex` is a contradiction Google
      reports. Both narrower lists are read from source.
    */
    const page = readFileSync(resolve(ROOT, 'src/app/campaigns/[slug]/page.tsx'), 'utf8');
    const indexable = /const isIndexable = \[([^\]]*)\]/.exec(page);
    expect(indexable, 'isIndexable not found - the page changed shape').toBeTruthy();
    expect(indexable![1]).not.toContain('archived');
    expect(indexable![1]).not.toContain('suspended');
    expect(indexable![1]).not.toContain('cancelled');

    const sitemap = readFileSync(resolve(ROOT, 'src/app/sitemap.ts'), 'utf8');
    const live = /LIVE_SITEMAP_STATUSES = \[([^\]]*)\]/.exec(sitemap);
    const closed = /CLOSED_SITEMAP_STATUSES = \[([^\]]*)\]/.exec(sitemap);
    expect(live, 'LIVE_SITEMAP_STATUSES not found').toBeTruthy();
    expect(closed, 'CLOSED_SITEMAP_STATUSES not found').toBeTruthy();
    expect(live![1] + closed![1]).not.toContain('archived');
  });
});

describe('hasPublicPage', () => {
  it('answers true for every served status', () => {
    for (const status of PUBLICLY_VIEWABLE_STATUSES) {
      expect(hasPublicPage(status), status).toBe(true);
    }
  });

  it('answers false for a campaign still in the queue', () => {
    expect(hasPublicPage('under_review')).toBe(false);
    expect(hasPublicPage('draft')).toBe(false);
  });

  it('⛔ fails toward hiding the link, not toward a 404', () => {
    /*
      Direction matters. A hidden "View" button is a missing convenience; a
      shown one that 404s is the platform handing the organiser a dead page
      for their own appeal, which is the defect this came from.
    */
    expect(hasPublicPage(null)).toBe(false);
    expect(hasPublicPage(undefined)).toBe(false);
    expect(hasPublicPage('')).toBe(false);
    expect(hasPublicPage('something_new')).toBe(false);
  });
});

describe('the dashboard uses it', () => {
  /*
    Read as TEXT, in the style of docs/91's social-link tests: the predicate
    being right is worth nothing if the component stops calling it, and the
    type system cannot notice - an unconditional <Link> compiles perfectly.
  */
  const list = readFileSync(
    resolve(ROOT, 'src/components/dashboard/CampaignsListClient.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('gates the public link on hasPublicPage', () => {
    expect(list).toContain('hasPublicPage(c.status)');
  });

  it('⛔ has no ungated link to the public campaign page', () => {
    const links = [...list.matchAll(/href=\{`\/campaigns\/\$\{[^}]+\}`\}/g)];
    expect(links.length, 'expected exactly one public campaign link').toBe(1);
    // ...and it sits inside the guard.
    const guard = list.indexOf('hasPublicPage(c.status)');
    expect(guard).toBeGreaterThan(-1);
    expect(links[0].index!).toBeGreaterThan(guard);
  });
});
