/**
 * Both creation paths are gated, which is what makes "every campaign is
 * reviewed by a person before it goes live" a true sentence.
 *
 * `docs/78` gated user submissions. This pins the other half: the news
 * generator (`docs/79`), which produced all 12 campaigns that were live
 * before today and published them with nobody having read them.
 *
 * The donor-facing sentence in `DonationForm` depends on BOTH. It was
 * removed when it was false and restored when both gates existed, so the
 * last test here ties the copy to the code: if either path starts
 * publishing again, the claim fails with it rather than quietly becoming
 * a lie.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

const PUBLISHER = read('src/lib/news/campaign-publisher.ts');
const USER_ROUTE = read('src/app/api/v1/user-campaigns/route.ts');
const DONATION_FORM = read('src/components/campaign/DonationForm.tsx');

/**
 * The `.values({...})` object of the campaigns insert, with comments
 * stripped.
 *
 * The stripping is load-bearing: the comment explaining why the insert is
 * no longer `status: 'active'` contains that exact string, so a plain
 * substring match on the raw source reports the fix as the defect. Caught
 * on the first run of these tests.
 */
function campaignInsert(source: string) {
  const i = source.indexOf('.insert(campaigns)');
  expect(i).toBeGreaterThan(-1);
  return source
    .slice(i, i + 2600)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the news generator drafts, it does not publish', () => {
  it('inserts under_review', () => {
    expect(campaignInsert(PUBLISHER)).toMatch(/status:\s*'under_review'/);
  });

  it('never inserts an active campaign', () => {
    expect(campaignInsert(PUBLISHER)).not.toMatch(/status:\s*'active'/);
  });

  it('leaves publishedAt null, so ordered public lists cannot surface it', () => {
    expect(campaignInsert(PUBLISHER)).toMatch(/publishedAt:\s*null/);
    expect(campaignInsert(PUBLISHER)).not.toMatch(/publishedAt:\s*new Date\(\)/);
  });

  it('records the row as drafted rather than published', () => {
    expect(PUBLISHER).toMatch(/auditEventType\s*\?\?\s*'campaign\.auto_drafted'/);
  });

  /*
    A queued campaign has publishedAt null. Ordering the dedup window by
    that column would sort every unreviewed campaign last, so the pipeline
    would generate a second campaign about the same person while the first
    waited in the queue.
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

describe('user submissions are gated the same way', () => {
  it('inserts under_review with no publish stamp', () => {
    const insert = campaignInsert(USER_ROUTE);
    expect(insert).toMatch(/status:\s*'under_review'/);
    expect(insert).toMatch(/publishedAt:\s*null/);
  });
});

describe('the donor-facing claim is tied to both gates', () => {
  const CLAIM = 'Every campaign is reviewed by a person before it goes live.';

  it('is made', () => {
    expect(DONATION_FORM).toContain(CLAIM);
  });

  it('is only made while both creation paths are gated', () => {
    // The point of this test: if someone relaxes either insert back to
    // 'active', this fails and names the sentence that has to come out.
    const bothGated =
      /status:\s*'under_review'/.test(campaignInsert(PUBLISHER)) &&
      /status:\s*'under_review'/.test(campaignInsert(USER_ROUTE));

    expect(DONATION_FORM.includes(CLAIM)).toBe(bothGated);
  });
});
