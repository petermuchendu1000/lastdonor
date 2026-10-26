/**
 * EVERY path that creates a campaign is gated, which is what makes "every
 * campaign is reviewed by a person before it goes live" a true sentence.
 *
 * `docs/78` gated user submissions and `docs/79` gated the news generator.
 * The donor-facing sentence in `DonationForm` depends on all of them: it was
 * removed when it was false and restored when the gates existed, so the last
 * test here ties the copy to the code.
 *
 * ── WHY THIS FILE WAS REWRITTEN (2026-10-26, `docs/116` §4) ─────────────────
 *
 * ⛔ The previous version NAMED TWO FILES and read them with `readFileSync`,
 * searching each for the literal string `.insert(campaigns)`. There were
 * THREE non-admin creation paths. The third - `runNewsPipeline` in
 * `src/lib/news/news-pipeline.ts`, reached by the `ingest-news` and
 * `fetch-news` crons, both of which are in `CRON_SCHEDULE` - inserted
 * `status: 'active'` with `publishedAt: new Date()`, and spelled the call
 * `.insert(schema.campaigns)` in a file this test never opened.
 *
 * So every assertion here passed while a machine-generated campaign about a
 * named real person could go public with nobody reading it. It is the
 * `docs/108` lesson on a different surface: a check that enumerates its own
 * inputs by hand proves something about those inputs and nothing about the
 * property.
 *
 * ⛔ It also sliced a FIXED 2,600 CHARACTERS after the insert call and
 * searched that. Adding a comment inside the user route's `.values({...})`
 * object pushed `status: 'under_review'` past the window, and the assertion
 * failed with the gate fully intact - a window that silently stops looking is
 * the same class of defect pointed the other way. The object is now extracted
 * by matching braces.
 *
 * This file therefore DISCOVERS the inserts from disk. A fourth creation path
 * is covered the moment it is written, and a path renamed or moved cannot
 * fall out of coverage.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const SRC = resolve(ROOT, 'src');
const read = (p: string) => readFileSync(p, 'utf-8');

/** Every `.ts`/`.tsx` file under `src/`, excluding tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__snapshots__') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments blanked out, LENGTH PRESERVED so byte offsets still line up.
 *
 * ⛔ This runs BEFORE the insert search, and it is not tidiness. The comment
 * in `news-pipeline.ts` explaining why that insert is no longer
 * `status: 'active'` quotes both spellings of the call, so the first version
 * of this rewrite discovered SIX inserts in four files - two of them prose -
 * and then asserted that a prose paragraph inserts `under_review`.
 *
 * The original version of this test had the mirror-image problem and
 * documented it: a match on raw source reports the FIX as the defect, because
 * the explanation contains the string being forbidden. Both directions are
 * the same hazard, and stripping first is what covers both.
 *
 * Line comments are stripped only where `//` opens the line, so a URL inside
 * a string literal is left alone.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length));
}

/**
 * The text of the object literal passed to `.values(` after a campaigns
 * insert.
 *
 * ⛔ Brace-matched, not a fixed-length slice — see the file header.
 */
function valuesObject(source: string, insertIndex: number): string {
  const open = source.indexOf('{', source.indexOf('.values(', insertIndex));
  expect(open).toBeGreaterThan(-1);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return source.slice(open, end);
}

interface CampaignInsert {
  /** Repo-relative path, used as the assertion label. */
  file: string;
  values: string;
}

/**
 * Every campaign-creating insert in `src/`, found by reading the tree.
 *
 * ⚠️ BOTH SPELLINGS. `.insert(campaigns)` and `.insert(schema.campaigns)` are
 * the same call, and matching only the first is precisely how the news
 * pipeline escaped this test.
 */
function findCampaignInserts(): CampaignInsert[] {
  const found: CampaignInsert[] = [];
  const pattern = /\.insert\(\s*(?:schema\.)?campaigns\s*\)/g;

  for (const file of sourceFiles(SRC)) {
    const source = stripComments(read(file));
    for (const match of source.matchAll(pattern)) {
      found.push({
        file: relative(ROOT, file),
        values: valuesObject(source, match.index ?? 0),
      });
    }
  }
  return found;
}

const INSERTS = findCampaignInserts();

/**
 * ⛔ `/api/v1/campaigns` is the ADMIN create route, and it is deliberately
 * allowed to publish: `status` comes from the request body, the route is
 * restricted to `editor`/`admin`, and an admin choosing 'active' IS the human
 * review the claim promises. Every other path is a machine or an organiser
 * submission and may never be live on insert.
 */
const ADMIN_ROUTE = 'src/app/api/v1/campaigns/route.ts';

const DONATION_FORM = read(resolve(SRC, 'components/campaign/DonationForm.tsx'));
const PUBLISHER = read(resolve(SRC, 'lib/news/campaign-publisher.ts'));

describe('every campaign-creating path is discovered', () => {
  /*
    The gate on the gate. Without it, a regex that stops matching - a rename,
    a refactor onto a shared helper, a drizzle API change - turns every
    assertion below into a loop over an empty array, and an empty loop passes.
  */
  it('finds all four known creation paths, by name', () => {
    expect(INSERTS.map((i) => i.file).sort()).toEqual([
      'src/app/api/v1/campaigns/route.ts',
      'src/app/api/v1/user-campaigns/route.ts',
      'src/lib/news/campaign-publisher.ts',
      'src/lib/news/news-pipeline.ts',
    ]);
  });

  it('extracted a real values object from each, not an empty match', () => {
    for (const insert of INSERTS) {
      // Every campaign has a title and a slug; an object without them means
      // the brace matcher grabbed the wrong braces.
      expect(insert.values, insert.file).toMatch(/title:/);
      expect(insert.values, insert.file).toMatch(/slug/);
    }
  });
});

describe('no creation path publishes a campaign', () => {
  const gated = INSERTS.filter((i) => i.file !== ADMIN_ROUTE);

  it('leaves the admin route out of the gated set, and nothing else', () => {
    expect(gated).toHaveLength(INSERTS.length - 1);
    expect(gated.map((i) => i.file)).not.toContain(ADMIN_ROUTE);
  });

  it.each(gated.map((i) => [i.file, i] as const))(
    '%s inserts under_review',
    (_file, insert) => {
      expect(insert.values).toMatch(/status:\s*'under_review'/);
    },
  );

  it.each(gated.map((i) => [i.file, i] as const))(
    '%s never inserts a publicly served status',
    (_file, insert) => {
      expect(insert.values).not.toMatch(/status:\s*'(active|last_donor_zone)'/);
    },
  );

  it.each(gated.map((i) => [i.file, i] as const))(
    '%s leaves publishedAt null, so ordered public lists cannot surface it',
    (_file, insert) => {
      expect(insert.values).toMatch(/publishedAt:\s*null/);
      expect(insert.values).not.toMatch(/publishedAt:\s*new Date\(\)/);
    },
  );
});

describe('the news generator drafts, it does not publish', () => {
  it('records the row as drafted rather than published', () => {
    expect(PUBLISHER).toMatch(/auditEventType\s*\?\?\s*'campaign\.auto_drafted'/);
  });

  /*
    A queued campaign has publishedAt null. Ordering the dedup window by that
    column would sort every unreviewed campaign last, so the pipeline would
    generate a second campaign about the same person while the first waited
    in the queue.
  */
  it('dedups against campaigns it has not published yet', () => {
    const window = PUBLISHER.slice(
      PUBLISHER.indexOf('Fuzzy dedup against recent campaigns'),
      PUBLISHER.indexOf('isDuplicateOfRecent'),
    );
    expect(window).toContain('campaigns.createdAt');
    expect(window).not.toContain('campaigns.publishedAt');
  });
});

describe('the donor-facing claim is tied to every gate', () => {
  const CLAIM = 'Every campaign is reviewed by a person before it goes live.';

  it('is made', () => {
    expect(DONATION_FORM).toContain(CLAIM);
  });

  it('is only made while EVERY non-admin creation path is gated', () => {
    // The point of this test: if any insert is relaxed back to a live status,
    // this fails and names the sentence that has to come out.
    const allGated = INSERTS.filter((i) => i.file !== ADMIN_ROUTE).every((i) =>
      /status:\s*'under_review'/.test(i.values),
    );

    expect(DONATION_FORM.includes(CLAIM)).toBe(allGated);
  });
});
