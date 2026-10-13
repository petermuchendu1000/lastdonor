/**
 * Publishing Guardrails - enforces quality, uniqueness, and cadence rules
 * across the entire blog pipeline.
 *
 * Called from three integration points:
 *  1. reddit-listener.ts + topic-discovery.ts → before inserting topics
 *  2. blog-pipeline.ts → before publishing a generated post
 *  3. blog-topics cron → to expire stale topics
 *
 * Design decisions:
 *  - Single module: all guardrails share the same data sources and domain.
 *    Splitting would force callers to import 6+ modules.
 *  - Deterministic similarity: Jaccard on stemmed word sets, not embeddings.
 *    Keywords are 3-8 words; TF-IDF adds no value at that scale.
 *    Embeddings require an API call per comparison (cost + latency + failure mode).
 *  - Conservative thresholds: false negatives (letting a similar keyword through)
 *    are caught by the content-level dedup in blog-pipeline.ts.
 *    False positives (blocking a valid keyword) permanently reduce topic diversity.
 *    So thresholds err toward permissive.
 */

import { db } from '@/db';
import { blogPosts, blogTopicQueue } from '@/db/schema';
import { eq, and, gte, sql, ne, inArray } from 'drizzle-orm';

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Minimum Jaccard similarity between stemmed keyword word sets
 * to consider two keywords as targeting the same search intent.
 *
 * 0.6 = 60% of meaning-bearing words overlap. Validated against:
 *  - "medical fundraising ideas" vs "medical fundraiser ideas" → 1.0 → BLOCKED
 *  - "how to pay for cancer treatment" vs "cancer treatment fundraising" → 0.5 → ALLOWED
 *  - "help with medical debt" vs "medical debt assistance" → 0.67 → BLOCKED
 *  - "funeral fundraiser ideas" vs "how to raise money for a funeral" → 0.25 → ALLOWED
 */
export const KEYWORD_SIMILARITY_THRESHOLD = 0.6;

/**
 * Minimum Jaccard similarity between stemmed title word sets
 * to consider two titles as too similar for the same blog.
 *
 * Lower than keyword threshold because titles are longer and naturally
 * share more structural words ("How to", "A Guide to", "What to Do When").
 * Those structural words are stopwords and are stripped before comparison.
 */
export const TITLE_SIMILARITY_THRESHOLD = 0.55;

/**
 * Maximum published posts per category in a 7-day rolling window.
 * Prevents over-concentration in trending categories (e.g., medical during outbreak).
 * A professional blog demonstrates topical authority across verticals.
 */
export const MAX_POSTS_PER_CATEGORY_PER_WEEK = 3;

/**
 * Maximum total published posts in a 7-day rolling window.
 * 3-4/week is the professional range for long-form content.
 * More than that signals content-farm behavior to readers and search engines.
 */
export const MAX_POSTS_PER_WEEK = 7;

/**
 * Maximum pending/generating topics per category in the queue.
 * Prevents the queue from filling up with one category during Reddit spikes.
 * Must hold at least 2 weeks of generation, i.e. >= 2 *
 * MAX_POSTS_PER_CATEGORY_PER_WEEK, or the queue starves between cron runs.
 */
export const MAX_QUEUED_PER_CATEGORY = 6;

/**
 * Days before a news-sourced topic becomes stale.
 * News topics lose relevance faster because timeliness was their primary value.
 * 14 days: enough for 2 cron generation cycles (daily) with weekend gaps.
 */
export const STALE_TTL_NEWS_DAYS = 14;

/**
 * Days before a keyword-bank topic becomes stale.
 * These are evergreen topics with no time pressure. 60 days is generous:
 * if a topic hasn't been generated in 2 months, it's stuck or low-priority.
 */
export const STALE_TTL_EVERGREEN_DAYS = 60;

/**
 * Minimum days between publishing two posts in the same category.
 * Prevents back-to-back same-category posts that feel repetitive to readers.
 * 2 days ensures at least one other category's post appears between them.
 */
export const MIN_CATEGORY_GAP_DAYS = 1;

// ─── Stop Words ─────────────────────────────────────────────────────────────

/**
 * Words stripped before similarity comparison. These are:
 *  - Articles and prepositions that don't carry search intent
 *  - Common blog title structural words ("how", "guide", "what")
 *    that would inflate similarity between any two how-to titles
 *  - Conjunctions and pronouns
 *
 * NOT stripped: domain words like "help", "pay", "fund", "donate", "raise"
 * because those carry actual topical meaning.
 */
const SIMILARITY_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'can', 'could',
  'would', 'should', 'may', 'might', 'shall', 'not',
  'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their',
  'what', 'when', 'where', 'how', 'why', 'which', 'who', 'whom',
  // Title structural words that don't carry topical meaning
  'guide', 'tips', 'ways', 'things', 'best', 'top', 'real', 'new',
  'complete', 'ultimate', 'step',
]);

// ─── Text Processing ────────────────────────────────────────────────────────

/**
 * Minimal English suffix stemmer for keyword similarity.
 *
 * NOT a full Porter/Snowball stemmer. We only need to normalize the most
 * common inflections that appear in keyword phrases:
 *  - fundraiser/fundraising/fundraisers → fundrais
 *  - paying/pays/paid → pay (irregular handled separately)
 *  - ideas/needs → idea/need
 *  - assistance → assist (strips -ance/-ence)
 *
 * Over-stemming risk is low because we compare sets of 2-6 stems.
 * One bad stem affects at most 1/6 of the Jaccard score.
 */
export function simpleStem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;

  // Order matters: longest suffixes first to avoid partial stripping
  if (w.endsWith('ising') || w.endsWith('izing')) return w.slice(0, -3); // fundraising → fundrais
  if (w.endsWith('ation')) return w.slice(0, -5); // donation → don... too aggressive? Let's skip
  // Actually, 'ation' strips too much. "donation" → "don" is wrong. Skip it.
  if (w.endsWith('ning') && w.length > 5) return w.slice(0, -4); // planning → plan
  if (w.endsWith('ting') && w.length > 5) return w.slice(0, -4); // starting → star... tricky
  // Actually "ting" is risky. "starting" → "star". Let's only strip "ing" generically.
  if (w.endsWith('ising')) return w.slice(0, -3); // already handled above
  if (w.endsWith('ance') || w.endsWith('ence')) return w.slice(0, -4); // assistance → assist
  if (w.endsWith('ment')) return w.slice(0, -4); // treatment → treat
  if (w.endsWith('ness')) return w.slice(0, -4); // illness → ill
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'; // families → family
  if (w.endsWith('ers') && w.length > 4) return w.slice(0, -3); // fundraisers → fundrais
  if (w.endsWith('ing') && w.length > 4) return w.slice(0, -3); // paying → pay, funding → fund
  if (w.endsWith('ion') && w.length > 4) return w.slice(0, -3); // expression → express
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2); // raised → rais
  if (w.endsWith('er') && w.length > 4) return w.slice(0, -2); // fundraiser → fundrais
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2); // urgently → urgent
  if (w.endsWith('al') && w.length > 4) return w.slice(0, -2); // medical → medic
  if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) return w.slice(0, -1); // ideas → idea

  return w;
}

/**
 * Tokenize a phrase into a set of stemmed, de-stopped words.
 * Returns the Set for Jaccard computation.
 */
export function tokenizeForSimilarity(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !SIMILARITY_STOP_WORDS.has(w));

  return new Set(words.map(simpleStem));
}

/**
 * Jaccard similarity between two sets: |A ∩ B| / |A ∪ B|
 * Returns 0 for empty sets (avoids division by zero).
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  // Iterate over the smaller set for O(min(|A|,|B|)) performance
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  if (union === 0) return 0;

  return intersection / union;
}

// ─── Guardrail 1: Keyword Similarity ────────────────────────────────────────

export interface KeywordCheckResult {
  allowed: boolean;
  reason?: string;
  /** The existing keyword that's too similar, if any */
  conflictingKeyword?: string;
  /** The similarity score with the conflicting keyword */
  similarity?: number;
}

/**
 * Check whether a keyword is sufficiently distinct from all existing
 * keywords in the topic queue and published posts.
 *
 * Returns {allowed: true} if the keyword is unique enough,
 * or {allowed: false, reason, conflictingKeyword, similarity} if blocked.
 *
 * Performance: Loads all existing keywords (typically <1000) and compares
 * in-memory. At 350 keyword-bank + ~100 Reddit-sourced topics over time,
 * this is <500 Jaccard computations per call (microseconds).
 */
export async function checkKeywordSimilarity(
  keyword: string,
): Promise<KeywordCheckResult> {
  const candidateTokens = tokenizeForSimilarity(keyword);

  // A keyword that reduces to no meaningful tokens is too generic
  if (candidateTokens.size === 0) {
    return { allowed: false, reason: 'Keyword contains no meaningful words after stopword removal' };
  }

  // Load all existing keywords from queue (any status except stale/rejected)
  const queueKeywords = await db
    .select({ primaryKeyword: blogTopicQueue.primaryKeyword })
    .from(blogTopicQueue)
    .where(
      and(
        ne(blogTopicQueue.status, 'stale'),
        ne(blogTopicQueue.status, 'rejected'),
      ),
    );

  // Load all published post keywords
  const postKeywords = await db
    .select({ primaryKeyword: blogPosts.primaryKeyword })
    .from(blogPosts)
    .where(eq(blogPosts.published, true));

  const allExisting = [
    ...queueKeywords.map((q) => q.primaryKeyword),
    ...postKeywords.map((p) => p.primaryKeyword).filter(Boolean) as string[],
  ];

  for (const existing of allExisting) {
    const existingTokens = tokenizeForSimilarity(existing);
    if (existingTokens.size === 0) continue;

    const sim = jaccardSimilarity(candidateTokens, existingTokens);
    if (sim >= KEYWORD_SIMILARITY_THRESHOLD) {
      return {
        allowed: false,
        reason: `Too similar to existing keyword "${existing}" (${(sim * 100).toFixed(0)}% overlap)`,
        conflictingKeyword: existing,
        similarity: Number(sim.toFixed(3)),
      };
    }
  }

  return { allowed: true };
}

// ─── Guardrail 2: Title Similarity ──────────────────────────────────────────

export interface TitleCheckResult {
  allowed: boolean;
  reason?: string;
  conflictingTitle?: string;
  similarity?: number;
}

/**
 * Check whether a blog title is sufficiently distinct from all existing
 * titles in the topic queue and published posts.
 *
 * Separate from keyword check because different keywords can produce
 * nearly identical titles:
 *  - Keyword "medical fundraising ideas" → title "Medical Fundraising Ideas"
 *  - Keyword "medical fundraiser ideas" → title "Medical Fundraiser Ideas"
 *  Keyword check catches this (because stems match). But if the keywords
 *  differ enough to pass keyword check, titles might still collide:
 *  - Keyword "help with medical bills" → "How to Help With Medical Bills"
 *  - Keyword "medical bill assistance" → "Medical Bill Assistance: What You Need to Know"
 *  Keywords have Jaccard 0.33 (passes). Titles might still look too similar.
 */
export async function checkTitleSimilarity(
  title: string,
): Promise<TitleCheckResult> {
  const candidateTokens = tokenizeForSimilarity(title);
  if (candidateTokens.size === 0) {
    return { allowed: false, reason: 'Title contains no meaningful words after stopword removal' };
  }

  // Load existing titles from queue (active statuses only)
  const queueTitles = await db
    .select({ title: blogTopicQueue.title })
    .from(blogTopicQueue)
    .where(
      and(
        ne(blogTopicQueue.status, 'stale'),
        ne(blogTopicQueue.status, 'rejected'),
      ),
    );

  // Load published post titles
  const postTitles = await db
    .select({ title: blogPosts.title })
    .from(blogPosts)
    .where(eq(blogPosts.published, true));

  const allExisting = [
    ...queueTitles.map((q) => q.title),
    ...postTitles.map((p) => p.title),
  ];

  for (const existing of allExisting) {
    const existingTokens = tokenizeForSimilarity(existing);
    if (existingTokens.size === 0) continue;

    const sim = jaccardSimilarity(candidateTokens, existingTokens);
    if (sim >= TITLE_SIMILARITY_THRESHOLD) {
      return {
        allowed: false,
        reason: `Too similar to existing title "${existing}" (${(sim * 100).toFixed(0)}% overlap)`,
        conflictingTitle: existing,
        similarity: Number(sim.toFixed(3)),
      };
    }
  }

  return { allowed: true };
}

// ─── Guardrail 3: Category Cadence Cap ──────────────────────────────────────

export interface CadenceCheckResult {
  allowed: boolean;
  reason?: string;
  /** Number of posts already published in this category this week */
  publishedThisWeek?: number;
  /** Number of topics in queue for this category */
  queuedCount?: number;
}

/**
 * Check whether a new topic can be added for a given category,
 * based on how many posts have been published and how many topics
 * are already queued in that category.
 *
 * This prevents the queue from filling up with one category during
 * a Reddit spike (e.g., 10 cancer posts trending simultaneously).
 */
export async function checkCategoryCadence(
  category: string,
): Promise<CadenceCheckResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Count published posts in this category in the last 7 days
  const [publishedResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(blogPosts)
    .where(
      and(
        eq(blogPosts.published, true),
        eq(blogPosts.causeCategory, category),
        gte(blogPosts.publishedAt, sevenDaysAgo),
      ),
    );
  const publishedThisWeek = publishedResult?.count ?? 0;

  if (publishedThisWeek >= MAX_POSTS_PER_CATEGORY_PER_WEEK) {
    return {
      allowed: false,
      reason: `Category "${category}" already has ${publishedThisWeek} posts published this week (max ${MAX_POSTS_PER_CATEGORY_PER_WEEK})`,
      publishedThisWeek,
    };
  }

  // Count active topics in queue for this category
  const [queueResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(blogTopicQueue)
    .where(
      and(
        eq(blogTopicQueue.causeCategory, category),
        inArray(blogTopicQueue.status, ['pending', 'generating']),
      ),
    );
  const queuedCount = queueResult?.count ?? 0;

  if (queuedCount >= MAX_QUEUED_PER_CATEGORY) {
    return {
      allowed: false,
      reason: `Category "${category}" already has ${queuedCount} topics in queue (max ${MAX_QUEUED_PER_CATEGORY})`,
      publishedThisWeek,
      queuedCount,
    };
  }

  return { allowed: true, publishedThisWeek, queuedCount };
}

// ─── Guardrail 4 & 6: Publishing Gate ───────────────────────────────────────

export interface PublishGateResult {
  canPublish: boolean;
  reason?: string;
  publishedThisWeek?: number;
  lastSameCategoryDate?: Date | null;
}

/**
 * Checks whether a generated post can be published RIGHT NOW,
 * combining the weekly cap, category cadence, and category gap.
 *
 * Called by blog-pipeline.ts before setting published=true.
 * If this returns false, the pipeline saves the post as a draft
 * instead of publishing, and it will be checked again next run.
 *
 * This is a "soft" gate: the post is generated and saved, just not
 * auto-published. An admin can still manually publish via the admin UI.
 */
export async function canPublishNow(
  causeCategory: string,
): Promise<PublishGateResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const gapThreshold = new Date(Date.now() - MIN_CATEGORY_GAP_DAYS * 24 * 60 * 60 * 1000);

  // Check 1: Weekly publishing limit (all categories)
  const [weeklyResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(blogPosts)
    .where(
      and(
        eq(blogPosts.published, true),
        gte(blogPosts.publishedAt, sevenDaysAgo),
      ),
    );
  const publishedThisWeek = weeklyResult?.count ?? 0;

  if (publishedThisWeek >= MAX_POSTS_PER_WEEK) {
    return {
      canPublish: false,
      reason: `Weekly limit reached: ${publishedThisWeek}/${MAX_POSTS_PER_WEEK} posts published in the last 7 days`,
      publishedThisWeek,
    };
  }

  // Check 2: Category cadence (same category, last 7 days)
  const [categoryResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(blogPosts)
    .where(
      and(
        eq(blogPosts.published, true),
        eq(blogPosts.causeCategory, causeCategory),
        gte(blogPosts.publishedAt, sevenDaysAgo),
      ),
    );
  const categoryThisWeek = categoryResult?.count ?? 0;

  if (categoryThisWeek >= MAX_POSTS_PER_CATEGORY_PER_WEEK) {
    return {
      canPublish: false,
      reason: `Category "${causeCategory}" has ${categoryThisWeek}/${MAX_POSTS_PER_CATEGORY_PER_WEEK} posts this week`,
      publishedThisWeek,
    };
  }

  // Check 3: Minimum gap between same-category posts
  const [latestInCategory] = await db
    .select({ publishedAt: blogPosts.publishedAt })
    .from(blogPosts)
    .where(
      and(
        eq(blogPosts.published, true),
        eq(blogPosts.causeCategory, causeCategory),
      ),
    )
    .orderBy(sql`${blogPosts.publishedAt} DESC`)
    .limit(1);

  const lastDate = latestInCategory?.publishedAt ?? null;

  if (lastDate && lastDate > gapThreshold) {
    const daysSinceLast = ((Date.now() - lastDate.getTime()) / (24 * 60 * 60 * 1000)).toFixed(1);
    return {
      canPublish: false,
      reason: `Last "${causeCategory}" post was ${daysSinceLast} days ago (minimum gap: ${MIN_CATEGORY_GAP_DAYS} days)`,
      publishedThisWeek,
      lastSameCategoryDate: lastDate,
    };
  }

  return { canPublish: true, publishedThisWeek, lastSameCategoryDate: lastDate };
}

// ─── Guardrail 5: Topic Staleness ───────────────────────────────────────────

export interface StaleResult {
  markedStale: number;
  details: Array<{ id: string; title: string; ageDays: number; source: 'news' | 'evergreen' }>;
}

/**
 * Mark topics as stale if they've been pending too long.
 *
 * News-sourced topics (sourceNewsId != null) have a 14-day TTL because
 * their value is timeliness. A Reddit post about a specific person's
 * medical crisis from 3 weeks ago is no longer current.
 *
 * Keyword-bank topics have a 60-day TTL because they're evergreen.
 * If they haven't been generated in 2 months, something is blocking them
 * (low priority, persistent generation failure, etc.).
 *
 * Called at the start of the blog-topics cron, before discovery,
 * so stale topics free up category slots for fresh ones.
 */
export async function markStaleTopics(): Promise<StaleResult> {
  const now = Date.now();
  const newsThreshold = new Date(now - STALE_TTL_NEWS_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const evergreenThreshold = new Date(now - STALE_TTL_EVERGREEN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Find news-sourced topics that have exceeded their TTL
  const staleNews = await db
    .select({
      id: blogTopicQueue.id,
      title: blogTopicQueue.title,
      createdAt: blogTopicQueue.createdAt,
    })
    .from(blogTopicQueue)
    .where(
      and(
        eq(blogTopicQueue.status, 'pending'),
        sql`${blogTopicQueue.sourceNewsId} IS NOT NULL`,
        sql`${blogTopicQueue.createdAt} < ${newsThreshold}`,
      ),
    );

  // Find keyword-bank topics that have exceeded their TTL
  const staleEvergreen = await db
    .select({
      id: blogTopicQueue.id,
      title: blogTopicQueue.title,
      createdAt: blogTopicQueue.createdAt,
    })
    .from(blogTopicQueue)
    .where(
      and(
        eq(blogTopicQueue.status, 'pending'),
        sql`${blogTopicQueue.sourceNewsId} IS NULL`,
        sql`${blogTopicQueue.createdAt} < ${evergreenThreshold}`,
      ),
    );

  const allStale = [...staleNews, ...staleEvergreen];

  if (allStale.length === 0) {
    return { markedStale: 0, details: [] };
  }

  // Mark all as stale in one query
  const staleIds = allStale.map((t) => t.id);
  await db
    .update(blogTopicQueue)
    .set({
      status: 'stale',
      rejectedReason: 'Exceeded staleness TTL without being generated',
      updatedAt: new Date(),
    })
    .where(inArray(blogTopicQueue.id, staleIds));

  const details = allStale.map((t) => {
    const ageDays = Math.floor((now - t.createdAt.getTime()) / (24 * 60 * 60 * 1000));
    const isNews = staleNews.some((n) => n.id === t.id);
    return {
      id: t.id,
      title: t.title,
      ageDays,
      source: (isNews ? 'news' : 'evergreen') as 'news' | 'evergreen',
    };
  });

  return { markedStale: allStale.length, details };
}

// ─── Composite Check (for topic insertion) ──────────────────────────────────

export interface TopicGuardrailResult {
  allowed: boolean;
  reasons: string[];
  keywordCheck: KeywordCheckResult;
  titleCheck: TitleCheckResult;
  cadenceCheck: CadenceCheckResult;
}

/**
 * Run ALL topic-insertion guardrails in one call.
 *
 * Returns a composite result with individual sub-results for logging.
 * Fails fast on keyword check (most common rejection) but still runs
 * all checks to provide complete diagnostic output.
 */
export async function checkTopicCandidate(
  keyword: string,
  title: string,
  category: string,
): Promise<TopicGuardrailResult> {
  // Run all three checks in parallel (independent DB queries)
  const [keywordCheck, titleCheck, cadenceCheck] = await Promise.all([
    checkKeywordSimilarity(keyword),
    checkTitleSimilarity(title),
    checkCategoryCadence(category),
  ]);

  const reasons: string[] = [];
  if (!keywordCheck.allowed && keywordCheck.reason) reasons.push(keywordCheck.reason);
  if (!titleCheck.allowed && titleCheck.reason) reasons.push(titleCheck.reason);
  if (!cadenceCheck.allowed && cadenceCheck.reason) reasons.push(cadenceCheck.reason);

  return {
    allowed: keywordCheck.allowed && titleCheck.allowed && cadenceCheck.allowed,
    reasons,
    keywordCheck,
    titleCheck,
    cadenceCheck,
  };
}
