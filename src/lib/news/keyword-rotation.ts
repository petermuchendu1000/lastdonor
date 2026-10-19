import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { CampaignCategory } from '@/types';

/**
 * Round-robin keyword selection, shared by every keyword news source.
 *
 * Lifted out of `gnews-client.ts` on 2026-10-19 when NewsData.io was
 * wired, because both clients need it and a second copy would have
 * drifted. The two sharing one rotation table is deliberate rather than
 * merely convenient: each advances the other's pointer, so between them
 * they work through the keyword set faster than either would alone, and
 * they do not spend their separate daily budgets asking the same
 * question.
 *
 * Both clients are hard-capped at a few requests per run (GNews 100
 * credits/day, NewsData 200, against 48 `ingest-news` runs a day), so
 * rotation is what gives coverage over a day rather than breadth in any
 * one run. See docs/90.
 */
export async function selectNextKeyword(
  category: CampaignCategory,
  keywords: string[],
): Promise<string> {
  try {
    const usages = await db
      .select({
        keyword: schema.keywordRotation.keyword,
        usedAt: schema.keywordRotation.usedAt,
      })
      .from(schema.keywordRotation)
      .where(eq(schema.keywordRotation.category, category));

    const usageMap = new Map(usages.map((u) => [u.keyword, u.usedAt]));

    const neverUsed = keywords.filter((k) => !usageMap.has(k));
    let selected: string;

    if (neverUsed.length > 0) {
      selected = neverUsed[0];
    } else {
      selected = keywords.reduce((oldest, k) => {
        const kTime = usageMap.get(k)?.getTime() ?? 0;
        const oTime = usageMap.get(oldest)?.getTime() ?? 0;
        return kTime < oTime ? k : oldest;
      });
    }

    await db
      .insert(schema.keywordRotation)
      .values({ category, keyword: selected, usedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.keywordRotation.category, schema.keywordRotation.keyword],
        set: { usedAt: new Date() },
      });

    return selected;
  } catch {
    // DB error - fall back to random selection, never block the pipeline
    // on a rotation bookkeeping failure.
    return keywords[Math.floor(Math.random() * keywords.length)];
  }
}
