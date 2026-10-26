/**
 * The boundary institutional payouts may not cross, enforced mechanically.
 *
 * ── THE ARGUMENT THIS FILE IS THE PROOF OF ──────────────────────────────────
 *
 * Choosing a destination is safe because of one asymmetry: it REMOVES the
 * organiser's ability to withdraw and GRANTS nothing. Every other money
 * feature in this codebase had to argue it was safe to add a capability
 * (`docs/108` vouches, `docs/111` collaborators); this one only takes one
 * away, which is why it can exist before a disbursement rail does.
 *
 * ⚠️ Those are properties of the code, not of a comment, so they are read off
 * the code - the `docs/108` shape. The type system cannot notice a module
 * quietly starting to write a verification status or a money column.
 *
 * ⛔ And the seal: `resolvePayoutRail()` returns null, so there is no code
 * path from the queue to a payment. If that changes, these tests fail and
 * somebody re-reads `docs/113` §5 and §11 before money moves.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolvePayoutRail } from '@/lib/institutional-payout/rail';

const DIR = join(process.cwd(), 'src/lib/institutional-payout');

/** Code with every comment removed, so a mention in prose is not a finding. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((name) => ({ name, code: codeOnly(readFileSync(join(DIR, name), 'utf8')) }));

/** Columns whose value IS money, or whose value releases it. */
const MONEY_COLUMNS = [
  'totalReleasedAmount',
  'totalWithdrawnAmount',
  'raisedAmount',
  'amount',
  'stripeConnectAccountId',
];

describe('the directory was actually read', () => {
  it('finds the modules these assertions are about', () => {
    // A listing that silently returned nothing would make every assertion
    // below pass for the worst possible reason.
    const names = files.map((f) => f.name).sort();
    expect(names).toContain('decide.ts');
    expect(names).toContain('designation.server.ts');
    expect(names).toContain('rail.ts');
    expect(files.length).toBeGreaterThanOrEqual(4);
  });
});

describe('⛔ the module cannot move money or grant verification', () => {
  it('writes no money column anywhere', () => {
    for (const f of files) {
      for (const col of MONEY_COLUMNS) {
        expect(f.code, `${f.name} mentions ${col}`).not.toMatch(new RegExp(`\\b${col}\\b`));
      }
    }
  });

  it('⛔ never assigns a verification status', () => {
    /*
      A vouch grants `identity_verified` (`docs/108`) and the admin route
      writes `fully_verified` in the same transaction it releases money. A
      destination grants NEITHER - it is not a statement about the person.
    */
    for (const f of files) {
      expect(f.code, f.name).not.toMatch(/fully_verified/);
      expect(f.code, f.name).not.toMatch(/identity_verified/);
      expect(f.code, f.name).not.toMatch(/verificationStatus:\s*/);
    }
  });

  it('⛔ never writes campaigns.status, so it cannot publish anything', () => {
    // The `docs/78`/`docs/79` publication review is untouched by this
    // feature, exactly as a vouch leaves it untouched.
    /*
      `.update(campaigns)` is the whole surface - there is no other way to
      write that column from here, and forbidding the table is stronger than
      hunting for the literal. An earlier draft also banned `status: 'active'`
      and matched the TYPE ANNOTATION `status: 'active' | 'retired'` in
      decide.ts, which is a description of an input, not a write.
    */
    for (const f of files) {
      expect(f.code, f.name).not.toMatch(/\.update\(campaigns\)/);
      expect(f.code, f.name).not.toMatch(/\.insert\(campaigns\)/);
    }
  });

  it('writes only its own two tables', () => {
    const writes = files.flatMap((f) => [...f.code.matchAll(/\.(?:update|insert)\(([A-Za-z]+)\)/g)].map((m) => m[1]));
    for (const table of writes) {
      expect(['campaignPayoutDesignations', 'institutionPayoutAccounts']).toContain(table);
    }
  });
});

describe('⛔ the disbursement seal', () => {
  it('no rail is available', () => {
    expect(resolvePayoutRail()).toBeNull();
  });

  it('⛔ nothing in the directory calls a payment provider', () => {
    /*
      The live client is collections-only (`initiateStkPush`,
      `getTransactionStatus`, `getWalletBalance`) and whether it can disburse
      at all is UNKNOWN (`docs/113` §3). `docs/81`/`76`/`77`: never ship a
      provider path nobody has exercised.
    */
    for (const f of files) {
      expect(f.code, f.name).not.toMatch(/payhero/i);
      expect(f.code, f.name).not.toMatch(/stripe/i);
      expect(f.code, f.name).not.toMatch(/createTransfer/);
      expect(f.code, f.name).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('⛔ the rail module declares an interface and implements nothing', () => {
    const rail = files.find((f) => f.name === 'rail.ts')!;
    expect(rail.code).toMatch(/export function resolvePayoutRail/);
    expect(rail.code).toMatch(/return null;/);
    /*
      The INTERFACE declaring `send(...): Promise<PayoutResult>;` is the
      point of the file, so the rule has to forbid an IMPLEMENTATION - a body
      or a property holding a function. An earlier draft forbade the
      signature itself and failed against the very thing it was protecting.
    */
    expect(rail.code).not.toMatch(/class\s+\w+\s+implements\s+PayoutRail/);
    expect(rail.code, 'a send() with a body').not.toMatch(/send\s*\([^)]*\)[^;]*\{/);
    expect(rail.code, 'a send property holding a function').not.toMatch(/send:\s*(async|\()/);
  });
});
