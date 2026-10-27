/**
 * The donor-facing half of the pre-verification cap.
 *
 * The case worth having a test for is the throwing one: `getCurrency` raises
 * on an unknown code rather than defaulting to USD (docs/92), which is right
 * for money arithmetic and fatal for a badge - this renders inside the
 * campaign detail SERVER component, so a throw takes the whole page down
 * rather than hiding one badge.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingVerificationBadge } from '@/components/campaigns/TrustBadge';
import { getCurrency } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('PendingVerificationBadge', () => {
  it('tells a donor the campaign is unverified and names the USD cap', () => {
    render(<PendingVerificationBadge verificationStatus="unverified" currency="USD" isDonatable />);
    expect(screen.getByText(/Pending verification/i)).toBeInTheDocument();
    const cap = formatMoney(getCurrency('USD').unverifiedCapMinor, 'USD', 'exact');
    expect(screen.getByText(new RegExp(cap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
  });

  it('names the KES cap on a KES campaign, not the USD one', () => {
    render(<PendingVerificationBadge verificationStatus="unverified" currency="KES" isDonatable />);
    const kesCap = formatMoney(getCurrency('KES').unverifiedCapMinor, 'KES', 'exact');
    const usdCap = formatMoney(getCurrency('USD').unverifiedCapMinor, 'USD', 'exact');
    const body = document.body.textContent ?? '';
    expect(body).toContain(kesCap);
    expect(body).not.toContain(usdCap);
  });

  it('says payout is blocked too, because that is the consequence a donor cares about', () => {
    render(<PendingVerificationBadge verificationStatus="unverified" currency="USD" isDonatable />);
    expect(document.body.textContent).toMatch(/no money can be paid out/i);
  });

  it.each(['identity_verified', 'fully_verified'])(
    'renders nothing once the campaign is %s',
    (status) => {
      const { container } = render(
        <PendingVerificationBadge verificationStatus={status} currency="USD" isDonatable />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );

  it.each(['pending', 'documents_uploaded', 'submitted_for_review', 'rejected'])(
    'still shows for %s, because none of those means a person has checked the ID',
    (status) => {
      const { container } = render(
        <PendingVerificationBadge verificationStatus={status} currency="USD" isDonatable />,
      );
      expect(container).not.toBeEmptyDOMElement();
    },
  );

  it('renders nothing, and does NOT throw, on a currency CURRENCIES does not know', () => {
    expect(() => getCurrency('ZZZ')).toThrow();
    let container: HTMLElement | undefined;
    expect(() => {
      container = render(
        <PendingVerificationBadge verificationStatus="unverified" currency="ZZZ" isDonatable />,
      ).container;
    }).not.toThrow();
    expect(container).toBeEmptyDOMElement();
  });
  it('⛔ renders NOTHING when the campaign can no longer take money', () => {
    /*
      [VERIFIED 2026-10-27 in a browser, against a production build] this
      badge printed "This campaign can raise up to $500.00 until we do"
      directly above "It can no longer take donations" on a CLOSED campaign,
      and the same on a `completed` one.

      ⚠️ The class PREDATES serving `archived` (`docs/118` §9). `isDonatable`
      is `active || last_donor_zone`, so `completed`, `paused`, `suspended`
      and `cancelled` have all been served and non-donatable for months -
      serving `archived` added one more instance and is what made somebody
      look at it. `docs/119` §9.

      A ceiling on future giving is a claim about a future that cannot
      happen, which is the kind of unsubstantiated statement CLAUDE.md
      forbids outright.
    */
    const { container } = render(
      <PendingVerificationBadge
        verificationStatus="unverified"
        currency="USD"
        isDonatable={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('the donatable case still renders it (the control)', () => {
    // Without this, returning null always would satisfy the rule above and
    // silently remove a disclosure donors are owed on live campaigns.
    const { container } = render(
      <PendingVerificationBadge verificationStatus="unverified" currency="USD" isDonatable />,
    );
    expect(container).not.toBeEmptyDOMElement();
    expect(document.body.textContent).toMatch(/can raise up to/i);
  });

  it('⛔ the campaign page passes the real flag, not a literal', () => {
    const page = readFileSync(
      resolve(__dirname, '../../app/campaigns/[slug]/page.tsx'),
      'utf8',
    );
    expect(page).toContain('isDonatable={isDonatable}');
    expect(page).not.toMatch(/isDonatable=\{true\}/);
  });
});
