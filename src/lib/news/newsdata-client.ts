import { KEYWORD_SETS, type NormalizedNewsItem } from './gnews-client';
import { selectNextKeyword } from './keyword-rotation';
import type { CampaignCategory } from '@/types';

/**
 * NewsData.io — keyword news search with real country coverage.
 *
 * Chosen over GNews in docs/90 and wired on 2026-10-19 once a key
 * existed. Everything below is from probing the live API with our own
 * key on that date, not from the vendor's marketing pages. docs/84 is
 * the standing reason for that: a failed Africa's Talking send answers
 * HTTP 201, which no document mentioned.
 *
 * ── What the free plan actually does (probed 2026-10-19) ─────────────
 *
 *   GET /api/1/latest           200 in ~400ms, 1 credit
 *   X-API-Limit-Remaining       199 after one call  → 200 credits/day
 *   X-RateLimit-Remaining       59                  → a second, shorter window
 *   results                     10 per page (free page size)
 *   country=us,gb,ke,ng,za      returned nigeria 4, usa 5, south africa 1
 *   country with SIX values     422 FilterLimitExceed
 *   q over 100 characters       422 UnsupportedQueryLength
 *   bad key                     401, clean JSON
 *
 * Errors are well-formed JSON with a `results.code`, unlike the
 * provider in docs/84. That is worth knowing and not worth relying on.
 *
 * **`content` is "ONLY AVAILABLE IN PAID PLANS".** We get `description`
 * (a couple of hundred characters) and a real publisher `link`. That is
 * enough, because the pipeline fetches the body itself from the link in
 * step 3b — the same thing it does for RSS items. It is also why
 * Google News RSS was rejected in docs/90: its links are opaque tokens
 * that resolve to 584KB of JavaScript, so there is nothing to fetch.
 *
 * ── The request budget is the design constraint ──────────────────────
 *
 * 200 credits a day against `ingest-news` on `*​/30` (48 runs a day,
 * `src/lib/cron-schedule.ts`) leaves about four credits per run. Three
 * is the cap here: 3 × 48 = 144/day, leaving 56 for manual runs and
 * retries.
 *
 * This is the mistake the GNews client was already making. It issues
 * one request per category — 23 per run, 1,104 a day against a 100/day
 * quota — which would have exhausted by about 02:00 and 429'd until
 * midnight. It had never been noticed because `GNEWS_API_KEY` was never
 * set, so the client threw before reaching the network.
 */

const BASE_URL = 'https://newsdata.io/api/1/latest';

/** Requests per run. See the budget note above before raising this. */
export const MAX_REQUESTS_PER_RUN = 3;

/** The API rejects a `q` longer than this with 422. */
const MAX_QUERY_CHARS = 100;

/** The API rejects more than this many `country` values with 422. */
const MAX_COUNTRIES_PER_REQUEST = 5;

/**
 * Country groups, rotated across runs.
 *
 * Five per request is the free plan's hard limit, so one request can
 * never cover the world. Rotating groups means that over a day the
 * pipeline actually samples markets a relevance-ranked global query
 * would never surface — which is the entire reason for preferring
 * NewsData over GNews, whose `country` parameter accepts 37 values with
 * Egypt the only African one (its own OpenAPI spec, docs/90).
 *
 * ISO 3166-1 alpha-2, which is what the API documents and what the
 * probe confirmed.
 */
const COUNTRY_GROUPS: readonly (readonly string[])[] = [
  ['us', 'ca', 'gb', 'ie', 'au'],
  ['ke', 'ng', 'za', 'gh', 'tz'],
  ['in', 'ph', 'pk', 'bd', 'my'],
  ['de', 'fr', 'es', 'it', 'nl'],
  ['br', 'mx', 'ar', 'co', 'jm'],
];

/** Whether a key is configured at all. */
export function isNewsDataConfigured(): boolean {
  return Boolean(process.env.NEWSDATA_API_KEY);
}

/**
 * Which country group this run uses.
 *
 * Derived from the clock rather than stored, so it needs no table and
 * no migration: `ingest-news` fires on a 30-minute boundary, so the
 * half-hour index advances by one each run and wraps through the
 * groups every 2.5 hours. Exported so a test can pin the rotation
 * without waiting for real time to pass.
 */
export function countryGroupForRun(now: Date = new Date()): readonly string[] {
  const halfHours = Math.floor(now.getTime() / (30 * 60 * 1000));
  return COUNTRY_GROUPS[halfHours % COUNTRY_GROUPS.length];
}

type NewsDataArticle = {
  title?: string;
  link?: string;
  description?: string | null;
  pubDate?: string | null;
  image_url?: string | null;
  source_name?: string | null;
  source_id?: string | null;
};

/**
 * `pubDate` arrives as `2026-10-18 13:35:00`, which `new Date()` parses
 * as LOCAL time — so on a machine in any non-UTC zone every article
 * would be silently hours off, and the pipeline's 14-day freshness
 * filter would drift with the deployment region. The API also returns
 * `pubDateTZ`, which read UTC on every row probed.
 */
function parsePubDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function fetchNewsDataArticles(
  categories?: CampaignCategory[],
): Promise<NormalizedNewsItem[]> {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    throw new Error('NEWSDATA_API_KEY environment variable is not set');
  }

  const all = categories ?? (Object.keys(KEYWORD_SETS) as CampaignCategory[]);
  /*
    Only as many categories as the budget allows, and the rotation in
    `selectNextKeyword` is what stops it being the same few every run:
    the least-recently-used keyword wins, so over a day the pipeline
    works through the whole set rather than re-asking for the first
    three categories 48 times.
  */
  const targets = all.slice(0, MAX_REQUESTS_PER_RUN);
  const countries = countryGroupForRun().slice(0, MAX_COUNTRIES_PER_REQUEST);

  const results: NormalizedNewsItem[] = [];
  let attempted = 0;
  let failed = 0;
  let lastFailure = '';
  let creditsRemaining: string | null = null;

  for (const category of targets) {
    const keywords = KEYWORD_SETS[category];
    if (!keywords?.length) continue;

    const keyword = await selectNextKeyword(category, keywords);
    const params = new URLSearchParams({
      apikey: apiKey,
      // Truncated rather than sent and rejected: a 422 costs a credit
      // for nothing. None of our keywords are near 100 chars today, so
      // this is a guard, not a behaviour anyone will see.
      q: keyword.slice(0, MAX_QUERY_CHARS),
      language: 'en',
      country: countries.join(','),
    });

    attempted++;
    try {
      const response = await fetch(`${BASE_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });

      creditsRemaining = response.headers.get('x-api-limit-remaining') ?? creditsRemaining;

      if (!response.ok) {
        failed++;
        const body = await response.text();
        lastFailure = `HTTP ${response.status} ${body.slice(0, 120)}`;
        console.error(`NewsData error for "${keyword}": ${lastFailure}`);
        continue;
      }

      const data = (await response.json()) as {
        status?: string;
        results?: NewsDataArticle[];
      };

      for (const article of data.results ?? []) {
        // A row without a title or a link is not usable: the pipeline
        // deduplicates on url and classifies on title.
        if (!article.title || !article.link) continue;
        results.push({
          title: article.title,
          url: article.link,
          // `content` is paid-only, so this is the description. The
          // body comes from `fetchArticleBody` on the link later.
          summary: article.description ?? '',
          source: `NewsData:${article.source_name ?? article.source_id ?? 'unknown'}`,
          publishedAt: parsePubDate(article.pubDate),
          imageUrl: article.image_url ?? undefined,
          category,
        });
      }
    } catch (error) {
      failed++;
      lastFailure = String(error).slice(0, 120);
      console.error(`NewsData fetch error for "${keyword}":`, error);
    }
  }

  if (creditsRemaining !== null) {
    // Logged rather than asserted: the number is the vendor's, it is
    // the only honest view of the budget, and a doc that hardcodes it
    // rots (CLAUDE.md on undated vendor numbers).
    console.log(
      `[newsdata] ${attempted} request(s), ${results.length} article(s), ` +
        `countries=${countries.join(',')}, credits remaining today: ${creditsRemaining}`,
    );
  }

  // Every request failed: an outage, not a quiet news cycle. The
  // pipeline's blackout detector keys on this throwing - the same hole
  // that made GNews's detector dead code until docs/90.
  if (attempted > 0 && failed === attempted) {
    throw new Error(`NewsData: all ${attempted} requests failed (last: ${lastFailure})`);
  }

  return results;
}
