/**
 * Where the wizard sends an organiser must be able to show them their campaign.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ──────────────────────────────────────────
 *
 * [VERIFIED 2026-10-25, reported from production] Finishing the create-campaign
 * wizard redirected to `/campaigns/<slug>?launched=true` and the organiser got
 * a **404**, with no confirmation that anything had been received.
 *
 * Nothing threw. The redirect was correct when campaigns went live instantly;
 * `docs/78` and `docs/79` then made every campaign wait for a person, so the
 * row is inserted `under_review` with `published_at: null`, and the public
 * page serves only `active`, `last_donor_zone`, `completed`, `paused`,
 * `suspended` and `cancelled`. A route stopped being reachable as a side
 * effect of work in another file - the `docs/83` shape exactly.
 *
 * ── WHY THIS TEST DERIVES BOTH ENDS ─────────────────────────────────────────
 *
 * The obvious test - "the form redirects to /dashboard/campaigns" - pins
 * today's answer and would be just as stale as the one it replaces the day the
 * review gate is reconsidered. `src/lib/validators/instant-live-architecture.test.ts`
 * is the proof: it asserted `?launched=true` and passed for the whole time the
 * flow was broken.
 *
 * So this reads the status the creation route actually INSERTS, and the
 * statuses the campaign page actually SERVES, and only then decides what the
 * redirect is allowed to be. It stays correct in both directions: restore
 * instant-live and the campaign-page redirect becomes legal again on its own.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

/** Source with comments removed, so prose about the old flow is not evidence. */
function codeOnly(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const formSource = codeOnly('src/app/share-your-story/ShareYourStoryForm.tsx');

/**
 * Where a SUCCESSFUL submission lands.
 *
 * ⚠️ Not simply the first `router.push` in the file: the form also bounces a
 * signed-out visitor to `/login`, and matching that one made this test read
 * the login page and pass for the wrong reason. The success redirect is the
 * one in the submit handler, after the response is known - so it is taken as
 * the LAST push, and the login bounce is asserted to still be a different one.
 */
function successRedirect(): string {
  const all = [...formSource.matchAll(/router\.push\('([^']+)'\)/g)].map((m) => m[1]);
  if (all.length === 0) throw new Error('the wizard never redirects');
  const target = all[all.length - 1];
  if (target.startsWith('/login')) throw new Error('the only redirect found is the sign-in bounce');
  return target;
}
const routeSource = codeOnly('src/app/api/v1/user-campaigns/route.ts');
const campaignPageSource = codeOnly('src/app/campaigns/[slug]/page.tsx');

/** The status `POST /api/v1/user-campaigns` writes for a new campaign. */
function insertedStatus(): string {
  const m = /status:\s*'([a-z_]+)'/.exec(routeSource);
  if (!m) throw new Error('Could not read the inserted status from the creation route');
  return m[1];
}

/** The statuses `/campaigns/[slug]` will render. */
function publiclyServedStatuses(): string[] {
  return [
    ...new Set(
      [...campaignPageSource.matchAll(/eq\(campaigns\.status,\s*'([a-z_]+)'\)/g)].map((m) => m[1]),
    ),
  ];
}

describe('the create-campaign wizard sends organisers somewhere that exists', () => {
  const inserted = insertedStatus();
  const served = publiclyServedStatuses();

  it('reads a real status from each end, so the rule below is not vacuous', () => {
    expect(inserted).toBeTruthy();
    expect(served.length).toBeGreaterThanOrEqual(3);
    // Today: inserted `under_review`, served does not include it.
    expect(served).toContain('active');
  });

  it('⛔ does not redirect to the public campaign page while a new campaign cannot be served there', () => {
    const redirectsToCampaignPage = /router\.push\([^)]*\/campaigns\/\$\{/.test(formSource);

    if (!served.includes(inserted)) {
      expect(
        redirectsToCampaignPage,
        `The creation route inserts status '${inserted}', and /campaigns/[slug] serves only ` +
          `[${served.join(', ')}]. Redirecting there hands the organiser a 404 - which is ` +
          `exactly what production did. Send them to /dashboard/campaigns instead, or change ` +
          `what the route inserts. See docs/109.`,
      ).toBe(false);
    }
  });

  it('redirects somewhere, and to a route that exists in this repo', () => {
    const target = successRedirect().split('?')[0];
    expect(target.startsWith('/')).toBe(true);

    // A page file has to exist for it. This is the half that would have
    // caught a typo'd path, which the old assertion could not.
    const pagePath = resolve(ROOT, `src/app${target}/page.tsx`);
    expect(() => readFileSync(pagePath, 'utf8'), `${target} has no page.tsx`).not.toThrow();
  });

  it('the landing page renders the confirmation the redirect asks for', () => {
    /*
      The param and its reader must agree. `?submitted=1` with nothing reading
      it is the same silent failure in a different place: a redirect that
      lands somewhere real and says nothing.
    */
    const [path, query] = successRedirect().split('?');
    const param = query?.split('=')[0];
    expect(param, 'the redirect should carry a confirmation flag').toBeTruthy();

    const landing = codeOnly(`src/app${path}/page.tsx`);
    expect(landing).toContain('SubmittedForReviewNotice');

    const notice = codeOnly('src/components/dashboard/SubmittedForReviewNotice.tsx');
    expect(notice).toContain(`searchParams.get('${param}')`);
  });
});

describe('the confirmation does not promise what the product does not do', () => {
  const notice = readFileSync(
    resolve(ROOT, 'src/components/dashboard/SubmittedForReviewNotice.tsx'),
    'utf8',
  );
  // Only the rendered copy, not the header explaining why these rules exist.
  // JSX wraps prose across lines, so a sentence spans a newline and two
  // levels of indentation. Collapse it before matching, or every assertion
  // below silently depends on where Prettier happened to break the line.
  const copy = notice.slice(notice.indexOf('return (')).replace(/\s+/g, ' ');

  it('⛔ does not promise an email when the campaign is DECIDED', () => {
    /*
      `docs/93` deleted exactly that promise from the submission receipt,
      because a REFUSED campaign notifies nobody - `under_review` goes only to
      `active` or `suspended`, and the suspend path addresses donors, of which
      an unpublished campaign has none. That is still open. Saying it here
      would re-introduce the sentence that doc removed.
    */
    expect(copy).not.toMatch(/email you (as soon as|when) (it|yours) is decided/i);
    expect(copy).not.toMatch(/tell you exactly what/i);
    expect(copy).not.toMatch(/\bdecision\b/i);
  });

  it('⛔ quotes no turnaround time', () => {
    // docs/78: none is quoted anywhere, deliberately.
    expect(copy).not.toMatch(/\b\d+\s*(hours?|days?|weeks?|business days?)\b/i);
    expect(copy).not.toMatch(/within \w+ (hours?|days?)/i);
  });

  it('⛔ does not call the campaign live, or ask for a share or a donation', () => {
    // Everything LaunchSuccessBanner says, none of which is true yet.
    expect(copy).not.toMatch(/\bis live\b/i);
    expect(copy).not.toMatch(/\bshare it\b/i);
    expect(copy).not.toMatch(/first donation/i);
  });

  it('says the thing that IS true: a person reads it, and it is not public yet', () => {
    expect(copy).toMatch(/person reads every campaign/i);
    expect(copy).toMatch(/not public yet/i);
  });
});

describe('LaunchSuccessBanner fires only where its words are true', () => {
  /*
    The banner says "Your campaign is live", offers the first donation and the
    share buttons. All of it is false for a campaign waiting on review, and
    all of it is true the moment one is approved - so `?launched=true` moved
    off the submission redirect and onto the approval email's link.
  */
  const emails = codeOnly('src/lib/email-templates.ts');

  it('the approval email carries the flag', () => {
    expect(emails).toMatch(/campaigns\/\$\{p\.campaignSlug\}\?launched=true/);
  });

  it('⛔ nothing on the submission path does', () => {
    expect(formSource).not.toContain('launched=true');
    expect(routeSource).not.toContain('launched=true');
  });
});
