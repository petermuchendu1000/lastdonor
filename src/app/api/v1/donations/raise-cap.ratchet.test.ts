/**
 * Ratchet: every money-IN route enforces the pre-verification cap.
 *
 * Reads the route files as TEXT and discovers them from disk, rather than
 * listing the three that exist today. That is the point: the defect this
 * guards against is a FOURTH collection route added later without the cap,
 * which a test naming only the current three would never notice.
 *
 * It also pins the ORDER. The cap must be decided before the provider is
 * asked to take money, because that is the last moment refusing is free. A
 * cap checked after `stripe.checkout.sessions.create` or `initiateStkPush`
 * would be a cap enforced by refunding, which moves money.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DONATIONS_DIR = join(process.cwd(), 'src/app/api/v1/donations');

/**
 * Calls that CREATE a charge. `stripe.paymentIntents.retrieve` is deliberately
 * absent: `donations/webhook` retrieves an already-settled intent, which is
 * the settlement path, not a collection, and by then the money is taken.
 */
const CHARGE_CREATING_CALLS = [
  'stripe.checkout.sessions.create',
  'stripe.paymentIntents.create',
  'initiateStkPush',
] as const;

function routeFiles(): string[] {
  return readdirSync(DONATIONS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('route.ts'))
    .map((p) => join(DONATIONS_DIR, p));
}

function moneyInRoutes(): { path: string; src: string; call: string }[] {
  const out: { path: string; src: string; call: string }[] = [];
  for (const path of routeFiles()) {
    const src = readFileSync(path, 'utf8');
    const call = CHARGE_CREATING_CALLS.find((c) => src.includes(`${c}(`));
    if (call) out.push({ path, src, call });
  }
  return out;
}

describe('pre-verification cap is enforced on every collection route', () => {
  it('finds the money-in routes at all (guards against a broken discovery)', () => {
    const found = moneyInRoutes();
    // If this drops to zero the suite below would pass vacuously.
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  const routes = moneyInRoutes();

  it.each(routes.map((r) => [r.path.replace(process.cwd() + '/', ''), r] as const))(
    '%s imports and calls checkRaiseCap',
    (_name, r) => {
      expect(r.src).toMatch(/from '@\/lib\/campaign-raise-cap'/);
      expect(r.src).toMatch(/checkRaiseCap\(/);
    },
  );

  it.each(routes.map((r) => [r.path.replace(process.cwd() + '/', ''), r] as const))(
    '%s decides the cap BEFORE it creates a charge',
    (_name, r) => {
      const capAt = r.src.indexOf('checkRaiseCap(');
      const chargeAt = r.src.indexOf(`${r.call}(`);
      expect(capAt).toBeGreaterThan(-1);
      expect(chargeAt).toBeGreaterThan(-1);
      expect(capAt).toBeLessThan(chargeAt);
    },
  );

  it.each(routes.map((r) => [r.path.replace(process.cwd() + '/', ''), r] as const))(
    '%s feeds the cap from the shared realRaisedMinorSql, not its own copy',
    (_name, r) => {
      expect(r.src).toMatch(/from '@\/db\/real-raised'/);
      expect(r.src).toMatch(/realRaisedMinor:\s*realRaisedMinorSql/);
      // It must not hand the BLENDED column to the cap instead.
      expect(r.src).not.toMatch(/realRaisedMinor:\s*[^,\n]*raisedAmount/);
      // Nor re-inline a private copy of the subquery, which could drift.
      expect(r.src).not.toMatch(/realRaisedMinor:\s*sql</);
    },
  );

  /*
    The expression itself. Its runtime correctness is proven against a real
    Postgres in `src/db/real-raised.integration.test.ts` - these are only the
    properties that are cheap to assert statically and expensive to get wrong.
  */
  describe('realRaisedMinorSql', () => {
    /*
      Comments are stripped before asserting. The module's own doc comment
      QUOTES the broken spelling as the thing not to write, so a naive negative
      match against the raw file fails on the documentation rather than on the
      code.
    */
    const src = () => readFileSync(join(process.cwd(), 'src/db/real-raised.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    it('filters to real, un-refunded rows and coalesces NULL to 0', () => {
      expect(src()).toMatch(/donations\.source\)\}\s*=\s*'real'/);
      expect(src()).toMatch(/donations\.refunded\)\}\s*=\s*false/);
      // SUM over no rows is NULL, not 0, and a NULL headroom compares false
      // against every cap - which disables the control silently.
      expect(src()).toMatch(/COALESCE\(/);
    });

    it('never reads the blended raised_amount column', () => {
      expect(src()).not.toMatch(/raisedAmount/);
    });

    /*
      THE REGRESSION THIS EXISTS FOR, measured 2026-10-24.

      Interpolating a Column into a `sql` template renders it UNQUALIFIED, so
      the natural spelling

          WHERE ${donations.campaignId} = ${campaigns.id}

      emits `WHERE "campaign_id" = "id"`. Inside the subquery only `donations`
      is in scope, so both resolve to it and the predicate becomes
      `donations.campaign_id = donations.id` - never true. Valid SQL, no
      error, returns 0 for every campaign, and the cap silently never fires.

      The identifiers must therefore stay explicitly qualified, and derived
      from the schema objects so a rename cannot strand this file.
    */
    it('qualifies its identifiers instead of interpolating bare columns', () => {
      expect(src()).toMatch(/sql\.identifier\(/);
      expect(src()).toMatch(/getTableName\(/);
      // The exact shape that produced the silent zero.
      expect(src()).not.toMatch(/\$\{donations\.campaignId\}\s*=\s*\$\{campaigns\.id\}/);
    });
  });

  it.each(routes.map((r) => [r.path.replace(process.cwd() + '/', ''), r] as const))(
    '%s refuses with 409, not a 4xx that invites a retry of the same request',
    (_name, r) => {
      expect(r.src).toMatch(/capDecision/);
      expect(r.src).toMatch(/status:\s*409|409,/);
    },
  );
});
