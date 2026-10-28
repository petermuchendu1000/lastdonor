/**
 * A campaign has no public page until a person approved its publication.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `PUBLICLY_VIEWABLE_STATUSES` is a status allowlist, and a status allowlist
 * answers the wrong question. It says *"would this page render a campaign in a
 * state like this one"*; it cannot say *"did anybody read this before it went
 * public"*. Three of its seven entries are reachable from a campaign nobody
 * ever read, by four different routes - and the FIRST of them is the
 * documented refusal path (`docs/93`, owner decision):
 *
 *   `under_review` -> `suspended`   POST   .../[campaignId]/suspend
 *   `under_review` -> `archived`    DELETE /api/v1/user-campaigns/[id]
 *   `draft`        -> `archived`    PATCH  .../[campaignId]
 *   `draft`        -> `archived`    DELETE /api/v1/campaigns/[slug]
 *
 * So the one action that means *"no, this may not be published"* published it.
 * [VERIFIED by execution against a production build, `docs/131`] a `suspended`
 * campaign with `published_at IS NULL` answered **HTTP 200**, rendered the
 * whole appeal about its named subject, and printed `suspendedReason` - the
 * admin's own typed words - on the page. Controls held: the same row answered
 * 404 as `under_review` before and after.
 *
 * Meanwhile `campaignRefusedEmail` tells the organiser, verbatim: *"Your
 * campaign is not public. Nobody can see it or give to it."*
 *
 * ── WHY THESE TESTS AND NOT A FIFTH GUARD ───────────────────────────────────
 *
 * `docs/120` §5 had already made this argument and acted on it for ONE door -
 * it removed `under_review` from `CANCELLABLE` because "`cancelled` is
 * publicly viewable". It did not sweep the sibling route it designated as the
 * refusal path in the same breath. Guarding doors one at a time is how four of
 * them came to be open, so the rule is asserted about the PAGE: its lookup
 * requires `published_at`, which `docs/120` pinned to exactly two UPDATE
 * writers.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PUBLICLY_VIEWABLE_STATUSES, hasPublicPage } from '@/lib/campaign-visibility';
import { publicCampaignPath } from '@/lib/campaign-links';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) =>
  readFileSync(resolve(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const PUBLISHED = new Date('2026-10-01T00:00:00Z');

describe('⛔ the page itself refuses an unpublished campaign', () => {
  /*
    Read from the page's own `getCampaign`, the lookup that decides 404 vs
    page. `campaign-visibility.test.ts` already derives the STATUS half from
    the same function; this is the other half of the same predicate, and
    without it that test passes while the page serves campaigns nobody read.
  */
  const page = read('src/app/campaigns/[slug]/page.tsx');
  const start = page.indexOf('async function getCampaign');
  const body = page.slice(start, page.indexOf('\n}', start));

  it('⚠️ the control: getCampaign was found and has a where clause', () => {
    // Both assertions below are substring checks, and a substring check
    // against an empty string fails for the wrong reason - or, if inverted,
    // passes for no reason. `docs/123`: check the input.
    expect(start, 'getCampaign not found - the page changed shape').toBeGreaterThan(-1);
    expect(body).toContain('.where(');
    expect(body).toContain("eq(campaigns.status, 'active')");
  });

  it('requires isNotNull(campaigns.publishedAt)', () => {
    expect(
      body.replace(/\s+/g, ' '),
      'the public campaign lookup no longer requires a publication date - see docs/131',
    ).toContain('isNotNull(campaigns.publishedAt)');
  });
});

describe('⛔ the guards agree with the page', () => {
  it('every served status is refused while published_at is null', () => {
    for (const status of PUBLICLY_VIEWABLE_STATUSES) {
      expect(hasPublicPage({ status, publishedAt: null }), status).toBe(false);
      expect(
        publicCampaignPath({ slug: 'help-ada', status, publishedAt: null }),
        status,
      ).toBeNull();
    }
  });

  it('⚠️ the control: each of them IS allowed once it was published', () => {
    // Without this, a guard that answers null for everything would satisfy
    // the rule above by linking nothing at all - and `docs/118` is explicit
    // that a hidden link is a cost, not a free win.
    for (const status of PUBLICLY_VIEWABLE_STATUSES) {
      expect(hasPublicPage({ status, publishedAt: PUBLISHED }), status).toBe(true);
      expect(
        publicCampaignPath({ slug: 'help-ada', status, publishedAt: PUBLISHED }),
        status,
      ).toBe('/campaigns/help-ada');
    }
  });
});

describe('⛔ the doors this exists for are still open', () => {
  /*
    THE CONTROL THAT MAKES THE RULE MEAN SOMETHING. If every route that can
    move a never-published campaign into a served status were closed, the
    predicate above would be belt-and-braces and these tests would be
    vacuously true forever. They are not: both admin-facing doors are read
    from source here, and if somebody closes them this fails and says so -
    which is the moment to re-read `docs/131` before touching the predicate.
  */
  it('`suspend` still accepts an under_review campaign (the refusal path)', () => {
    const suspend = read('src/app/api/v1/admin/campaigns/[campaignId]/suspend/route.ts');
    const list = /const SUSPENDABLE[^=]*=\s*\[([^\]]*)\]/.exec(suspend);
    expect(list, 'SUSPENDABLE not found - the suspend route changed shape').toBeTruthy();
    expect(list![1]).toContain('under_review');
    // ...and `suspended` is a status the page serves, which is the other half.
    expect(PUBLICLY_VIEWABLE_STATUSES).toContain('suspended');
  });

  it('PATCH still allows draft -> archived', () => {
    const admin = read('src/app/api/v1/admin/campaigns/[campaignId]/route.ts');
    const table = admin.slice(
      admin.indexOf('const ALLOWED_TRANSITIONS'),
      admin.indexOf('};', admin.indexOf('const ALLOWED_TRANSITIONS')),
    );
    expect(table, 'ALLOWED_TRANSITIONS not found').toContain('draft:');
    expect(/draft:\s*\[[^\]]*'archived'/.test(table)).toBe(true);
    expect(PUBLICLY_VIEWABLE_STATUSES).toContain('archived');
  });

  it('⛔ and a draft has no publication date to be served on', () => {
    // The composition, stated as one assertion: the door leads somewhere the
    // page serves, and the thing that stops it is this predicate alone.
    expect(hasPublicPage({ status: 'archived', publishedAt: null })).toBe(false);
    expect(hasPublicPage({ status: 'suspended', publishedAt: null })).toBe(false);
  });
});

describe('⛔ the refusal email keeps its promise', () => {
  /*
    `campaignRefusedEmail` states a fact about the platform's behaviour, which
    CLAUDE.md treats as a factual assertion rather than microcopy. It was false
    for the whole life of the refusal path. Tied to the behaviour here in the
    shape of `organiser-promises.test.ts` and `account-promises.test.ts`:
    derive both ends, so building either one differently fails the other.
  */
  const templates = readFileSync(resolve(ROOT, 'src/lib/email-templates.ts'), 'utf8');
  const refusedAt = templates.indexOf('export function campaignRefusedEmail');
  /*
    ⚠️ Sliced to the NEXT exported function, not to the first `\n}`. That first
    brace closes the PARAMETER OBJECT (`campaignRefusedEmail(p: { ... })`), so
    the naive slice captured the signature and none of the copy - and the
    `toContain` below then failed for a reason that had nothing to do with the
    template.
  */
  const refused = templates.slice(
    refusedAt,
    templates.indexOf('\nexport ', refusedAt + 1),
  );

  it('⚠️ the control: the template was found', () => {
    expect(refused.length, 'campaignRefusedEmail not found').toBeGreaterThan(200);
  });

  it('still promises the campaign is not public', () => {
    expect(refused.replace(/\s+/g, ' ')).toContain('Your campaign is not public');
  });

  it('⛔ and the status it promises that about has no public page', () => {
    /*
      A refusal writes `suspended` and leaves `published_at` null - it is a
      campaign that was never live. So the promise holds only because of the
      publication predicate; the status alone contradicts it.
    */
    expect(hasPublicPage({ status: 'suspended', publishedAt: null })).toBe(false);
    expect(
      publicCampaignPath({ slug: 'help-ada', status: 'suspended', publishedAt: null }),
    ).toBeNull();
  });

  it('⚠️ while a LIVE campaign suspended for investigation keeps its page', () => {
    /*
      `docs/93`: "one status, two situations". Suspending a live campaign is an
      investigation whose donors must be told their money is safe, and the
      page renders that notice. `published_at` is the discriminator `docs/93`
      said the status could not carry - so this needs no new status and takes
      nothing away from `docs/118` §9.
    */
    expect(hasPublicPage({ status: 'suspended', publishedAt: PUBLISHED })).toBe(true);
  });
});
