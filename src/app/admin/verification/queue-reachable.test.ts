/**
 * The verification queue must stay reachable (docs/88 F1, F7).
 *
 * `VerificationQueue.tsx` - the only UI that can call the only route that
 * sets `fully_verified` - was imported by NOTHING. `/admin/verification`
 * rendered a read-only dashboard instead: a document count, no approve, no
 * reject, no document viewer. Since `withdraw/route.ts` requires
 * `fully_verified`, no campaign could ever withdraw money.
 *
 * The API itself was never broken (verified against production: all four
 * review actions work, with 409 guards on invalid source states). Only the
 * door was missing, which is precisely what docs/83 said to check for.
 *
 * These are source assertions rather than renders because the failure was
 * structural - a component nobody imported - and that is visible in the
 * import graph, not in a DOM.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PAGE = readFileSync(join(process.cwd(), 'src/app/admin/verification/page.tsx'), 'utf8');
const QUEUE = readFileSync(join(process.cwd(), 'src/components/admin/VerificationQueue.tsx'), 'utf8');

/** Source with comments stripped, so a comment mentioning a token cannot pass for the code. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the admin verification page renders the queue that can review', () => {
  it('imports VerificationQueue', () => {
    expect(code(PAGE)).toContain("from '@/components/admin/VerificationQueue'");
  });

  it('passes it campaigns, in both the empty and populated branches', () => {
    const c = code(PAGE);
    expect(c).toContain('initialItems={[]}');
    expect(c).toContain('initialItems={serialized}');
  });

  it('does not render the read-only dashboard that replaced it', () => {
    expect(code(PAGE)).not.toContain('VerificationDashboard');
  });
});

describe('the queue can actually decide a verification', () => {
  it.each(['approve_t1', 'approve_t2', 'reject', 'request_info'])('offers %s', (action) => {
    expect(QUEUE).toContain(action);
  });

  it('calls the verification route with PATCH, which is what it exports', () => {
    expect(QUEUE).toMatch(/verification`[\s\S]{0,120}method:\s*'PATCH'/);
  });
});

/* docs/88 F7: Didit's manual-review state must not be filtered out. */
describe('a campaign in Didit manual review is visible', () => {
  it('no longer excludes `pending` from either query', () => {
    expect(code(PAGE)).not.toContain("'pending'");
  });

  it('still excludes unverified, which has not started', () => {
    expect(code(PAGE)).toContain("'unverified'");
  });
});
