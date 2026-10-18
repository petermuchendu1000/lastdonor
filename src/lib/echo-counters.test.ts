import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

/*
  CLAUDE.md carried a warning from 2026-10-14 that nothing increments
  `update_count`, `message_count` or `seed_donation_count`. It was
  survivable only because no cron ran (docs/65).

  Measured on 2026-10-18, the night the scheduler went live: a baseline
  at 01:14Z found ONE campaign with a drifting counter; a reconcile run
  at 02:07Z fixed FOUR. Three organiser updates had been written at
  01:45, 01:50 and 01:55 by `update-phases`, and none of them touched
  `update_count`. The defect went from dormant to live the moment the
  thing that writes rows started running.
*/

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

describe('echo counters move with the rows they count', () => {
  const files = walk(SRC).filter((f) => !f.endsWith('echo-counters.ts'));

  it('nothing inserts a campaign update without going through the helper', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/\.insert\(\s*(schema\.)?campaignUpdates\s*\)/.test(src)) {
        offenders.push(f.slice(process.cwd().length + 1));
      }
    }
    // Ten call sites each remembering a second statement is the
    // arrangement that produced the bug. One function that cannot
    // insert without incrementing is the arrangement that cannot.
    expect(offenders).toEqual([]);
  });

  it('nothing inserts a campaign message without going through the helper', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/\.insert\(\s*(schema\.)?campaignMessages\s*\)/.test(src)) {
        offenders.push(f.slice(process.cwd().length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the helper increments in SQL, not by reading then writing', () => {
    const src = readFileSync(join(SRC, 'lib/echo-counters.ts'), 'utf8');
    // `SET x = x + 1` is evaluated against the current row, so two
    // concurrent inserts cannot lose a count.
    expect(src).toMatch(/updateCount:\s*sql`\$\{campaigns\.updateCount\}\s*\+\s*1`/);
    expect(src).toMatch(/messageCount:\s*sql`\$\{campaigns\.messageCount\}\s*\+\s*1`/);
  });

  it('accepts a transaction handle so the row and the counter commit together', () => {
    const src = readFileSync(join(SRC, 'lib/echo-counters.ts'), 'utf8');
    expect(src).toMatch(/executor: Executor = db/);
  });

  it('the one path that runs every five minutes uses it', () => {
    // `update-phases` -> generateOrganizerUpdate. This is the writer
    // that turned the dormant defect into a live one.
    const src = readFileSync(join(SRC, 'lib/seed/organizer-generator.ts'), 'utf8');
    expect(src).toContain('insertCampaignUpdate(');
  });

  it('the payment path passes its transaction, so a rollback takes the counter with it', () => {
    const src = readFileSync(join(SRC, 'lib/services/payment-service.ts'), 'utf8');
    expect(src).toMatch(/insertCampaignUpdate\([\s\S]{0,900}?\}, tx\)/);
    expect(src).toMatch(/insertCampaignMessage\([\s\S]{0,900}?\}, tx\)/);
  });
});
