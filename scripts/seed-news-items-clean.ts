/**
 * Seed the 12 example news items from `scripts/seed-data/news-items-sanitized.json`.
 *
 * Replaces `scripts/seed-news-items.ts`, which is ⛔ DO NOT RUN — it attributes
 * fabricated articles to real newsrooms and fabricated quotes to real sitting
 * officials. See `docs/36-SEED-CONTENT-SANITIZATION.md`.
 *
 * The narratives, categories, images, relevance scores and publish dates are
 * unchanged from that file. Only the real-entity references were removed.
 *
 * Usage:  DATABASE_URL=postgresql://... npx tsx scripts/seed-news-items-clean.ts
 *
 * Takes DATABASE_URL from the environment rather than reading `.env.local`, so
 * it runs in CI and in a container without a dotfile present. Idempotent: it
 * skips any item whose url is already in `news_items`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import postgres from 'postgres';

interface SeedNewsItem {
  title: string;
  url: string;
  source: string;
  summary: string;
  article_body: string;
  image_url: string;
  category: string;
  relevance_score: number;
  published_at: string;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  console.error('  DATABASE_URL=postgresql://... npx tsx scripts/seed-news-items-clean.ts');
  process.exit(1);
}

const sql = postgres(connectionString);

async function main() {
  const file = join(
    new URL('.', import.meta.url).pathname,
    'seed-data',
    'news-items-sanitized.json',
  );
  const items: SeedNewsItem[] = JSON.parse(readFileSync(file, 'utf8'));

  const existing = await sql<{ url: string }[]>`SELECT url FROM news_items`;
  const seen = new Set(existing.map((r) => r.url));

  let inserted = 0;
  let skipped = 0;

  for (const item of items) {
    if (seen.has(item.url)) {
      console.log(`  SKIP   [${item.category}] ${item.title}`);
      skipped++;
      continue;
    }
    await sql`
      INSERT INTO news_items (title, url, source, summary, article_body, image_url, category, relevance_score, campaign_created, admin_flagged, published_at, fetched_at)
      VALUES (
        ${item.title},
        ${item.url},
        ${item.source},
        ${item.summary},
        ${item.article_body},
        ${item.image_url},
        ${item.category},
        ${item.relevance_score},
        false,
        false,
        ${item.published_at}::timestamptz,
        NOW()
      )
    `;
    console.log(`  INSERT [${item.category}] ${item.title}`);
    inserted++;
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`);
  const [{ c }] = await sql<{ c: string }[]>`
    SELECT count(*) AS c FROM news_items WHERE campaign_created = false
  `;
  console.log(`Unused news items in DB: ${c}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
