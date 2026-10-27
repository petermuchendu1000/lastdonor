/**
 * Blog Pipeline Orchestrator - the master pipeline that coordinates
 * all steps: topic selection â†’ brief â†’ content generation â†’ images â†’
 * quality validation â†’ save/publish.
 */

import { db } from '@/db';
import { blogTopicQueue, blogPosts, blogGenerationLogs, auditLogs } from '@/db/schema';
import { eq, desc, and, lt, sql } from 'drizzle-orm';
import { generateContentBrief } from './content-brief';
import { assembleArticle } from './article-assembler';
import { isDuplicateContent } from './content-dedup';
import { canPublishNow } from './publishing-guardrails';
import { applyGeoOptimization, generateAuthorByline } from './geo-optimizer';
import { calculateSeoScore } from './seo-scorer';
import { generateBlogImage, getFallbackImage } from './image-generator';
import { getInternalLinkSuggestions } from './link-graph';
import { getAuthorityLinks } from './authority-links';
import {
  injectTableOfContents,
  injectSectionImages,
  injectCta,
  normalizeHtmlSpacing,
  calculateReadabilityScore,
  deduplicateKeyTakeaways,
} from './html-formatter';
import { generateSlug } from '@/lib/utils/slug';
import { pipelineLog } from '@/lib/server-logger';
import { randomUUID } from 'crypto';

export interface PipelineOptions {
  maxPosts?: number;
  autoPublish?: boolean;
  dryRun?: boolean;
  minPriorityScore?: number;
}

export interface PipelineResult {
  executionId: string;
  topicsProcessed: number;
  postsCreated: number;
  postsPublished: number;
  errors: string[];
  details: PipelinePostResult[];
}

export interface PipelinePostResult {
  topicId: string;
  topicTitle: string;
  postId?: string;
  slug?: string;
  seoScore?: number;
  wordCount?: number;
  status: 'success' | 'rejected_duplicate' | 'rejected_quality' | 'error';
  error?: string;
}

/**
 * Run the full blog generation pipeline.
 */
export async function runBlogPipeline(
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const {
    maxPosts = 1,
    autoPublish = false,
    dryRun = false,
    minPriorityScore = 50,
  } = options;

  const executionId = randomUUID();
  pipelineLog("pipeline", `Execution ${executionId} started`);

  // Local log helper that auto-attaches executionId to every step
  const log = (topicId: string, step: string, metadata?: Record<string, unknown>) =>
    logPipelineStep(topicId, step, metadata, executionId);

  const result: PipelineResult = {
    executionId,
    topicsProcessed: 0,
    postsCreated: 0,
    postsPublished: 0,
    errors: [],
    details: [],
  };

  // Step 0: Recover stuck topics and enforce retry limits.
  // Topics stuck in 'generating' for over 30 minutes are reset to 'pending',
  // but only if they haven't exceeded MAX_GENERATION_ATTEMPTS (3).
  // After max attempts, they're permanently rejected to prevent infinite loops
  // when a topic consistently causes pipeline crashes (bad AI output, OOM, etc.).
  const MAX_GENERATION_ATTEMPTS = 3;
  const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);

  // First, find all stuck topics
  const stuckTopics = await db
    .select({ id: blogTopicQueue.id, title: blogTopicQueue.title, attemptCount: blogTopicQueue.attemptCount })
    .from(blogTopicQueue)
    .where(
      and(
        eq(blogTopicQueue.status, 'generating'),
        lt(blogTopicQueue.updatedAt, staleThreshold),
      ),
    );

  if (stuckTopics.length > 0) {
    const recoverable = stuckTopics.filter((t) => t.attemptCount < MAX_GENERATION_ATTEMPTS);
    const exhausted = stuckTopics.filter((t) => t.attemptCount >= MAX_GENERATION_ATTEMPTS);

    // Reset recoverable topics to pending (will be retried with incremented attemptCount)
    for (const topic of recoverable) {
      await db
        .update(blogTopicQueue)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(blogTopicQueue.id, topic.id));
    }

    // Permanently reject exhausted topics
    for (const topic of exhausted) {
      await db
        .update(blogTopicQueue)
        .set({
          status: 'rejected',
          rejectedReason: `Failed after ${topic.attemptCount} generation attempts`,
          updatedAt: new Date(),
        })
        .where(eq(blogTopicQueue.id, topic.id));
    }

    if (recoverable.length > 0) {
      pipelineLog("pipeline", `Recovered ${recoverable.length} stuck topic(s): ${recoverable.map((t) => t.title).join(', ')}`);
    }
    if (exhausted.length > 0) {
      pipelineLog("pipeline", `Rejected ${exhausted.length} exhausted topic(s): ${exhausted.map((t) => t.title).join(', ')}`);
    }
  }

  // Step 0b: Reject pending topics that have exhausted all attempts (fast-fail cleanup).
  // These are topics that errored quickly (never stuck in 'generating' for 30min)
  // but accumulated MAX_GENERATION_ATTEMPTS through repeated pipeline runs.
  const exhaustedPending = await db
    .select({ id: blogTopicQueue.id, title: blogTopicQueue.title, attemptCount: blogTopicQueue.attemptCount })
    .from(blogTopicQueue)
    .where(
      and(
        eq(blogTopicQueue.status, 'pending'),
        sql`${blogTopicQueue.attemptCount} >= ${MAX_GENERATION_ATTEMPTS}`,
      ),
    );

  for (const topic of exhaustedPending) {
    await db
      .update(blogTopicQueue)
      .set({
        status: 'rejected',
        rejectedReason: `Failed after ${topic.attemptCount} generation attempts (fast-fail)`,
        updatedAt: new Date(),
      })
      .where(eq(blogTopicQueue.id, topic.id));
  }

  if (exhaustedPending.length > 0) {
    pipelineLog("pipeline", `Rejected ${exhaustedPending.length} exhausted pending topic(s): ${exhaustedPending.map((t) => t.title).join(', ')}`);
  }

  // Step 1: Select top-priority topics (skip topics that have exhausted retries)
  const topics = await db
    .select()
    .from(blogTopicQueue)
    .where(
      and(
        eq(blogTopicQueue.status, 'pending'),
        lt(blogTopicQueue.attemptCount, MAX_GENERATION_ATTEMPTS),
      ),
    )
    .orderBy(desc(blogTopicQueue.priorityScore))
    .limit(maxPosts);

  if (topics.length === 0) {
    result.errors.push('No pending topics in queue');
    return result;
  }

  for (const topic of topics) {
    if (topic.priorityScore < minPriorityScore) {
      result.errors.push(`Topic "${topic.title}" score ${topic.priorityScore} below minimum ${minPriorityScore}`);
      continue;
    }

    const postResult: PipelinePostResult = {
      topicId: topic.id,
      topicTitle: topic.title,
      status: 'success',
    };

    try {
      // Mark topic as generating and increment attempt count
      await db
        .update(blogTopicQueue)
        .set({
          status: 'generating',
          attemptCount: sql`${blogTopicQueue.attemptCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(blogTopicQueue.id, topic.id));

      result.topicsProcessed++;
      const topicStartMs = Date.now();

      // Step 2: Generate Content Brief
      pipelineLog("pipeline", `Step 2: Generating content brief for "${topic.primaryKeyword}"...`);
      const briefStartMs = Date.now();
      await log(topic.id, 'brief_started');

      const secondaryKeywords = Array.isArray(topic.secondaryKeywords)
        ? (topic.secondaryKeywords as string[])
        : [];

      const brief = await generateContentBrief({
        primaryKeyword: topic.primaryKeyword,
        secondaryKeywords,
        causeCategory: topic.causeCategory ?? 'community',
        targetWordCount: topic.targetWordCount,
        newsHook: topic.newsHook,
      });

      // Extract oblique constraints text for downstream passes
      const obliqueConstraints = brief.obliqueConstraints;

      // Store the brief and outline
      await db
        .update(blogTopicQueue)
        .set({
          contentBrief: brief as unknown as Record<string, unknown>,
          outline: brief.outline as unknown as Record<string, unknown>[],
          updatedAt: new Date(),
        })
        .where(eq(blogTopicQueue.id, topic.id));

      await log(topic.id, 'brief_generated');
      pipelineLog("pipeline", `Brief generated in ${((Date.now() - briefStartMs) / 1000).toFixed(1)}s`);

      // Step 2b: Resolve internal link suggestions from the link graph (DB-driven)
      const causeCategory = topic.causeCategory ?? 'community';
      const linkSuggestions = await getInternalLinkSuggestions({
        causeCategory,
        primaryKeyword: topic.primaryKeyword,
      });
      const internalLinkSuggestions = linkSuggestions.map((l) => ({
        href: l.href,
        anchorText: l.anchorText,
      }));

      // Step 2c: Get curated external authority links for this category
      const authorityLinks = getAuthorityLinks(causeCategory);
      const externalAuthoritySources = authorityLinks.map((l) => ({
        href: l.url,
        anchorText: l.anchorText,
      }));

      // Step 3: Generate Full Article
      pipelineLog("pipeline", 'Step 3: Generating full article (multi-pass)...');
      const articleStartMs = Date.now();
      await log(topic.id, 'content_started');

      const article = await assembleArticle(brief, {
        primaryKeyword: topic.primaryKeyword,
        secondaryKeywords,
        causeCategory,
        internalLinkSuggestions,
        externalAuthoritySources,
        obliqueConstraints,
      });

      await log(topic.id, 'content_generated');
      pipelineLog("pipeline", `Article assembled in ${((Date.now() - articleStartMs) / 1000).toFixed(1)}s (${article.wordCount} words)`);

      // Step 4: Deduplication Check
      pipelineLog("pipeline", 'Step 4: Running deduplication check...');
      const dupCheck = await isDuplicateContent(article.bodyHtml);
      pipelineLog("pipeline", `Dedup result: isDuplicate=${dupCheck.isDuplicate}${dupCheck.similarity ? `, similarity=${dupCheck.similarity}` : ''}${dupCheck.similarPostSlug ? `, closestPost=${dupCheck.similarPostSlug}` : ''}`);
      if (dupCheck.isDuplicate) {
        await db
          .update(blogTopicQueue)
          .set({ status: 'stale', updatedAt: new Date() })
          .where(eq(blogTopicQueue.id, topic.id));

        await log(topic.id, 'rejected_duplicate', {
          similarPost: dupCheck.similarPostSlug,
          similarity: dupCheck.similarity,
        });

        postResult.status = 'rejected_duplicate';
        postResult.error = `Too similar to existing post: ${dupCheck.similarPostSlug}`;
        result.details.push(postResult);
        continue;
      }

      // Step 5: Image Generation (hero + section images)
      pipelineLog("pipeline", 'Step 5: Generating images...');
      const imageStartMs = Date.now();
      await log(topic.id, 'images_started');

      let coverImageUrl: string | null = null;
      const heroImage = await generateBlogImage({
        type: 'hero',
        blogTitle: brief.title,
        causeCategory,
        slug: topic.slug,
      });

      if (heroImage) {
        coverImageUrl = heroImage.url;
      } else {
        const fallback = getFallbackImage(causeCategory);
        coverImageUrl = fallback.url;
      }

      // Generate section images (2-3) for inline placement
      const sectionImages: import('./image-generator').BlogImageResult[] = [];
      const h2Headings = (article.bodyHtml.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [])
        .map((tag) => tag.replace(/<[^>]+>/g, '').trim());
      // Pick every 2nd H2 heading starting from index 1 (skip the first)
      const targetSections = h2Headings.filter((_, i) => i > 0 && i % 2 === 0).slice(0, 3);

      for (let si = 0; si < targetSections.length; si++) {
        const heading = targetSections[si]!;
        const sectionImg = await generateBlogImage({
          type: 'section',
          blogTitle: brief.title,
          sectionHeading: heading,
          causeCategory,
          slug: topic.slug,
          sectionIndex: si,
        });
        if (sectionImg) {
          sectionImages.push(sectionImg);
        } else {
          sectionImages.push(getFallbackImage(causeCategory, 'section'));
        }
      }

      await log(topic.id, 'images_generated', {
        heroGenerated: !!heroImage,
        sectionImagesGenerated: sectionImages.length,
      });
      pipelineLog("pipeline", `Images generated in ${((Date.now() - imageStartMs) / 1000).toFixed(1)}s`);

      // Step 6: Apply GEO Optimization
      let optimizedHtml = applyGeoOptimization(article.bodyHtml);

      // Step 6b: Post-processing pipeline
      optimizedHtml = deduplicateKeyTakeaways(optimizedHtml);
      optimizedHtml = injectSectionImages(optimizedHtml, sectionImages);
      optimizedHtml = injectCta(optimizedHtml, causeCategory);
      optimizedHtml = injectTableOfContents(optimizedHtml);
      optimizedHtml += generateAuthorByline();
      optimizedHtml = normalizeHtmlSpacing(optimizedHtml);

      // Calculate readability
      const readabilityScore = calculateReadabilityScore(optimizedHtml);

      // Step 7: Quality Validation
      pipelineLog("pipeline", 'Step 7: Validating quality...');
      await log(topic.id, 'validation_started');

      const seoScore = calculateSeoScore({
        html: optimizedHtml,
        metaTitle: brief.metaTitle,
        metaDescription: brief.metaDescription,
        primaryKeyword: topic.primaryKeyword,
        wordCount: article.wordCount,
        targetWordCount: topic.targetWordCount,
        internalLinks: article.internalLinks,
        externalLinks: article.externalLinks,
        coverImageUrl,
      });

      postResult.seoScore = seoScore.total;
      postResult.wordCount = article.wordCount;

      // Reject if SEO score is too low
      if (seoScore.total < 50) {
        await db
          .update(blogTopicQueue)
          .set({ status: 'rejected', rejectedReason: `SEO score too low: ${seoScore.total}`, updatedAt: new Date() })
          .where(eq(blogTopicQueue.id, topic.id));

        await log(topic.id, 'rejected_quality', { seoScore: seoScore.total });

        postResult.status = 'rejected_quality';
        postResult.error = `SEO score ${seoScore.total} below minimum 50`;
        result.details.push(postResult);
        continue;
      }

      await log(topic.id, 'validated');

      // Step 8: Save to database
      if (dryRun) {
        postResult.status = 'success';
        result.details.push(postResult);
        continue;
      }

      await log(topic.id, 'saving');

      const postSlug = generateSlug(brief.title);

      // Publishing gate: check cadence limits before auto-publishing.
      // If the gate blocks, the post is saved as a draft instead.
      let shouldPublish = autoPublish && seoScore.total >= 70;
      if (shouldPublish) {
        const publishGate = await canPublishNow(causeCategory);
        if (!publishGate.canPublish) {
          pipelineLog("pipeline", `Publish gate blocked: ${publishGate.reason}`);
          await log(topic.id, 'publish_deferred', { reason: publishGate.reason });
          shouldPublish = false;
        }
      }

      const [newPost] = await db
        .insert(blogPosts)
        .values({
          title: brief.title,
          slug: postSlug,
          bodyHtml: optimizedHtml,
          excerpt: brief.metaDescription,
          coverImageUrl,
          authorName: 'LastDonor Editorial Team',
          authorBio: 'The LastDonor.org editorial team creates research-backed content to help donors make informed giving decisions.',
          category: 'news',
          published: shouldPublish,
          publishedAt: shouldPublish ? new Date() : null,
          source: 'ai_generated',
          metaTitle: brief.metaTitle,
          metaDescription: brief.metaDescription,
          primaryKeyword: topic.primaryKeyword,
          secondaryKeywords,
          seoScore: seoScore.total,
          wordCount: article.wordCount,
          readabilityScore,
          internalLinks: article.internalLinks,
          externalLinks: article.externalLinks,
          faqData: article.faqData,
          topicId: topic.id,
          causeCategory,
        })
        .returning();

      // Update topic with generated post reference
      await db
        .update(blogTopicQueue)
        .set({
          status: shouldPublish ? 'published' : 'generated',
          generatedPostId: newPost.id,
          updatedAt: new Date(),
        })
        .where(eq(blogTopicQueue.id, topic.id));

      // Log to audit
      await db.insert(auditLogs).values({
        eventType: shouldPublish ? 'blog_post_published' : 'blog_post_drafted',
        targetType: 'blog_post',
        targetId: newPost.id,
        details: {
          title: brief.title,
          seoScore: seoScore.total,
          wordCount: article.wordCount,
          source: 'ai_pipeline',
        },
        severity: 'info',
      });

      await log(topic.id, shouldPublish ? 'published' : 'drafted', { postId: newPost.id });

      postResult.postId = newPost.id;
      postResult.slug = postSlug;
      result.postsCreated++;
      if (shouldPublish) result.postsPublished++;
      pipelineLog("pipeline", `Topic completed in ${((Date.now() - topicStartMs) / 1000).toFixed(1)}s - SEO:${seoScore.total} | ${article.wordCount}w`);

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      postResult.status = 'error';
      postResult.error = errMsg;
      result.errors.push(`Topic "${topic.title}": ${errMsg}`);

      // Reset topic status back to pending on error
      await db
        .update(blogTopicQueue)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(blogTopicQueue.id, topic.id));

      await log(topic.id, 'error', { error: errMsg });
    }

    result.details.push(postResult);
  }

  /*
    Step 9: Promote qualifying drafts that were deferred by cadence limits.
    On previous runs, posts may have been saved as drafts because
    canPublishNow() blocked them (weekly cap, category gap). On THIS run the
    cadence window may have opened, so promote the best drafts that now pass
    every gate.

    ⛔ ONLY WHEN `autoPublish` IS SET, and that guard is the fix rather than
    a precaution.

    Step 8 inserts a new post `published: autoPublish && seoScore >= 70`, so
    with `BLOG_AUTO_PUBLISH` unset - which is how production is configured -
    a machine-written article is meant to wait for an admin to read it. This
    step then selected on `published = false AND source = 'ai_generated' AND
    seo_score >= 70` and published up to five of them in the SAME RUN, gated
    only by `canPublishNow`, which is purely a cadence check (weekly cap 7,
    per-category cap 3, one-day gap) and knows nothing about the flag. The
    predicate cannot tell a cadence-deferred draft from one that is
    unpublished BECAUSE the operator said not to auto-publish, or from one an
    admin has not read yet, or from one an admin unpublished deliberately.

    It was latent only because the route returns early on
    `BLOG_PIPELINE_ENABLED !== 'true'`. [VERIFIED 2026-10-27 against
    production] `blog_posts` has 0 rows and `blog_pipeline_completed` has
    never been written; [INFERRED] the flag is what stops it, because the
    three silent paths (flag off, lock held, pipeline threw) all wrote
    nothing and were indistinguishable in the database - see `docs/123` §2
    for the elimination. Either way it armed the moment the pipeline ran at
    all, with 28 topics queued and every cadence check passing trivially
    against zero published posts. Note `.env.example` ships
    `BLOG_AUTO_PUBLISH=false`, so the documented configuration IS the
    vulnerable one.

    Nothing legitimate is lost: a cadence-deferred draft only exists because
    a run with `autoPublish` ON created it, so there is nothing for this step
    to promote while the flag is off. `src/lib/blog/draft-promotion.integration.test.ts`
    executes both directions against a real Postgres. `docs/123`, the
    `docs/116` §4 shape in the content pipeline.
  */
  if (!autoPublish) {
    pipelineLog('pipeline', 'Draft promotion skipped: autoPublish is off');
    return result;
  }

  try {
    const drafts = await db
      .select()
      .from(blogPosts)
      .where(
        and(
          eq(blogPosts.published, false),
          eq(blogPosts.source, 'ai_generated'),
          sql`${blogPosts.seoScore} >= 70`,
        ),
      )
      .orderBy(desc(blogPosts.seoScore))
      .limit(5);

    let promoted = 0;
    for (const draft of drafts) {
      const gate = await canPublishNow(draft.causeCategory ?? 'community');
      if (gate.canPublish) {
        await db
          .update(blogPosts)
          .set({ published: true, publishedAt: new Date(), updatedAt: new Date() })
          .where(eq(blogPosts.id, draft.id));

        // Also update the topic queue status if linked
        if (draft.topicId) {
          await db
            .update(blogTopicQueue)
            .set({ status: 'published', updatedAt: new Date() })
            .where(eq(blogTopicQueue.id, draft.topicId));
        }

        promoted++;
        result.postsPublished++;
        pipelineLog("pipeline", `Promoted draft "${draft.title}" (SEO: ${draft.seoScore})`);

        // Re-check cadence after each promotion (gaps/caps may now be filled)
        continue;
      }
    }

    if (promoted > 0) {
      pipelineLog("pipeline", `Promoted ${promoted} draft(s) to published`);
    }
  } catch (error) {
    // Non-critical: don't fail the pipeline if draft promotion fails
    const errMsg = error instanceof Error ? error.message : String(error);
    pipelineLog("pipeline", `Draft promotion failed (non-blocking): ${errMsg}`);
  }

  return result;
}

async function logPipelineStep(
  topicId: string,
  step: string,
  metadata?: Record<string, unknown>,
  executionId?: string,
): Promise<void> {
  try {
    const isError = step === 'error' || step.startsWith('rejected');
    const fullMetadata = { ...metadata, ...(executionId ? { executionId } : {}) };
    await db.insert(blogGenerationLogs).values({
      topicId,
      step,
      success: !isError,
      errorMessage: isError ? (metadata?.error as string) ?? null : null,
      metadata: fullMetadata,
    });
  } catch {
    // Non-critical: don't fail the pipeline if logging fails
  }
}
