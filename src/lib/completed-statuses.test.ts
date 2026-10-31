import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { COMPLETED_STATUSES, PUBLICLY_VIEWABLE_STATUSES } from './campaign-visibility';

/**
 * One definition of "completed", shared by everything that counts or lists it.
 *
 * ## The defect this encodes (docs/146)
 *
 * Four surfaces each decided for themselves what "completed" meant, and they
 * disagreed:
 *
 *   `/campaigns` tab badge          `IN ('completed','archived')`
 *   `/completed-campaigns` listing  `= 'completed'`
 *   `/api/v1/stats` campaignsCompleted  `IN ('completed','archived')`
 *   `/api/v1/stats` peopleSupported     `= 'completed'`
 *
 * So the tab read **"Completed 1"** over a page showing nothing, and the
 * public API published `campaignsCompleted: 1` beside `peopleSupported: 0` in
 * one payload.
 */

const SRC = join(__dirname, '..');
const SKIP = new Set(['node_modules', '.next']);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * Projections that name a figure "completed" while hardcoding `archived`.
 *
 * ⚠️ MY FIRST VERSION OF THIS RULE WAS WRONG and its failure was correct: it
 * banned the token pair anywhere, which flags `db/schema.ts`'s own pgEnum,
 * `notifications.ts`'s `NOTIFY_STATUSES` (a donor SHOULD hear about a
 * campaign that completed OR closed - a different question) and the admin
 * `canCancel` / transition maps. The defect is not the two words appearing
 * together; it is a figure CALLED completed counting campaigns that are not.
 *
 * So the rule targets the concept: a select projection keyed `completed`,
 * `completedCampaigns` or `campaignsCompleted` must not name `'archived'`.
 *
 * ⚠️ Comments are stripped first - the comments explaining this fix quote the
 * forbidden pair, and a raw-source match reports the fix as the defect
 * (`docs/116` §4).
 */
const COMPLETED_KEY = /\b(completed|completedCampaigns|campaignsCompleted)\s*:/;

/**
 * A COMPUTED FIGURE, not merely a key with that name.
 *
 * ⚠️ SECOND NARROWING, and again the rule was wrong rather than the code: the
 * previous version also flagged `completed: ['archived']` in
 * `ALLOWED_TRANSITIONS`, which means "FROM completed you may go TO archived" -
 * the opposite of "completed includes archived". A transition map is
 * deliberately out of scope.
 */
const IS_QUERY_LINE = /campaigns\.status|count\(|COUNT\(|\bsql[<`]/;

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function completedFiguresNamingArchived(): string[] {
  const out: string[] = [];
  for (const f of sourceFiles(SRC)) {
    const code = strip(readFileSync(f, 'utf8'));
    for (const line of code.split('\n')) {
      if (COMPLETED_KEY.test(line) && IS_QUERY_LINE.test(line) && /['"]archived['"]/.test(line)) {
        out.push(`${f.slice(SRC.length + 1)}: ${line.trim().slice(0, 90)}`);
      }
    }
  }
  return out;
}

describe('rule 1: archived is not a kind of completed', () => {
  it('COMPLETED_STATUSES excludes archived', () => {
    expect([...COMPLETED_STATUSES]).not.toContain('archived');
    expect([...COMPLETED_STATUSES]).toContain('completed');
  });

  it('because a DRAFT can be archived - derived from the transition table', () => {
    /*
      The reason, not a restatement. `archived` cannot imply success while a
      campaign that never launched can reach it, and both delete routes
      implement deletion AS archiving.
    */
    const route = readFileSync(
      join(SRC, 'app/api/v1/admin/campaigns/[campaignId]/route.ts'),
      'utf8',
    );
    expect(route).toMatch(/draft:\s*\[[^\]]*'archived'/);

    const deleteRoutes = [
      'app/api/v1/user-campaigns/[id]/route.ts',
      'app/api/v1/campaigns/[slug]/route.ts',
    ];
    for (const rel of deleteRoutes) {
      expect(readFileSync(join(SRC, rel), 'utf8'), rel).toContain("status: 'archived'");
    }
  });
});

describe('rule 2: a figure called "completed" counts only completed campaigns', () => {
  it('no select projection named completed hardcodes archived', () => {
    expect(completedFiguresNamingArchived()).toEqual([]);
  });

  it('the sweep reads a meaningful number of files', () => {
    // Anti-vacuity: a broken walker reports zero offenders forever.
    expect(sourceFiles(SRC).length).toBeGreaterThan(300);
  });

  it('the sweep can actually find the shape it looks for', () => {
    /*
      Gate 4, against synthetic samples rather than a live offender - pinning
      a real file would make FIXING it fail the build. These are the exact
      four shapes that were wrong (docs/146).
    */
    const offenders = [
      "completed: sql<number>`count(*) FILTER (WHERE status IN ('completed','archived'))`,",
      "campaignsCompleted: inArray(campaigns.status, ['completed', 'archived']),",
      "completed: sql`COUNT(CASE WHEN status IN ('completed', 'archived') THEN 1 END)`,",
      "completedCampaigns: sql`count(*) FILTER (WHERE status IN ('archived','completed'))`,",
    ];
    for (const line of offenders) {
      expect(
        COMPLETED_KEY.test(line) && IS_QUERY_LINE.test(line) && /['\"]archived['\"]/.test(line),
        line,
      ).toBe(true);
    }
  });

  it('does NOT fire on the legitimate uses of the same two words', () => {
    /*
      The control that keeps this rule honest. None of these is a completeness
      claim: the enum lists every status, a donor should be told when a
      campaign completes OR closes, and an admin cannot cancel a terminal one.
    */
    const legitimate = [
      "status: pgEnum('campaign_status', ['completed', 'archived'])",
      "const NOTIFY_STATUSES = ['completed', 'archived'];",
      "const canCancel = (s: string) => !['cancelled', 'completed', 'archived'].includes(s);",
      "active: ['draft', 'paused', 'completed', 'archived'],",
      "completed: ['archived'],",
    ];
    for (const line of legitimate) {
      expect(
        COMPLETED_KEY.test(line) && IS_QUERY_LINE.test(line) && /['\"]archived['\"]/.test(line),
        line,
      ).toBe(false);
    }
  });
});

/**
 * A status PREDICATE that hardcodes the pair.
 *
 * ⚠️ ADDED after an injection did NOT fire: restoring the public stats API's
 * `.where(inArray(campaigns.status, ['completed','archived']))` passed every
 * rule, because that line carries no `completed:` KEY - the projection is on a
 * different line, and a line-based projection rule cannot see a multi-line
 * statement. This half asks the other question: does a predicate ON
 * `campaigns.status` name both?
 *
 * It is precise rather than broad: the legitimate uses (`NOTIFY_STATUSES`, the
 * admin `canCancel` and transition maps, the pgEnum) never mention
 * `campaigns.status`, because they are not queries.
 */
const PAIR =
  /['"]completed['"]\s*,\s*['"]archived['"]|['"]archived['"]\s*,\s*['"]completed['"]/;

function predicatesHardcodingThePair(): string[] {
  const out: string[] = [];
  for (const f of sourceFiles(SRC)) {
    for (const line of strip(readFileSync(f, 'utf8')).split('\n')) {
      if (line.includes('campaigns.status') && PAIR.test(line)) {
        out.push(`${f.slice(SRC.length + 1)}: ${line.trim().slice(0, 90)}`);
      }
    }
  }
  return out;
}

describe('rule 2b: a campaigns.status predicate never hardcodes the pair', () => {
  it('finds none', () => {
    expect(predicatesHardcodingThePair()).toEqual([]);
  });

  it('would catch the public stats API regression', () => {
    // The exact line injection 4 restored, which rule 2 could not see.
    const line = "      .where(inArray(campaigns.status, ['completed', 'archived']));";
    expect(line.includes('campaigns.status') && PAIR.test(line)).toBe(true);
  });

  it('does not fire on the legitimate uses, which are not queries', () => {
    for (const line of [
      "const NOTIFY_STATUSES = ['completed', 'archived'];",
      "const canCancel = (s: string) => !['cancelled', 'completed', 'archived'].includes(s);",
      "active: ['draft', 'paused', 'completed', 'archived'],",
    ]) {
      expect(line.includes('campaigns.status') && PAIR.test(line), line).toBe(false);
    }
  });
});

describe('rule 3: the control - archived is still SERVED, just not completed', () => {
  it('PUBLICLY_VIEWABLE_STATUSES still contains archived', () => {
    /*
      `docs/118` §9 is an owner decision: a closed campaign keeps its page so a
      donor following an old link is told what happened. This rule must never
      become "archived is banned everywhere" - it is only not a SUCCESS.
    */
    expect([...PUBLICLY_VIEWABLE_STATUSES]).toContain('archived');
  });

  it('the two sets are genuinely different questions', () => {
    expect([...PUBLICLY_VIEWABLE_STATUSES].length).toBeGreaterThan(
      [...COMPLETED_STATUSES].length,
    );
  });
});

describe('rule 4: the surfaces that count or list completed read the constant', () => {
  const SITES = [
    'app/campaigns/(index)/page.tsx',
    'app/completed-campaigns/page.tsx',
    'app/api/v1/stats/route.ts',
    /*
      ⚠️ `app/(home)/page.tsx` was the fourth site and is GONE, not exempted
      (docs/146 §4.0b). Verifying the deploy found that its `completed` tally
      was read by nothing - `docs/51` removed `ImpactCounter` and left the
      query behind - so the fix was to delete the query, not to make it read
      the constant. A site list must shrink when a surface disappears;
      leaving it here would have failed the build for the right reason and
      sent the next reader looking for a tally that no longer exists.
    */
    /*
      The LISTING API's `status=completed` branch. `/completed-campaigns`
      passes that param through `CampaignGrid`'s `extraParams`, so this is the
      continuation of that page's own list: a hardcoded predicate here means
      page 1 and "Load more" can list different things.
    */
    'app/api/v1/campaigns/route.ts',
    /*
      ⚠️ ADDED by `docs/165`. `/transparency` renders "Campaigns Funded" from
      the same set and was absent from this list - a pre-existing gap, found
      only because pointing every site at one predicate meant enumerating
      them. The comment above says a site list must SHRINK when a surface
      disappears; it must also GROW when one is found.
    */
    'app/transparency/page.tsx',
  ];

  it.each(SITES)('%s USES one shared definition, not merely imports it', (rel) => {
    /*
      ⚠️ This asserted `src.toContain('COMPLETED_STATUSES')` and an injection
      proved it could not fail: deleting the USAGE while leaving the IMPORT in
      place passed. Import lines are stripped first, so only a real reference
      counts.

      ⚠️ AND IT NAMED A MECHANISM RATHER THAN THE PROPERTY. `docs/165` pointed
      these sites at `completedCampaignFilter()`, which reads the constant
      once and adds the two things a public completed listing also needs (the
      platform fund excluded, `published_at` set) - so all four sites failed
      while the property the rule protects, ONE definition of "completed",
      had just been strengthened. Either spelling is accepted; the next test
      is what stops that acceptance being a hole.
    */
    const body = strip(readFileSync(join(SRC, rel), 'utf8'))
      .split('\n')
      .filter((l) => !/^\s*import\b/.test(l))
      .join('\n');
    const readsConstant = body.includes('COMPLETED_STATUSES');
    const readsFilter = /completedCampaignFilter\s*\(/.test(body);
    expect(
      readsConstant || readsFilter,
      `${rel} defines "completed" for itself`,
    ).toBe(true);
  });

  it('⛔ and the shared filter really reads the constant', () => {
    /*
      Accepting `completedCampaignFilter()` above is only safe while that
      function is itself derived. Without this, somebody could hardcode the
      pair inside it and every site would still pass - the hole that
      loosening a rule usually opens.
    */
    const src = strip(readFileSync(join(SRC, 'db/public-campaigns.ts'), 'utf8'));
    const body = src
      .split('\n')
      .filter((l) => !/^\s*import\b/.test(l))
      .join('\n');
    expect(body, 'completedCampaignFilter does not exist').toMatch(
      /export function completedCampaignFilter/,
    );
    expect(body, 'completedCampaignFilter does not read COMPLETED_STATUSES').toContain(
      'COMPLETED_STATUSES',
    );
    // And it must still carry the two predicates it was created for.
    expect(body, 'the platform fund is no longer excluded').toMatch(
      /excludePlatformFunds\s*\(/,
    );
    expect(body, 'published_at is no longer required').toMatch(
      /isNotNull\(\s*campaigns\.publishedAt\s*\)/,
    );
  });
});
