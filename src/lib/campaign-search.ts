/**
 * One keyword predicate for every campaign listing (docs/45).
 *
 * `/campaigns` and `GET /api/v1/campaigns` each carried their own copy of the
 * `q` match, and both matched only four columns: `title`, `subject_name`,
 * `location`, `subject_hometown`. Measured against the 12 live active
 * campaigns, 9 of 12 realistic donor queries ("veteran", "hospital",
 * "surgery", "disaster", "memorial", ...) returned ZERO results while relevant
 * campaigns existed, because the words a donor searches for live in the story
 * body and in the category, not in the title.
 *
 * This module is the single predicate both surfaces now call, so they cannot
 * drift again.
 */
import { campaigns } from '@/db/schema';
import { ilike, or, inArray, sql, type SQL } from 'drizzle-orm';
import { CAMPAIGN_CATEGORIES } from '@/lib/categories';
import type { CampaignCategory } from '@/types';

/** Longest query we will run. Matches the cap the pages already applied. */
export const MAX_SEARCH_QUERY_LENGTH = 100;

/**
 * Shortest query allowed to match the story body or the category.
 *
 * `story_html` is prose, so a one or two character query ("a", "em", "no")
 * matches almost every campaign and reads as a broken relevance engine. Title,
 * name and location stay unrestricted, so short real queries ("TN") still work.
 */
export const BODY_MATCH_MIN_LENGTH = 3;

/**
 * POSIX patterns used to reduce `story_html` to its prose, shared by the SQL
 * expression below and by `plainTextForSearch` so the two cannot drift.
 *
 * Tags go first, which removes every attribute with them: the seeded stories
 * all carry `<a href="https://example.invalid/lastdonor-seed/...">`, so a
 * search for "https", "href" or "lastdonor-seed" would otherwise match all 12
 * campaigns. Entity references go second, so "amp" and "nbsp" cannot match.
 */
export const HTML_TAG_PATTERN = '<[^>]*>';
export const HTML_ENTITY_PATTERN = '&[a-zA-Z]+;|&#[0-9]+;';

/**
 * `story_html` with markup blanked out, in SQL.
 *
 * PERFORMANCE, stated plainly: this is `ILIKE '%term%'` over a computed text
 * value, so it cannot use a btree index and table-scans every active campaign.
 * At 12 rows that is irrelevant. It does not survive growth, and a trigram
 * (`pg_trgm`) or `tsvector` index on a stored plain-text column is the real
 * fix. That needs a migration, which is a separate frozen decision (docs/34),
 * so it is recorded as the durable follow-up in docs/45 rather than done here.
 */
const STORY_PLAIN_TEXT = sql`regexp_replace(regexp_replace(${campaigns.storyHtml}, ${HTML_TAG_PATTERN}, ' ', 'g'), ${HTML_ENTITY_PATTERN}, ' ', 'g')`;

/**
 * JS mirror of `STORY_PLAIN_TEXT`, used by the tests to assert matching
 * behaviour without a database. Both use the exported pattern constants.
 */
export function plainTextForSearch(html: string): string {
  return html
    .replace(new RegExp(HTML_TAG_PATTERN, 'g'), ' ')
    .replace(new RegExp(HTML_ENTITY_PATTERN, 'g'), ' ');
}

/** Trim and cap a raw `q` value. */
export function normalizeSearchQuery(raw: string | string[] | undefined | null): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH) : '';
}

/** Escape LIKE metacharacters so a query cannot act as a wildcard. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Fold a value to lowercase words so `disaster-relief` == `Disaster Relief`. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Category enum values whose value OR displayed label contains the query.
 *
 * Done in TypeScript against `CAMPAIGN_CATEGORIES`, the single source of truth
 * for both, which is also what reconciles the label/value mismatch: the menu
 * shows "Disaster Relief" while the UI emits `?category=disaster`, so
 * "disaster", "disaster relief" and "disaster-relief" all resolve here. The
 * emitted SQL is then an indexable `category IN (...)` on the enum, with no
 * `category::text ILIKE` cast and no scan.
 */
export function categoriesMatchingText(query: string): CampaignCategory[] {
  const needle = fold(query);
  if (needle.length < BODY_MATCH_MIN_LENGTH) return [];
  return CAMPAIGN_CATEGORIES.filter(
    (c) => fold(c.value).includes(needle) || fold(c.label).includes(needle),
  ).map((c) => c.value);
}

/**
 * The full keyword predicate: title, subject name, location, hometown, story
 * prose and category. Returns `undefined` for an empty query so callers can
 * skip it.
 */
export function campaignSearchCondition(rawQuery: string | string[] | undefined | null): SQL | undefined {
  const query = normalizeSearchQuery(rawQuery);
  if (!query) return undefined;

  const pattern = likePattern(query);
  const parts: SQL[] = [
    ilike(campaigns.title, pattern),
    ilike(campaigns.subjectName, pattern),
    ilike(campaigns.location, pattern),
    ilike(campaigns.subjectHometown, pattern),
  ];

  if (query.length >= BODY_MATCH_MIN_LENGTH) {
    parts.push(sql`${STORY_PLAIN_TEXT} ILIKE ${pattern}`);
  }

  const matchedCategories = categoriesMatchingText(query);
  if (matchedCategories.length > 0) {
    parts.push(inArray(campaigns.category, matchedCategories));
  }

  return or(...parts)!;
}
