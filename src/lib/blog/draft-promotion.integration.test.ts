/**
 * ⛔ Step 9 of the blog pipeline used to publish AI-written drafts without
 * ever consulting `autoPublish`. Executed against a real Postgres, because
 * this one is about which rows an UPDATE touches.
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * `runBlogPipeline({ autoPublish })` reads the flag in step 8, where a new
 * post is inserted `published: autoPublish && seoScore >= 70`. So with
 * `BLOG_AUTO_PUBLISH` unset - which is how production is configured - a
 * machine-written article lands as a draft for an admin to read first. That
 * is the review gate, the same shape as `docs/78`/`docs/79` for campaigns.
 *
 * Step 9, in the SAME run, then sweeps:
 *
 *     published = false AND source = 'ai_generated' AND seo_score >= 70
 *
 * takes the five best and publishes each one that `canPublishNow()` allows -
 * and `canPublishNow` is purely a cadence gate (weekly cap 7, per-category
 * cap 3, one-day gap). **`autoPublish` appears nowhere in step 9.** Its
 * comment says these are drafts "deferred by cadence limits", but the query
 * cannot tell a cadence-deferred draft from one that is unpublished because
 * the operator said not to auto-publish, or because an admin has not read it
 * yet, or because an admin unpublished it on purpose.
 *
 * ── WHY IT MATTERS NOW ─────────────────────────────────────────────────────
 *
 * [VERIFIED 2026-10-27 against production] `BLOG_PIPELINE_ENABLED` is not
 * `'true'`, so the whole route returns early and none of this has ever run:
 * `blog_posts` has **0 rows**, and `blog_pipeline_completed` has never been
 * written. The queue holds **28 pending topics**, scores 70-100.
 *
 * So the defect is latent, and it arms the moment somebody sets that one
 * variable. An owner who sets `BLOG_PIPELINE_ENABLED=true` and leaves
 * `BLOG_AUTO_PUBLISH` unset - reasonably believing the second flag governs
 * publication - gets machine-written articles about giving on the public
 * blog, reviewed by nobody. With 0 published posts every cadence check
 * passes trivially, so the first run publishes up to five.
 *
 * `docs/123`. The `docs/116` §4 shape - a further path that publishes
 * without review - in the content pipeline rather than the campaign one.
 *
 * ── WHY THE AI IS NEVER CALLED ─────────────────────────────────────────────
 *
 * Step 7 returns early when the queue is empty, so step 9 is unreachable
 * without a pending topic. But the generation loop does
 * `if (topic.priorityScore < minPriorityScore) continue`, so a topic BELOW
 * the floor is skipped and the run still falls through to step 9. One
 * low-scoring topic is therefore enough to execute step 9 with no model
 * call, no network, and nothing stubbed.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { runBlogPipeline } from '@/lib/blog/blog-pipeline';
import { clearDatabase } from '../../../test/helpers';

let seq = 0;

/** A pending topic scored BELOW the floor, so generation skips it. */
async function seedSkippableTopic(): Promise<string> {
  seq++;
  const [row] = await db
    .insert(schema.blogTopicQueue)
    .values({
      title: `Integration topic ${seq}`,
      slug: `integration-topic-${seq}`,
      primaryKeyword: `integration keyword ${seq}`,
      status: 'pending',
      priorityScore: 1,
      attemptCount: 0,
    })
    .returning({ id: schema.blogTopicQueue.id });
  return row.id;
}

async function seedAiDraft(opts: { seoScore: number; source?: string }): Promise<string> {
  seq++;
  const [row] = await db
    .insert(schema.blogPosts)
    .values({
      slug: `integration-draft-${seq}`,
      title: `Integration draft ${seq}`,
      bodyHtml: '<p>Body.</p>',
      excerpt: 'Excerpt.',
      category: 'impact_report',
      authorName: 'LastDonor',
      published: false,
      publishedAt: null,
      source: (opts.source ?? 'ai_generated') as 'ai_generated' | 'manual',
      seoScore: opts.seoScore,
      causeCategory: 'community',
    })
    .returning({ id: schema.blogPosts.id });
  return row.id;
}

const isPublished = async (id: string) => {
  const [row] = await db
    .select({ published: schema.blogPosts.published, publishedAt: schema.blogPosts.publishedAt })
    .from(schema.blogPosts)
    .where(eq(schema.blogPosts.id, id))
    .limit(1);
  return row;
};

describe('the harness reaches step 9 without calling a model', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('⚠️ a below-floor topic is skipped and the run still completes', async () => {
    /*
      The control for everything below. If the run returned at step 7, or
      threw trying to generate, step 9 would never execute and the
      assertions after this would be measuring nothing.
    */
    await seedSkippableTopic();
    const result = await runBlogPipeline({ maxPosts: 1, autoPublish: false, minPriorityScore: 50 });

    /*
      `topicsProcessed` is incremented AFTER the score check `continue`s, so
      a skipped topic is not counted - which is itself the proof that the
      run entered the loop and did not early-return at step 7. The two
      messages are mutually exclusive, so asserting both directions pins
      which path executed.
    */
    expect(result.postsCreated).toBe(0);
    expect(result.errors.join(' ')).toMatch(/below minimum/);
    expect(result.errors.join(' ')).not.toMatch(/No pending topics in queue/);
  });
});

describe('⛔ step 9 no longer publishes AI drafts behind the operator', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('a qualifying draft STAYS a draft when autoPublish is off', async () => {
    /*
      The defect, asserted from the other side. Before the guard this draft
      came back `published: true` with a `publishedAt` stamp - a
      machine-written article public with nobody having read it.
    */
    await seedSkippableTopic();
    const draftId = await seedAiDraft({ seoScore: 80 });

    expect((await isPublished(draftId)).published).toBe(false);

    await runBlogPipeline({ maxPosts: 1, autoPublish: false, minPriorityScore: 50 });

    const after = await isPublished(draftId);
    expect(after.published).toBe(false);
    expect(after.publishedAt).toBeNull();
  });

  it('⚠️ and it STILL promotes when autoPublish is on (the control)', async () => {
    /*
      Without this the guard could be satisfied by deleting step 9, and the
      cadence-deferral it exists for would be silently gone. With zero
      published posts every `canPublishNow` check passes, so a draft at or
      above the SEO floor must come back published.
    */
    await seedSkippableTopic();
    const draftId = await seedAiDraft({ seoScore: 80 });

    await runBlogPipeline({ maxPosts: 1, autoPublish: true, minPriorityScore: 50 });

    const after = await isPublished(draftId);
    expect(after.published).toBe(true);
    expect(after.publishedAt).not.toBeNull();
  });

  it('⚠️ `source` narrows it, so a human draft is never swept even with the flag on', async () => {
    /*
      The predicate's one real narrowing, and the reason the exposure was
      exactly the set of posts no person had read: a draft written by hand in
      `/admin/blog` is `source` 'manual'.
    */
    await seedSkippableTopic();
    const manual = await seedAiDraft({ seoScore: 95, source: 'manual' });
    const generated = await seedAiDraft({ seoScore: 80 });

    await runBlogPipeline({ maxPosts: 1, autoPublish: true, minPriorityScore: 50 });

    expect((await isPublished(manual)).published).toBe(false);
    expect((await isPublished(generated)).published).toBe(true);
  });

  it('⚠️ and the SEO floor narrows it too, so the sweep is narrow not absent', async () => {
    await seedSkippableTopic();
    const low = await seedAiDraft({ seoScore: 69 });
    const high = await seedAiDraft({ seoScore: 70 });

    await runBlogPipeline({ maxPosts: 1, autoPublish: true, minPriorityScore: 50 });

    expect((await isPublished(low)).published).toBe(false);
    expect((await isPublished(high)).published).toBe(true);
  });
});
