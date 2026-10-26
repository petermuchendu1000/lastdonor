/**
 * A campaign's currency is written once, at creation, and never again.
 *
 * ── WHY THIS IS A TEST AND NOT A COMMENT ────────────────────────────────────
 *
 * `donations` and `payhero_payment_requests` each carry a composite foreign
 * key onto `campaigns (id, currency)` (`docs/92`). That makes the rule a
 * database guarantee in ONE direction - a donation cannot be in a currency
 * the campaign is not - and it makes a campaign's currency immutable only
 * *once money exists*. Before the first donation, Postgres would allow an
 * UPDATE, and it would silently re-denominate a goal: a KES 500,000 goal read
 * as US$5,000.
 *
 * ⛔ And `updateCampaignSchema` is `createCampaignBase.partial()`, so it now
 * ACCEPTS `currency` - adding the field to the create schema widened the
 * update schema with it. What stops a write is that
 * `PUT /api/v1/campaigns/[slug]` builds `updateValues` from an explicit
 * field-by-field allowlist and `currency` is not in it. That is one line of
 * absence holding up a money invariant, which is exactly the kind of thing
 * that gets "tidied" into a spread.
 *
 * Added 2026-10-26, `docs/116` §3.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { createCampaignSchema, updateCampaignSchema } from '@/lib/validators/campaign';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/money/currencies';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

const UPDATE_ROUTE = read('src/app/api/v1/campaigns/[slug]/route.ts');
const CREATE_ROUTE = read('src/app/api/v1/campaigns/route.ts');

const validCampaign = {
  title: 'A campaign title',
  slug: 'a-campaign-title',
  category: 'medical' as const,
  heroImageUrl: 'https://example.com/a.jpg',
  subjectName: 'A Person',
  storyHtml: 'x'.repeat(60),
  goalAmount: 200_000,
};

describe('the admin create schema accepts a collectable currency', () => {
  it('defaults to USD, so existing callers are unchanged', () => {
    const parsed = createCampaignSchema.parse({ ...validCampaign });
    expect(parsed.currency).toBe(DEFAULT_CURRENCY);
  });

  it('accepts every collectable currency and nothing else', () => {
    for (const code of Object.keys(CURRENCIES)) {
      /*
        ⚠️ The goal must be inside THAT currency's own range, which is the
        point of the whole change: the first draft of this test reused one
        integer for both and KES failed, because 200,000 minor units is
        KES 2,000 against a KES 100,000 floor.
      */
      const goalAmount = CURRENCIES[code].minGoalMinor;
      expect(
        createCampaignSchema.safeParse({ ...validCampaign, currency: code, goalAmount }).success,
        code,
      ).toBe(true);
    }
    for (const code of ['GBP', 'UGX', 'XOF', 'usd', 'notacurrency']) {
      expect(
        createCampaignSchema.safeParse({ ...validCampaign, currency: code }).success,
        code,
      ).toBe(false);
    }
  });

  it('bounds the goal in the chosen currency, and reports it in that currency', () => {
    // KES 100,000.00 floor; 1,000,000 minor units is KES 10,000.
    const tooSmall = createCampaignSchema.safeParse({
      ...validCampaign,
      currency: 'KES',
      goalAmount: 1_000_000,
    });
    expect(tooSmall.success).toBe(false);
    if (!tooSmall.success) {
      const msg = tooSmall.error.errors[0].message;
      expect(msg).toContain('Ksh');
      expect(msg).not.toContain('$');
    }

    // And the same integer is fine in USD, where the floor is 100_000.
    expect(
      createCampaignSchema.safeParse({ ...validCampaign, goalAmount: 1_000_000 }).success,
    ).toBe(true);
  });

  it('keeps the USD bounds byte-for-byte', () => {
    expect(CURRENCIES.USD.minGoalMinor).toBe(100_000);
    expect(CURRENCIES.USD.maxGoalMinor).toBe(10_000_000);
    expect(
      createCampaignSchema.safeParse({ ...validCampaign, goalAmount: 99_999 }).success,
    ).toBe(false);
    expect(
      createCampaignSchema.safeParse({ ...validCampaign, goalAmount: 10_000_001 }).success,
    ).toBe(false);
  });
});

describe('⛔ the update route cannot change a currency', () => {
  it('the update SCHEMA does accept it, which is why the route matters', () => {
    // Stated as an assertion rather than a comment: if the schema is ever
    // narrowed, this flips and the next test's reasoning changes.
    expect(updateCampaignSchema.safeParse({ currency: 'KES' }).success).toBe(true);
  });

  it('builds updateValues from an allowlist that omits currency', () => {
    const block = UPDATE_ROUTE.slice(
      UPDATE_ROUTE.indexOf('const updateValues'),
      UPDATE_ROUTE.indexOf('.set(updateValues)'),
    );
    expect(block.length).toBeGreaterThan(200);

    // The allowlist shape itself: assignments are `data.X !== undefined`
    // guarded, never a spread of the parsed body.
    expect(block).not.toMatch(/\.\.\.data/);
    expect(block).not.toMatch(/updateValues\.currency/);
    expect(block).not.toMatch(/currency:/);

    // And it really is the allowlist we think it is.
    expect(block).toMatch(/updateValues\.title\s*=/);
    expect(block).toMatch(/updateValues\.goalAmount\s*=/);
  });

  it('no other UPDATE in src/ sets campaigns.currency', () => {
    /*
      The route above is one door. This is the sweep, because an invariant
      held by one file's omission is held by nothing.

      ⚠️ The `.set({...})` object is BRACE-MATCHED. The first draft read a
      fixed 1,200 characters after `.set(` and reported
      `payment-service.ts:243` - where the campaigns update is
      `.set({ status: 'last_donor_zone' })` and the word `currency` belongs to
      an `auditLogs` insert twenty lines later. A fixed window does not know
      where a statement ends, which is the same defect
      `publisher-review-gate.test.ts` was rewritten to remove.
    */
    const files = sourceFiles(resolve(ROOT, 'src'));
    const offenders: string[] = [];
    let examined = 0;
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf-8'));
      for (const match of src.matchAll(/\.update\(\s*(?:schema\.)?campaigns\s*\)/g)) {
        const setStart = src.indexOf('.set(', match.index ?? 0);
        if (setStart === -1) continue;
        examined++;
        if (/\bcurrency\b/.test(braceMatched(src, setStart))) {
          offenders.push(file.slice(ROOT.length + 1));
        }
      }
    }
    // The gate on the sweep: an empty sweep passes against anything.
    expect(examined).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it('the create route is the one place that writes it', () => {
    expect(CREATE_ROUTE).toMatch(/currency:\s*data\.currency/);
  });
});

/**
 * The text from the first `{` after `from` to its matching `}`.
 *
 * Returns the whole remainder if the braces never balance, so a parse failure
 * reads as "look at everything" rather than as a pass.
 */
function braceMatched(source: string, from: number): string {
  const open = source.indexOf('{', from);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length));
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readdirSync, statSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path') as typeof import('path');
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}
