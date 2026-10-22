/**
 * Ratchet: no NEW `<Money>` call site may omit its currency.
 *
 * `Money` defaults `currency` to USD, which is correct for every figure the
 * platform rendered before the KES rail existed and wrong for every figure it
 * will render afterwards. A default is exactly the kind of silently-wrong
 * answer this codebase keeps getting bitten by — a shilling amount with a
 * dollar sign still looks like money, so nothing downstream notices.
 *
 * Fixing all of them at once would have meant threading a currency prop
 * through `CampaignCard`, `SidebarDonationSummary`, `DonorFeed`,
 * `ImpactTiers` and the admin payout screens, and therefore through every
 * caller on the listing, homepage, search and admin routes. That is a wide
 * mechanical change and it belongs in its own pass, not bolted onto the one
 * that introduced the gateway.
 *
 * So this holds the line instead, in the shape `docs/70` established for the
 * icon system: the existing omissions are counted and capped, and the build
 * fails if the count grows.
 *
 * ── The gap this is tracking, stated plainly ──────────────────────────────
 *
 * The call sites below read amounts off campaign and donation rows, which now
 * carry their own currency. While every live campaign is USD they are all
 * still correct. **The first time a KES campaign is published, they will
 * print shilling figures with a dollar sign.** No KES campaign is live today
 * (the gateway test campaign is archived), so nothing is wrong on the site
 * right now — but this must be closed before one goes public. See `docs/92`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
/*
  `globSync` comes from the `glob` PACKAGE, not from `node:fs`.

  It used to be imported from `node:fs`, where the function only exists from
  Node 22 and is still marked experimental. CI pinned Node 20, so this file
  threw `TypeError: globSync is not a function` on run 3 - the first CI run
  in this repository's history to reach a runner - while passing on every
  developer machine, all of which are on 22 per `.nvmrc`.

  Two things were wrong and both are fixed: CI now runs Node 22 (see the
  `NODE_VERSION` comment in `.github/workflows/ci.yml`), and this file no
  longer depends on an experimental built-in. `glob` is what the three
  sibling scanners in `test/security/` already use, so there is now one
  glob implementation across the suite instead of two. See docs/97.
*/
import { globSync } from 'glob';
import { join } from 'node:path';

/** Every `<Money ... />` element in the tree, with the file it came from. */
function moneyCallSites(): { file: string; tag: string }[] {
  const files = globSync('src/**/*.tsx', { cwd: process.cwd() })
    .filter((f) => !f.endsWith('.test.tsx'))
    .map((f) => join(process.cwd(), f));

  const sites: { file: string; tag: string }[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Non-greedy up to the first `>`, which is enough: `Money` takes only
    // scalar props, so no nested `>` can appear inside the tag.
    for (const match of source.matchAll(/<Money\b[^>]*?\/?>/g)) {
      sites.push({ file: file.replace(`${process.cwd()}/`, ''), tag: match[0] });
    }
  }
  return sites;
}

describe('Money currency ratchet', () => {
  it('finds the Money call sites at all, so a silent zero cannot pass this suite', () => {
    // Guards against the regex quietly matching nothing and every assertion
    // below trivially succeeding.
    expect(moneyCallSites().length).toBeGreaterThanOrEqual(20);
  });

  it('does not grow the number of call sites that omit a currency', () => {
    const omissions = moneyCallSites().filter((s) => !/\bcurrency=/.test(s.tag));

    /*
      18 as of 2026-10-21, all of them pre-dating the KES rail:

        src/components/admin/PayoutsDashboard.tsx        8
        src/components/dashboard/ImpactLinkRow.tsx       3
        src/app/dashboard/impact/page.tsx                2
        src/components/admin/GovernancePanel.tsx         1
        src/components/campaign/CampaignCard.tsx         1
        src/components/campaign/DonorFeed.tsx            1
        src/components/campaign/ImpactTiers.tsx          1
        src/components/campaign/SidebarDonationSummary.tsx  1

      Lower this number as each one is given its row's currency. Never raise
      it: a new `<Money>` without a currency is a new place a shilling can be
      printed as a dollar.
    */
    expect(omissions.length).toBeLessThanOrEqual(18);
  });

  it('every call site passes an amount in minor units, never a `cents` prop', () => {
    // `cents` was renamed to `minor` because "cents" is a 100x lie for a
    // zero-decimal currency (UGX, RWF, XOF and XAF are all in the intended
    // footprint). A stray `cents=` would be silently ignored by the
    // component and render `NaN`.
    const stragglers = moneyCallSites().filter((s) => /\bcents=/.test(s.tag));
    expect(stragglers.map((s) => s.file)).toEqual([]);
  });

  it('the donate page renders its figures in the campaign currency', () => {
    // The one donor-facing money surface that IS fully threaded, because it
    // is where a KES donor actually gives. Asserted as text so the type
    // system cannot be satisfied by a default.
    const client = readFileSync(
      join(process.cwd(), 'src/app/campaigns/[slug]/donate/client.tsx'),
      'utf8',
    );
    expect(client).toMatch(/formatMoney\(remainingAmount, currency\)/);
    expect(client).toMatch(/formatMoney\(raisedAmount, currency\)/);
    expect(client).toMatch(/formatMoney\(goalAmount, currency\)/);
    expect(client).not.toMatch(/centsToDollars/);
  });

  it('the M-Pesa form renders every figure in the campaign currency', () => {
    const form = readFileSync(
      join(process.cwd(), 'src/components/campaign/MpesaDonationForm.tsx'),
      'utf8',
    );
    // No bare Money, and no hardcoded dollar formatting anywhere in a form
    // that only ever collects a non-USD currency.
    for (const tag of form.match(/<Money\b[^>]*?\/?>/g) ?? []) {
      expect(tag).toMatch(/\bcurrency=\{currency\}/);
    }
    expect(form).not.toMatch(/centsToDollars/);
    expect(form).not.toMatch(/\$\$\{/);
  });
});
