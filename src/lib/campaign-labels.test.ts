/**
 * Every state has a word, and no organiser screen keeps its own list.
 *
 * ⚠️ The completeness half is read from the DATABASE ENUMS, not retyped here.
 * The defect this replaces was three organiser-facing maps that had each
 * drifted from the schema in a different direction - one of them inventing two
 * statuses that do not exist while missing four that do. A test that restated
 * the list would have drifted with them.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  CAMPAIGN_STATUS_LABEL,
  VERIFICATION_STATUS_LABEL,
  campaignStatusLabel,
  verificationStatusLabel,
} from '@/lib/campaign-labels';
import { campaignStatusEnum, verificationStatusEnum } from '@/db/schema';

const ROOT = resolve(__dirname, '../..');

describe('every state the database can hold has a word for it', () => {
  it('covers every campaign status', () => {
    for (const status of campaignStatusEnum.enumValues) {
      expect(CAMPAIGN_STATUS_LABEL[status], `no label for campaign status "${status}"`)
        .toBeTruthy();
    }
  });

  it('covers every verification status', () => {
    for (const status of verificationStatusEnum.enumValues) {
      expect(VERIFICATION_STATUS_LABEL[status], `no label for verification status "${status}"`)
        .toBeTruthy();
    }
  });

  it('⛔ invents no status the database does not have', () => {
    /*
      `FinancesClient` carried `pending_review` and `rejected` as campaign
      statuses. Neither exists. An invented key is dead code that reads like
      coverage, which is why it survived.
    */
    const real = new Set<string>(campaignStatusEnum.enumValues);
    for (const key of Object.keys(CAMPAIGN_STATUS_LABEL)) {
      expect(real.has(key), `"${key}" is not a campaign status`).toBe(true);
    }
  });
});

describe('the words do not leak the database or the internals', () => {
  const all = [
    ...Object.values(CAMPAIGN_STATUS_LABEL),
    ...Object.values(VERIFICATION_STATUS_LABEL),
  ];

  it('never prints a snake_case identifier', () => {
    for (const label of all) {
      expect(label, label).not.toMatch(/_/);
    }
  });

  it('⛔ never mentions a tier', () => {
    // "Identity Verified (Tier 1)" told an organiser they were verified while
    // the withdrawal route still refused them. See the module header.
    for (const label of all) {
      expect(label.toLowerCase(), label).not.toContain('tier');
    }
  });

  it('does not call an unfinished check "verified"', () => {
    // The word a payout actually depends on must not be spent on the tier
    // that does not grant one.
    expect(VERIFICATION_STATUS_LABEL.identity_verified.toLowerCase()).not.toContain('verified');
  });
});

describe('the fallback does not reproduce the bug', () => {
  it('de-snakes an unknown status instead of printing it raw', () => {
    expect(campaignStatusLabel('brand_new_state')).toBe('Brand new state');
    expect(verificationStatusLabel('some_new_check')).toBe('Some new check');
  });

  it('handles absent values without printing "null"', () => {
    for (const v of [null, undefined, '']) {
      expect(campaignStatusLabel(v)).toBe('Unknown');
      expect(verificationStatusLabel(v)).toBe('Not started');
    }
  });
});

describe('organiser screens use the shared labels, not their own', () => {
  /*
    Read as TEXT, in the style of docs/91's social-link tests: a component
    that quietly reintroduces its own map compiles perfectly, and the next
    status added to the schema then appears raw on exactly one screen.

    ⛔ `src/components/admin/` is deliberately excluded. Two audiences, two
    vocabularies - see the module header.
  */
  const ORGANISER_FILES = [
    'src/components/dashboard/CampaignsListClient.tsx',
    'src/components/dashboard/FinancesClient.tsx',
    'src/app/dashboard/campaigns/[id]/page.tsx',
    'src/components/verification/CampaignVerificationDashboard.tsx',
  ];

  for (const file of ORGANISER_FILES) {
    it(`${file} defines no status map of its own`, () => {
      const code = readFileSync(resolve(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      /*
        The shape of a local LABEL map: a status key mapped to a quoted
        value starting with a capital.

        ⚠️ The capital matters. `CampaignsListClient` also holds
        `STATUS_VARIANT`, which maps the same keys to badge variants
        (`'default'`, `'secondary'`). Those are styling, not words, and are
        rightly per-component - a first version of this test matched any
        quoted value and flagged them.
      */
      expect(code, `${file} maps last_donor_zone itself`)
        .not.toMatch(/last_donor_zone:\s*['"][A-Z]/);
      expect(code, `${file} maps under_review itself`)
        .not.toMatch(/under_review:\s*['"][A-Z]/);
      expect(code, `${file} maps identity_verified itself`)
        .not.toMatch(/identity_verified:\s*['"][A-Z]/);
    });
  }

  it('scanned files that really exist', () => {
    // A path typo would make every assertion above throw rather than pass,
    // but an empty list would pass silently if the array were ever emptied.
    expect(ORGANISER_FILES.length).toBeGreaterThanOrEqual(4);
    for (const f of ORGANISER_FILES) {
      expect(() => readFileSync(resolve(ROOT, f), 'utf8'), f).not.toThrow();
    }
  });

  it('no OTHER organiser file grows a new one', () => {
    /*
      The list above is maintained by hand, so this sweep catches a new
      screen that nobody remembered to add to it.
    */
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'admin') continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const code = readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
          if (/identity_verified:\s*['"][A-Z]/.test(code)) {
            offenders.push(relative(ROOT, p));
          }
        }
      }
    };
    walk(resolve(ROOT, 'src/app/dashboard'));
    walk(resolve(ROOT, 'src/components/dashboard'));
    walk(resolve(ROOT, 'src/components/verification'));

    expect(
      offenders,
      `these organiser files define their own verification labels:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
