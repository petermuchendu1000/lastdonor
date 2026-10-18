import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { CampaignCategory } from '@/types';

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

  const targetCategories = categories ?? (Object.keys(KEYWORD_SETS) as CampaignCategory[]);
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
      max: '5',
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

/**
 * Select the next keyword for a category using round-robin rotation.
 * Picks the keyword that was least recently used (or never used).
 * Records usage in the keyword_rotation table.
 */
async function selectNextKeyword(
  category: CampaignCategory,
  keywords: string[],
): Promise<string> {
  try {
    // Get all recorded usages for this category
    const usages = await db
      .select({
        keyword: schema.keywordRotation.keyword,
        usedAt: schema.keywordRotation.usedAt,
      })
      .from(schema.keywordRotation)
      .where(eq(schema.keywordRotation.category, category));

    const usageMap = new Map(usages.map((u) => [u.keyword, u.usedAt]));

    // Find keywords never used, or pick the least recently used
    const neverUsed = keywords.filter((k) => !usageMap.has(k));
    let selected: string;

    if (neverUsed.length > 0) {
      selected = neverUsed[0];
    } else {
      // All keywords have been used - pick the one used longest ago
      selected = keywords.reduce((oldest, k) => {
        const kTime = usageMap.get(k)?.getTime() ?? 0;
        const oTime = usageMap.get(oldest)?.getTime() ?? 0;
        return kTime < oTime ? k : oldest;
      });
    }

    // Upsert usage timestamp
    await db
      .insert(schema.keywordRotation)
      .values({
        category,
        keyword: selected,
        usedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.keywordRotation.category, schema.keywordRotation.keyword],
        set: { usedAt: new Date() },
      });

    return selected;
  } catch {
    // DB error - fall back to random selection (don't block pipeline)
    return keywords[Math.floor(Math.random() * keywords.length)];
  }
}
