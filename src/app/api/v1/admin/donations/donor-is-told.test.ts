/**
 * A donor is told what happened to their money, and can stop hearing from us.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Both halves failed for the only donors this platform has ever had.
 *
 * **Refunds.** `PATCH /api/v1/admin/donations/[id]` branches on
 * `donation.provider !== 'stripe'`, corrects the ledger, and **returned** —
 * about sixty lines above `notifyDonationRefund`. So refunding any donation
 * not collected by Stripe marked it refunded, dropped the campaign's raised
 * total, and told the donor **nothing**: no email, no notification row, and no
 * money, because that rail has no refund API. Both production donations are
 * `payhero`, so that was every real donor.
 *
 * ⛔ And it cannot simply reuse `donationRefundedEmail`: that one opens *"We
 * sent your money back"* and promises arrival *"in 5 to 10 working days"*,
 * neither of which is true when no gateway was called at all.
 *
 * **Leaving.** `renderEmail`'s footer points every template at `/settings`
 * under "Manage your notifications", and no caller passes `footerLinks`. That
 * route was `redirect('/dashboard/settings')`, which is behind the
 * authenticated dashboard layout — so the one opt-out link in the product's
 * outgoing mail was a login wall for a guest, and a guest is the only shape of
 * donor the M-Pesa rail creates.
 *
 * `docs/122`.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../../../..');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length));
}
const read = (p: string) => stripComments(readFileSync(resolve(ROOT, p), 'utf-8'));

const ROUTE = read('src/app/api/v1/admin/donations/[id]/route.ts');
const SETTINGS = read('src/app/settings/page.tsx');
const TEMPLATES = read('src/lib/email-templates.ts');
const NOTIFICATIONS = read('src/lib/notifications.ts');

/** The text of the non-Stripe branch, brace-matched from its own `if`. */
function nonStripeBranch(): string {
  const at = ROUTE.indexOf("donation.provider !== 'stripe'");
  if (at === -1) return '';
  const open = ROUTE.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < ROUTE.length; i++) {
    if (ROUTE[i] === '{') depth++;
    else if (ROUTE[i] === '}') {
      depth--;
      if (depth === 0) return ROUTE.slice(open, i + 1);
    }
  }
  return ROUTE.slice(open);
}

describe('the sweep found the branch', () => {
  it('the provider guard is still there', () => {
    /*
      The guard itself is the `docs/92` fix - it is what stops a `payhero_…`
      reference reaching `stripe.refunds.create`. If it ever goes, this file's
      subject has changed and the rules below are measuring the wrong thing.
    */
    expect(ROUTE).toContain("donation.provider !== 'stripe'");
    expect(nonStripeBranch().length).toBeGreaterThan(200);
  });
});

describe('⛔ a refund on a rail with no refund API still tells the donor', () => {
  it('the branch notifies before it returns', () => {
    const branch = nonStripeBranch();
    expect(branch).toMatch(/notifyManualRefundPending\(/);
    // And the notify must come BEFORE the response, or it never runs.
    expect(branch.indexOf('notifyManualRefundPending')).toBeLessThan(
      branch.indexOf('return NextResponse.json'),
    );
  });

  it('⛔ and it does NOT claim the money has been sent', () => {
    /*
      The whole reason this is a separate template. `donationRefundedEmail`
      says "We sent your money back" and quotes 5 to 10 working days; on this
      rail nothing has moved and nobody has promised when it will.
    */
    const branch = nonStripeBranch();
    expect(branch).not.toMatch(/notifyDonationRefund\(/);

    const at = TEMPLATES.indexOf('export function manualRefundPendingEmail');
    expect(at, 'manualRefundPendingEmail is gone').toBeGreaterThan(-1);
    const body = TEMPLATES.slice(at, TEMPLATES.indexOf('\n}\n', at));
    expect(body).not.toMatch(/sent your money back/i);
    expect(body).not.toMatch(/working days|business days/i);
    // It says a person does it, which is what actually happens.
    expect(body).toMatch(/by hand/i);
  });

  it('⚠️ and the figure carries its own currency', () => {
    /*
      The in-app title was `` `$${(p.amount / 100).toFixed(2)}` ``, so a KES 50
      refund read "$0.50". Four known currencies are zero-decimal, where
      dividing by 100 understates by 100x (`docs/92`).
    */
    const at = NOTIFICATIONS.indexOf('export async function notifyDonationRefund');
    const sig = NOTIFICATIONS.slice(at, NOTIFICATIONS.indexOf('}) {', at));
    expect(sig).toMatch(/currency: string;/);

    const body = NOTIFICATIONS.slice(at, at + 3000);
    expect(body).not.toMatch(/\$\$\{\(p\.amount \/ 100\)/);
    expect(body).toMatch(/formatMoney\(p\.amount, p\.currency/);
  });
});

describe('⛔ the one opt-out link in every email works signed out', () => {
  it('/settings does not redirect unconditionally', () => {
    /*
      `email-shell.ts` sends every template here, and no caller overrides
      `footerLinks`. An unconditional redirect into the authenticated
      dashboard made that link a dead end for exactly the donors who cannot
      sign in.
    */
    expect(SETTINGS).toMatch(/if \(session\?\.user\?\.id\) redirect\('\/dashboard\/settings'\)/);
    // And there is something to read when there is no session.
    expect(SETTINGS).toMatch(/support@lastdonor\.org/);
  });

  it('⚠️ and it promises a human, not a one-click opt-out it cannot perform', () => {
    /*
      There is no stored suppression for an address with no
      `newsletter_subscribers` row and no `donor_campaign_subscriptions` row -
      `unsubscribeMechanism(null)` reaches the same conclusion. Offering a
      button here would be a claim the platform cannot keep.
    */
    expect(SETTINGS).toMatch(/a person will/i);
  });

  it('the shell still points there, so this page is the one that matters', () => {
    const shell = read('src/lib/email-shell.ts');
    expect(shell).toMatch(/\$\{BASE_URL\}\/settings/);
    expect(shell).toMatch(/Manage your notifications/);
  });

  it('⛔ and the middleware does not gate it before the page can run', () => {
    /*
      ⚠️ The rule above asserts the page's SOURCE, and a page that cannot be
      reached passes a source assertion happily. It did: `/settings/:path*`
      was in the middleware's protected matcher, so a guest was redirected to
      `/login` and the new page never executed. Measured, not reasoned - the
      walk's positive control returned HTTP 307.

      This is the `docs/83` shape committed into the fix for a `docs/83`
      shape, which is why the rule is here and not in a comment.
    */
    const middleware = read('src/middleware.ts');
    const matcher = middleware.slice(middleware.indexOf('matcher: ['));
    const list = matcher.slice(0, matcher.indexOf(']'));
    expect(list, 'the matcher was not parsed').toContain('/dashboard/:path*');
    expect(list).not.toMatch(/'\/settings/);
  });
});
