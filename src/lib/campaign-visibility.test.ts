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
  const PUBLISHED = new Date('2026-10-01T00:00:00Z');

  it('answers true for every served status, once it was published', () => {
    for (const status of PUBLICLY_VIEWABLE_STATUSES) {
      expect(hasPublicPage({ status, publishedAt: PUBLISHED }), status).toBe(true);
    }
  });

  it('⛔ answers FALSE for every served status while published_at is null', () => {
    /*
      `docs/131`. A status allowlist cannot answer "did a person approve this",
      and four routes move a `draft` or `under_review` campaign into
      `suspended` or `archived` - the first of them being the DOCUMENTED
      refusal path. So every one of these was served for a campaign nobody had
      read.
    */
    for (const status of PUBLICLY_VIEWABLE_STATUSES) {
      expect(hasPublicPage({ status, publishedAt: null }), status).toBe(false);
    }
  });

  it('answers false for a campaign still in the queue', () => {
    expect(hasPublicPage({ status: 'under_review', publishedAt: null })).toBe(false);
    expect(hasPublicPage({ status: 'draft', publishedAt: null })).toBe(false);
  });

  it('⛔ a publication date does NOT make an unserved status public', () => {
    // The control on the rule above: the two predicates are an AND, so a
    // campaign restored to `draft` (`ALLOWED_TRANSITIONS` permits
    // `active -> draft`) keeps its date and still has no page.
    expect(hasPublicPage({ status: 'draft', publishedAt: PUBLISHED })).toBe(false);
    expect(hasPublicPage({ status: 'under_review', publishedAt: PUBLISHED })).toBe(false);
  });

  it('⚠️ accepts an ISO string as well as a Date', () => {
    // The same row is read on both sides of the serialization boundary: a
    // server component holds a Date, a client component handed it through
    // props holds a string. A string-rejecting guard would hide every live
    // campaign's link in the dashboard.
    expect(hasPublicPage({ status: 'active', publishedAt: '2026-10-01T00:00:00.000Z' })).toBe(true);
  });

  it('⛔ fails toward hiding the link, not toward a 404', () => {
    /*
      Direction matters. A hidden "View" button is a missing convenience; a
      shown one that 404s is the platform handing the organiser a dead page
      for their own appeal, which is the defect this came from.
    */
    expect(hasPublicPage({ status: null, publishedAt: PUBLISHED })).toBe(false);
    expect(hasPublicPage({ status: undefined, publishedAt: PUBLISHED })).toBe(false);
    expect(hasPublicPage({ status: '', publishedAt: PUBLISHED })).toBe(false);
    expect(hasPublicPage({ status: 'something_new', publishedAt: PUBLISHED })).toBe(false);
    expect(hasPublicPage({ status: 'active', publishedAt: undefined })).toBe(false);
    expect(hasPublicPage({ status: 'active', publishedAt: '' })).toBe(false);
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

  /*
    ⚠️ AMENDED 2026-10-30 (`docs/154`). These two used to assert the OLD shape:
    that the file contained `hasPublicPage({ status: c.status, ... })` and that
    there was EXACTLY ONE hand-written `` href={`/campaigns/${…}`} `` sitting
    after it in the text.

    Both are now false, and the code is what moved - in the stronger
    direction. The dashboard builds its links with `publicCampaignPath`, which
    returns `string | null`, so there is no hand-written href to be "inside"
    or "outside" a guard. The positional assertion was also the weaker claim:
    an href merely appearing LATER in the file than a guard call is not the
    same as being governed by it, and four injections proved a position/count
    rule cannot see a per-link regression (`docs/154` §6).

    What they assert now is the property: the builder is called, and no
    hand-written campaign href exists in this file at all.
  */
  it('builds the public link with publicCampaignPath', () => {
    expect(list).toContain('publicCampaignPath({');
    expect(list, 'the resolved href must be what is rendered').toContain('href={publicHref}');
  });

  it('⛔ has no hand-written link to the public campaign page', () => {
    const links = [...list.matchAll(/href=\{`\/campaigns\/\$\{[^}]+\}`\}/g)];
    expect(links.length, `hand-written campaign hrefs: ${links.map((m) => m[0]).join(', ')}`).toBe(0);
  });

  it('⚠️ the control: this file really is the campaign list being read', () => {
    /*
      Without this the two rules above pass against an empty read, a renamed
      file, or a component that renders no campaign rows at all.
    */
    expect(list.length, 'the file read is empty - both rules above are vacuous').toBeGreaterThan(2000);
    expect(list, 'not the campaign list any more').toContain('filtered.map((c) => {');
    expect(list, 'the View control is gone entirely').toContain('View');
  });
});
