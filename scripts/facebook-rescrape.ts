#!/usr/bin/env tsx
/**
 * Force Facebook to re-read every live campaign page.
 *
 *   FACEBOOK_ACCESS_TOKEN=... npx tsx scripts/facebook-rescrape.ts --dry-run
 *   FACEBOOK_ACCESS_TOKEN=... npx tsx scripts/facebook-rescrape.ts
 *
 * Why it is needed, and why nobody could do it from the agent session, is in
 * `src/lib/facebook-rescrape.ts` and `docs/112` §9.2. In short: Facebook
 * caches the tags and the image bytes per URL, the card was rebuilt, and a
 * re-scrape is the only thing that replaces a cached card.
 *
 * ── Getting a token ──────────────────────────────────────────────────────
 *
 * Any token with no special permission works for scraping a public URL:
 *
 *   1. https://developers.facebook.com/apps - create an app (type "Other" /
 *      "Business") if there is not one already.
 *   2. https://developers.facebook.com/tools/explorer - pick the app and
 *      press "Generate Access Token". A plain App or User token is enough.
 *   3. Export it as FACEBOOK_ACCESS_TOKEN and run this.
 *
 * A short-lived token is fine; the whole run takes seconds.
 *
 * ── What it does and does not do ─────────────────────────────────────────
 *
 * It asks Facebook to re-read OUR OWN public pages. It posts nothing,
 * publishes nothing, and reads no user data. It is safe to re-run.
 *
 * ⛔ The token is sent in the request BODY, never the query string, and
 * every line printed goes through `redactToken` first.
 */
import {
  GRAPH_ENDPOINT,
  classifyScrape,
  heldCardVersion,
  redactToken,
  scrapeBody,
  type ScrapeResult,
} from '../src/lib/facebook-rescrape';
import { CARD_VERSION } from '../src/lib/og-card-metrics';

const SITE = process.env.SITE_URL ?? 'https://lastdonor.org';
const TOKEN = process.env.FACEBOOK_ACCESS_TOKEN ?? '';
const DRY_RUN = process.argv.includes('--dry-run');

/** Graph throttles aggressively; 14 URLs at this spacing is unnoticeable. */
const DELAY_MS = 1_200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The pages to refresh.
 *
 * Read from the live listing API rather than the database, so this runs from
 * any machine with no credentials but the token - which is the point, since
 * the person with the token is not necessarily the person with the database.
 *
 * ⚠️ NOT from `/sitemap.xml`: that currently lists no campaign at all
 * (`docs/112` §10), and a list that is silently short would re-scrape 0 of
 * 14 and report success.
 */
async function liveCampaignUrls(): Promise<string[]> {
  const res = await fetch(`${SITE}/api/v1/campaigns?limit=200`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`campaign listing answered HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ slug?: string }> };
  const rows = Array.isArray(body.data) ? body.data : [];
  const slugs = rows.map((r) => r.slug).filter((s): s is string => typeof s === 'string');
  if (slugs.length === 0) throw new Error('the listing returned no campaigns; refusing to report success over an empty set');
  return slugs.map((s) => `${SITE}/campaigns/${s}`);
}

async function rescrape(url: string): Promise<ScrapeResult> {
  try {
    const res = await fetch(GRAPH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: scrapeBody(url, TOKEN),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        url,
        outcome: 'error',
        detail: `non-JSON body: ${redactToken(text.slice(0, 160), TOKEN)}`,
      };
    }
    return { url, ...classifyScrape(res.status, parsed, TOKEN) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, outcome: 'error', detail: redactToken(message, TOKEN) };
  }
}

async function main() {
  const urls = await liveCampaignUrls();
  console.log(`${urls.length} live campaign pages at ${SITE}\n`);

  if (DRY_RUN) {
    for (const u of urls) console.log(`  would re-scrape  ${u}`);
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  if (!TOKEN) {
    console.error(
      'FACEBOOK_ACCESS_TOKEN is not set.\n'
      + 'Facebook refuses an unauthenticated scrape:\n'
      + '  (#100) Must have a valid access token or a valid url_hmac\n'
      + 'See the header of this file for how to get one, or pass --dry-run.',
    );
    process.exit(2);
  }

  const results: ScrapeResult[] = [];
  for (const [i, url] of urls.entries()) {
    const r = await rescrape(url);
    results.push(r);

    const version = heldCardVersion(r.scraped);
    const versionNote =
      r.outcome !== 'refreshed'
        ? ''
        : version === CARD_VERSION
          ? `  card v${version}`
          : version === null
            ? '  (no image reported)'
            : `  ⚠️ still card v${version}, expected v${CARD_VERSION}`;

    console.log(
      `${String(i + 1).padStart(2)}/${urls.length}  ${r.outcome.padEnd(17)}`
      + `${url.replace(`${SITE}/campaigns/`, '')}${versionNote}`,
    );
    if (r.outcome !== 'refreshed') console.log(`      ${r.detail}`);

    if (i < urls.length - 1) await sleep(DELAY_MS);
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}`);

  const stale = results.filter(
    (r) => r.outcome === 'refreshed' && heldCardVersion(r.scraped) !== null
      && heldCardVersion(r.scraped) !== CARD_VERSION,
  );
  if (stale.length > 0) {
    console.log(
      `\n⚠️ ${stale.length} page(s) refreshed but Facebook still reports an older card`,
    );
  }

  // Non-zero so a wrapper can tell. A refreshed-but-stale page counts as a
  // failure: the call succeeded and the job did not.
  const failed = results.filter((r) => r.outcome !== 'refreshed').length + stale.length;
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(redactToken(err instanceof Error ? err.message : String(err), TOKEN));
  process.exit(1);
});
