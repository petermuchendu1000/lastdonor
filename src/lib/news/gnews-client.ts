import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { CampaignCategory } from '@/types';
import { selectNextKeyword } from './keyword-rotation';

export type NormalizedNewsItem = {
  title: string;
  url: string;
  summary: string;
  source: string;
  publishedAt: Date | null;
  imageUrl?: string;
  category?: CampaignCategory;
};

export const KEYWORD_SETS: Record<CampaignCategory, string[]> = {
  military: [
    'military casualty',
    'soldier killed',
    'marine killed',
    'service member killed',
    'military family',
  ],
  veterans: [
    'veteran needs help',
    'homeless veteran',
    'veteran medical',
    'veteran struggling',
  ],
  'first-responders': [
    'firefighter killed',
    'officer killed in the line of duty',
    'paramedic killed',
    'first responder dies',
  ],
  disaster: [
    'tornado victims',
    'hurricane damage families',
    'wildfire evacuation',
    'flood victims need help',
    'apartment fire displaced',
  ],
  medical: [
    'can\'t afford surgery',
    'medical bills fundraiser',
    'cancer diagnosis family',
    'uninsured accident victim',
    'child needs transplant',
  ],
  memorial: [
    'funeral fundraiser',
    'can\'t afford funeral',
    'burial costs family',
    'GoFundMe funeral',
    'young parent dies',
  ],
  community: [
    'hit by drunk driver',
    'shooting victim family',
    'domestic violence survivor',
    'crime victim fundraiser',
  ],
  'essential-needs': [
    'family facing eviction',
    'utilities shutoff',
    'can\'t pay rent',
    'job loss family',
    'food insecurity',
  ],
  emergency: [
    'emergency rescue',
    'urgent help needed family',
    'emergency evacuation',
    'crisis situation family',
    'sudden emergency fundraiser',
  ],
  charity: [
    'charity fundraiser',
    'nonprofit helping families',
    'charitable donation drive',
    'community charity event',
  ],
  education: [
    'can\'t afford tuition',
    'scholarship fundraiser',
    'student needs help',
    'school supplies fundraiser',
    'education fundraiser underprivileged',
  ],
  animal: [
    'animal rescue fundraiser',
    'veterinary bills help',
    'abandoned pets shelter',
    'injured animal needs surgery',
    'wildlife rescue effort',
  ],
  environment: [
    'environmental cleanup fundraiser',
    'community garden project',
    'pollution victims fundraiser',
    'clean water initiative',
  ],
  business: [
    'small business fire damage',
    'family business destroyed',
    'shop owner needs help rebuilding',
    'local business fundraiser',
  ],
  competition: [
    'athlete needs funding competition',
    'team fundraiser tournament',
    'student competition travel costs',
    'robotics team fundraiser',
  ],
  creative: [
    'artist fundraiser medical bills',
    'musician needs help',
    'art studio destroyed fundraiser',
    'creative project community funding',
  ],
  event: [
    'benefit event fundraiser',
    'community event disaster relief',
    'memorial event fundraiser',
    'charity run walk fundraiser',
  ],
  faith: [
    'church rebuilding fundraiser',
    'congregation helping family',
    'faith community fundraiser',
    'religious organization relief',
  ],
  family: [
    'family in crisis needs help',
    'single parent struggling',
    'family lost everything',
    'orphaned children fundraiser',
    'family medical emergency',
  ],
  sports: [
    'injured athlete fundraiser',
    'youth sports team fundraiser',
    'athlete recovery fundraiser',
    'coach memorial fundraiser',
  ],
  travel: [
    'family emergency travel costs',
    'medical travel fundraiser',
    'stranded traveler needs help',
    'reunion travel fundraiser',
  ],
  volunteer: [
    'volunteer organization fundraiser',
    'volunteer mission trip funding',
    'community volunteer project',
    'humanitarian volunteer effort',
  ],
  wishes: [
    'dying wish fundraiser',
    'make a wish family',
    'bucket list fundraiser terminally ill',
    'last wish fundraiser',
  ],
};

// Categories inherently scoped to the US (military branch-specific, US VA, US first responders)
const US_ONLY_CATEGORIES = new Set<CampaignCategory>([
  'military',
  'veterans',
  'first-responders',
]);

const GNEWS_BASE_URL = 'https://gnews.io/api/v4/search';

/**
 * Requests per run, against a free quota of 100 per DAY.
 *
 * `ingest-news` runs 48 times a day, so this must stay at 1 or the
 * quota is gone before morning. Read the note in `fetchGNewsArticles`
 * before changing it.
 */
export const MAX_REQUESTS_PER_RUN = 1;

/**
 * Whether a GNews key is configured at all.
 *
 * GNews is an optional source. Calling `fetchGNewsArticles` without a
 * key throws, and the pipeline used to record that throw as a source
 * failure every run - a warning-severity audit row every 30 minutes
 * about a key nobody had set. Callers check this first and skip the
 * source instead, so `pipeline.source_failures` means a source that
 * actually failed.
 *
 * Coverage note (verified 2026-10-18 against GNews's own OpenAPI
 * specification at docs.gnews.io/openapi.yaml): the `country`
 * parameter accepts 37 values and `lang` accepts 26. Egypt is the only
 * African country in the list. See docs/90 for what that ruled in and
 * out.
 */
export function isGNewsConfigured(): boolean {
  return Boolean(process.env.GNEWS_API_KEY);
}

export async function fetchGNewsArticles(
  categories?: CampaignCategory[],
): Promise<NormalizedNewsItem[]> {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    throw new Error('GNEWS_API_KEY environment variable is not set');
  }

  /*
    ONE request per run, not twenty-three.

    This used to issue one request per category. With 23 categories and
    `ingest-news` on `*​/30` (48 runs a day, `src/lib/cron-schedule.ts`)
    that is 1,104 requests a day against a free quota of **100 requests
    per day** - verified from GNews's own docs on 2026-10-18 (docs/90).
    It would have exhausted the quota by about 02:00 and 429'd until
    midnight, every day.

    Nobody had noticed because `GNEWS_API_KEY` was never set: the guard
    at the top of this function threw before any request was made, so
    the loop had never once run against the network. The key arrived
    2026-10-19 and the bug would have been live immediately.

    One request per run is 48 a day, leaving 52 for manual runs and
    retries. Coverage comes from `selectNextKeyword` rotating across
    runs rather than from breadth within one, which is the same trade
    NewsData's client makes with a budget of three.

    Measured 2026-10-19 with a real key: a broad query returns the full
    page of 10 articles, and four requests spaced 3-15s apart all
    answered 200 - so the 429 seen on two back-to-back calls is a burst
    limit, not the daily quota.
  */
  const allCategories = categories ?? (Object.keys(KEYWORD_SETS) as CampaignCategory[]);
  const targetCategories = allCategories.slice(0, MAX_REQUESTS_PER_RUN);
  const results: NormalizedNewsItem[] = [];
  /*
    Attempted vs failed, so a total outage can be told from a quiet day.

    Every per-keyword error was caught and logged to the console, and
    the function returned whatever it had - `[]` if GNews was entirely
    down. The pipeline's `pipeline.all_sources_failed` detector keys on
    this function REJECTING, so it could never fire for GNews: the only
    thing that ever threw was the missing-key check at the top, and that
    is now handled by `isGNewsConfigured` before the call. Without the
    counters below, blackout detection for this source was dead code.
  */
  let attempted = 0;
  let failed = 0;
  let lastFailure = '';

  for (const category of targetCategories) {
    const keywords = KEYWORD_SETS[category];
    if (!keywords?.length) continue;

    // Rotate through keywords - pick the least recently used keyword
    const keyword = await selectNextKeyword(category, keywords);

    const params = new URLSearchParams({
      q: keyword,
      lang: 'en',
      // The free plan returns up to 10 per request and the request
      // costs the same either way, so asking for 5 wasted half of it.
      max: '10',
      apikey: apiKey,
    });

    // Restrict to US sources only for US-specific categories
    if (US_ONLY_CATEGORIES.has(category)) {
      params.set('country', 'us');
    }

    attempted++;

    try {
      const response = await fetch(`${GNEWS_BASE_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        failed++;
        lastFailure = `HTTP ${response.status}`;
        console.error(`GNews API error for "${keyword}": ${response.status}`);
        continue;
      }

      const data = (await response.json()) as {
        articles?: {
          title: string;
          url: string;
          description: string;
          image: string;
          source: { name: string };
          publishedAt: string;
        }[];
      };

      if (data.articles) {
        for (const article of data.articles) {
          results.push({
            title: article.title,
            url: article.url,
            summary: article.description,
            source: `GNews:${article.source.name}`,
            publishedAt: new Date(article.publishedAt),
            imageUrl: article.image || undefined,
            category,
          });
        }
      }
    } catch (error) {
      failed++;
      lastFailure = String(error).slice(0, 120);
      console.error(`GNews fetch error for "${keyword}":`, error);
    }
  }

  // Every request failed: that is an outage, not an empty news cycle,
  // and the caller's blackout detector needs to see it.
  if (attempted > 0 && failed === attempted) {
    throw new Error(`GNews: all ${attempted} requests failed (last: ${lastFailure})`);
  }

  return results;
}

