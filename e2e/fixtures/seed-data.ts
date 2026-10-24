/**
 * E2E seed fixture.
 *
 * ## Why this exists
 *
 * The E2E suite had never run anywhere, by anyone (`docs/50`), and when it
 * was finally run against a real database it failed 29 times. The cause was
 * not credentials and not configuration: **the specs seed nothing and assume
 * the database already lists published campaigns.**
 * `e2e-02-guest-donate.spec.ts` is typical — it goes to `/campaigns`, clicks
 * "the first campaign link", and asserts a donate form.
 *
 * That assumption stopped being true in production, not just in CI:
 * `docs/79` moved every campaign to `under_review`, so `/campaigns` is empty
 * by default. The suite was asserting a state the product no longer has.
 *
 * So this fixture supplies that state explicitly, which is what lets the
 * suite mean something. See `docs/99`.
 *
 * ## Why direct inserts, and why that is not a loophole
 *
 * These rows are written straight to the database rather than through
 * `POST /api/v1/user-campaigns`, which would correctly park them in
 * `under_review` behind the review gate (`docs/78`, `docs/79`). That gate is
 * a product rule about what the public may see, not a constraint on test
 * fixtures — `test/helpers.ts` already seeds this way for the integration
 * suite. The gate itself is covered by its own tests, which assert both
 * insert paths write `under_review`; nothing here weakens them.
 *
 * ## Fixed ids, so teardown is exact
 *
 * Every row has a hardcoded uuid and teardown deletes those ids. It does
 * **not** truncate. That is deliberate: a fixture that truncates is one
 * misconfigured `DATABASE_URL` away from destroying real data, which is the
 * accident `docs/98` §6 refused to set up.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { GENERAL_FUND_CAMPAIGN_ID } from '@/lib/constants';

/*
  The general fund is NOT given a fresh uuid. `/donate` looks it up by the
  hardcoded `GENERAL_FUND_CAMPAIGN_ID` and hides the donation form unless a
  row with that exact id is `active` or `last_donor_zone` (docs/42). A
  different id renders the explanatory empty state and nine donate-button
  tests fail on a form that is never there.
*/
const E2E_CAMPAIGN_IDS = [
  GENERAL_FUND_CAMPAIGN_ID,
  'e2e00000-0000-4000-8000-000000000001',
  'e2e00000-0000-4000-8000-000000000002',
  'e2e00000-0000-4000-8000-000000000003',
] as const;

const E2E_BLOG_POST_ID = 'e2e00000-0000-4000-8000-00000000000b';
const E2E_USER_ID = 'e2e00000-0000-4000-8000-00000000000a';
const E2E_UPDATE_ID = 'e2e00000-0000-4000-8000-00000000000c';

/** Slugs are asserted nowhere, but they must be stable for teardown. */
const E2E_SLUG_PREFIX = 'e2e-fixture-';

/*
  The exchange-rate snapshot the local-currency spec needs.

  The key is a LITERAL and not imported, because `FX_SNAPSHOT_KEY` lives in
  `src/lib/money/fx-store.server.ts` behind `import 'server-only'`, which
  throws when this fixture runs under `tsx`. `seed-data.test.ts` asserts the
  literal still equals the real constant, so it cannot drift silently.

  It must be seeded BEFORE `next build`: `campaigns/[slug]` is
  `revalidate = 60` with `generateStaticParams`, so it is prerendered and a
  null snapshot gets baked into the HTML - the same trap docs/99 recorded for
  seeding campaigns after building.

  The rates are round, invented numbers, NOT live ones: a spec that asserts a
  rendered figure cannot depend on today's market. UGX and NGN are here
  because they are KNOWN-but-not-COLLECTABLE, which is the case that broke.
*/
const E2E_FX_KEY = 'fx:usd-rates:v1';
const E2E_FX_RATES = Object.freeze({
  USD: 1,
  KES: 129.84786,
  UGX: 3700,
  NGN: 1600,
  TZS: 2500,
});

/**
 * Refuse to touch anything that is not obviously a throwaway database.
 *
 * This is the most important function in the file. The fixture writes and
 * deletes rows, and the only connection string this project actually has is
 * production (`docs/98` §1). A fixture that trusts whatever `DATABASE_URL`
 * happens to hold is a loaded gun pointed at the live donation ledger.
 *
 * Localhost only, unless someone sets `E2E_ALLOW_NONLOCAL_DB=1` and thereby
 * owns the consequences in writing.
 */
export function assertDatabaseIsDisposable(): void {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'E2E seed: DATABASE_URL is not set. The suite needs a throwaway ' +
        'Postgres; in CI that is the service container, locally any empty ' +
        'database will do.',
    );
  }

  if (process.env.E2E_ALLOW_NONLOCAL_DB === '1') {
    console.warn(
      '[e2e-seed] E2E_ALLOW_NONLOCAL_DB=1 — host check skipped. This fixture ' +
        'INSERTS and DELETES rows. If this is a real database, stop now.',
    );
    return;
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('E2E seed: DATABASE_URL is not a parseable URL.');
  }

  const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);
  if (!LOCAL.has(host)) {
    throw new Error(
      `E2E seed: refusing to seed a non-local database (host "${host}").\n` +
        'This fixture inserts and deletes rows. Point DATABASE_URL at a ' +
        'throwaway Postgres — in CI that is the postgres service container.\n' +
        'If you genuinely mean to seed a remote database, set ' +
        'E2E_ALLOW_NONLOCAL_DB=1 and understand that it will be modified.',
    );
  }
}

/** Remove only this fixture's rows. Never truncates. */
export async function clearE2EData(): Promise<void> {
  assertDatabaseIsDisposable();

  // Donations first: they hold a composite FK onto (campaign_id, currency),
  // so a campaign cannot be deleted from under them.
  await db
    .delete(schema.donations)
    .where(inArray(schema.donations.campaignId, [...E2E_CAMPAIGN_IDS]));

  /*
    Updates explicitly, by campaign, rather than relying on a cascade.
    Whether `campaign_updates.campaign_id` cascades is a schema detail that
    could change; deleting what we inserted is the fixture's own rule, and it
    keeps teardown's "0 rows left" check meaningful.
  */
  await db
    .delete(schema.campaignUpdates)
    .where(inArray(schema.campaignUpdates.campaignId, [...E2E_CAMPAIGN_IDS]));

  await db
    .delete(schema.campaigns)
    .where(inArray(schema.campaigns.id, [...E2E_CAMPAIGN_IDS]));

  await db.delete(schema.blogPosts).where(eq(schema.blogPosts.id, E2E_BLOG_POST_ID));
  await db.delete(schema.users).where(eq(schema.users.id, E2E_USER_ID));

  // The rate snapshot, by its own key only - `site_settings` is shared.
  await db.delete(schema.siteSettings).where(eq(schema.siteSettings.key, E2E_FX_KEY));
}

/**
 * Seed the rows the suite needs. Idempotent: clears its own rows first, so
 * re-running is safe and a crashed run cannot poison the next one.
 */
export async function seedE2EData(): Promise<void> {
  assertDatabaseIsDisposable();
  await clearE2EData();

  /*
    Hero images are LOCAL paths, and that is load-bearing.

    They were `https://example.invalid/e2e-*.webp` - an obviously fake host,
    chosen so the fixture could not reach the network. `next/image` refuses a
    remote host that is not in `images.remotePatterns` and THROWS:

        Error: Invalid src prop (https://example.invalid/e2e-veteran.webp) on
        `next/image`, hostname "example.invalid" is not configured under
        images in your next.config.js

    The card component threw, so `/campaigns` rendered no cards at all - the
    fixture broke the exact page it existed to populate. The rows were in the
    database and the titles were in the server payload, which is why it looked
    like it was working; the hydrated DOM had zero links to any campaign.

    `/images/categories/*` are real files in `public/` that the app already
    serves through the optimiser (`dangerouslyAllowSVG` is on for them), so
    they need no remote pattern and no network. See docs/99 §3.2.
  */
  const now = new Date();
  /* Distinct publish times, because e2e specs and the listing's default
     "newest" sort both read order off `publishedAt`. Identical timestamps
     make the order arbitrary and the assertions flaky. */
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

  await db.insert(schema.users).values({
    id: E2E_USER_ID,
    email: 'e2e-fixture-organiser@example.invalid',
    name: 'E2E Fixture Organiser',
    role: 'donor',
  });

  await db.insert(schema.campaigns).values([
    {
      /*
        The general fund. `/donate` requires this exact id to be donatable,
        and four specs plus the nine donate-button tests depend on the form
        rendering at all.
      */
      id: GENERAL_FUND_CAMPAIGN_ID,
      title: 'General Fund',
      slug: `${E2E_SLUG_PREFIX}general-fund`,
      status: 'active',
      heroImageUrl: '/images/categories/community-hero.webp',
      storyHtml:
        '<p>Fixture row for the end-to-end suite. Giving here pays for ' +
        'campaign review, donor support and keeping the site running.</p>',
      goalAmount: 1_000_000,
      raisedAmount: 250_000,
      donorCount: 12,
      currency: 'USD',
      category: 'community',
      subjectName: 'LastDonor',
      creatorId: E2E_USER_ID,
      publishedAt: minutesAgo(30),
    },
    {
      // A plain mid-progress campaign: the one most specs land on first.
      id: E2E_CAMPAIGN_IDS[1],
      title: 'E2E Fixture: Medical Appeal',
      slug: `${E2E_SLUG_PREFIX}medical-appeal`,
      status: 'active',
      heroImageUrl: '/images/categories/medical-hero.webp',
      storyHtml:
        '<p>Fixture row for the end-to-end suite. It carries enough story ' +
        'text to render the campaign detail page the way a real appeal ' +
        'would, including a progress bar and a donate button.</p>',
      goalAmount: 500_000,
      raisedAmount: 150_000,
      donorCount: 8,
      currency: 'USD',
      category: 'medical',
      location: 'Austin, Texas',
      subjectName: 'Fixture Subject One',
      subjectHometown: 'Austin',
      creatorId: E2E_USER_ID,
      publishedAt: minutesAgo(20),
    },
    {
      /*
        Near its goal. `last_donor_zone` is a real, donatable status and the
        phase the product is named after, so the suite should see one rather
        than only ever meeting `active`.
      */
      id: E2E_CAMPAIGN_IDS[2],
      title: 'E2E Fixture: Veteran Housing, Nearly Funded',
      slug: `${E2E_SLUG_PREFIX}veteran-housing`,
      status: 'last_donor_zone',
      heroImageUrl: '/images/categories/veterans-hero.webp',
      storyHtml:
        '<p>Fixture row for the end-to-end suite, deliberately close to its ' +
        'goal so the last-donor phase has something to render.</p>',
      goalAmount: 400_000,
      raisedAmount: 380_000,
      donorCount: 41,
      currency: 'USD',
      category: 'veterans',
      location: 'Dallas, Texas',
      subjectName: 'Fixture Subject Two',
      subjectHometown: 'Dallas',
      creatorId: E2E_USER_ID,
      publishedAt: minutesAgo(10),
    },
    {
      // Unfunded, so the zero state is exercised rather than only assumed.
      id: E2E_CAMPAIGN_IDS[3],
      title: 'E2E Fixture: Newly Published, No Donations',
      slug: `${E2E_SLUG_PREFIX}newly-published`,
      status: 'active',
      heroImageUrl: '/images/categories/community-default.svg',
      storyHtml:
        '<p>Fixture row for the end-to-end suite with no donations against ' +
        'it, so the unfunded card and sidebar states are covered.</p>',
      goalAmount: 300_000,
      raisedAmount: 0,
      donorCount: 0,
      currency: 'USD',
      category: 'community',
      location: 'Portland, Oregon',
      subjectName: 'Fixture Subject Three',
      creatorId: E2E_USER_ID,
      publishedAt: minutesAgo(5),
    },
  ]);

  /*
    Donations against the two funded campaigns, so `/last-donor-wall` and the
    donor feed have rows. `source: 'real'` on purpose: `seed` donations are
    gated behind SEED_DONATIONS_OPT_IN and excluded from public totals
    (docs/41), so a seed-sourced row would not appear where the specs look.

    `stripePaymentId` is the provider-reference column for every gateway and
    is namespaced per provider (CLAUDE.md), so these use an `e2e_` namespace
    that cannot collide with `pi_`, `payhero_` or `seed_`.
  */
  await db.insert(schema.donations).values([
    {
      campaignId: E2E_CAMPAIGN_IDS[1],
      stripePaymentId: 'e2e_fixture_donation_0001',
      amount: 100_000,
      currency: 'USD',
      donorName: 'Fixture Donor One',
      donorEmail: 'e2e-donor-1@example.invalid',
      phaseAtTime: 'first_believers',
      source: 'real',
    },
    {
      campaignId: E2E_CAMPAIGN_IDS[2],
      stripePaymentId: 'e2e_fixture_donation_0002',
      amount: 380_000,
      currency: 'USD',
      donorName: 'Fixture Donor Two',
      donorEmail: 'e2e-donor-2@example.invalid',
      phaseAtTime: 'last_donor_zone',
      source: 'real',
    },
  ]);

  /*
    One organiser update, so the campaign timeline has something to render.

    `CampaignActivity` renders `<CampaignUpdates>` only when there is at
    least one update, so with none seeded the section is simply absent - and
    `e2e-07-campaign-updates.spec.ts` had nothing it could assert. It
    "passed" by clicking the NAVBAR's Donate link and checking that the
    resulting page had an `h1`, which is true of every page on the site.

    ## Why this does NOT call `insertCampaignUpdate`, and why the counter is
    still incremented

    CLAUDE.md and `docs/89` require campaign updates to be written through
    `insertCampaignUpdate` in `src/lib/echo-counters.ts`, because nothing else
    increments `campaigns.update_count` and `cron/reconcile` would otherwise
    have to repair the drift nightly. That is the right rule and the intent is
    honoured here - but the helper cannot be imported from this file.

    `echo-counters.ts` begins with `import 'server-only'`, which THROWS the
    moment a non-React-Server-Components bundler loads it:

        Error: This module cannot be imported from a Client Component module.
        It should only be used from a Server Component.
          at src/lib/echo-counters.ts:1:8

    `vitest.config.ts` aliases `server-only` away (that fix is `docs/89`'s own
    postscript, after the import silently broke five suites at collection).
    Nothing aliases it for `tsx`, which runs `seed-cli.ts` before the build, or
    for the esbuild transform Playwright uses for `globalSetup` - so importing
    the helper here broke the seed outright.

    So both of the helper's statements are issued here instead, in ONE
    transaction so the row and its counter cannot diverge. The AST ratchet
    walks `src/` only and would not have flagged either version; this comment
    is the thing that stops the next person "simplifying" the second
    statement away.

    `campaign_updates.campaign_id` has NO cascade on its FK, so `clearE2EData`
    has to delete this row explicitly before the campaigns; it does.
  */
  await db.transaction(async (tx) => {
    await tx.insert(schema.campaignUpdates).values({
      id: E2E_UPDATE_ID,
      campaignId: E2E_CAMPAIGN_IDS[1],
      title: 'Fixture Update: the first week',
      bodyHtml:
        '<p>Fixture organiser update for the end-to-end suite, so the campaign ' +
        'timeline has a post to show and the updates section renders.</p>',
      updateType: 'general',
      createdAt: minutesAgo(12),
    });
    await tx
      .update(schema.campaigns)
      .set({ updateCount: sql`${schema.campaigns.updateCount} + 1` })
      .where(eq(schema.campaigns.id, E2E_CAMPAIGN_IDS[1]));
  });

  await db.insert(schema.blogPosts).values({
    id: E2E_BLOG_POST_ID,
    title: 'E2E Fixture: A Published Post',
    slug: `${E2E_SLUG_PREFIX}published-post`,
    bodyHtml:
      '<p>Fixture row for the end-to-end suite, so that <code>/blog</code> ' +
      'has a post to list and a detail page to open.</p>',
    excerpt: 'A fixture post so the blog index and detail page have content.',
    authorName: 'E2E Fixture',
    category: 'impact_report',
    published: true,
    publishedAt: minutesAgo(15),
  });

  /*
    The rate snapshot, in the exact shape `parseFxSnapshot` validates, with
    `asOf` set to now so it sits inside MAX_FX_AGE_HOURS. A stale snapshot
    makes `convertMinor` refuse, and the spec would then be measuring the
    refusal rather than the detection.
  */
  const fxNow = new Date().toISOString();
  const fxValue = {
    base: 'USD' as const,
    rates: { ...E2E_FX_RATES },
    asOf: fxNow,
    provider: 'e2e-fixture',
    fetchedAt: fxNow,
  };
  await db
    .insert(schema.siteSettings)
    .values({ key: E2E_FX_KEY, value: fxValue })
    .onConflictDoUpdate({ target: schema.siteSettings.key, set: { value: fxValue } });
}

/** Exported for the fixture's own test, so the ids cannot drift silently. */
/** Exported for the fixture's own test, so the key cannot drift from the real one. */
export const E2E_FX_FIXTURE = Object.freeze({ key: E2E_FX_KEY, rates: E2E_FX_RATES });

export const E2E_FIXTURE_IDS = {
  campaigns: E2E_CAMPAIGN_IDS,
  blogPost: E2E_BLOG_POST_ID,
  user: E2E_USER_ID,
  campaignUpdate: E2E_UPDATE_ID,
  slugPrefix: E2E_SLUG_PREFIX,
} as const;
