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

describe('PendingVerificationBadge', () => {
  it('tells a donor the campaign is unverified and names the USD cap', () => {
    render(<PendingVerificationBadge verificationStatus="unverified" currency="USD" />);
    expect(screen.getByText(/Pending verification/i)).toBeInTheDocument();
    const cap = formatMoney(getCurrency('USD').unverifiedCapMinor, 'USD', 'exact');
    expect(screen.getByText(new RegExp(cap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
  });

  it('names the KES cap on a KES campaign, not the USD one', () => {
    render(<PendingVerificationBadge verificationStatus="unverified" currency="KES" />);
    const kesCap = formatMoney(getCurrency('KES').unverifiedCapMinor, 'KES', 'exact');
    const usdCap = formatMoney(getCurrency('USD').unverifiedCapMinor, 'USD', 'exact');
    const body = document.body.textContent ?? '';
    expect(body).toContain(kesCap);
    expect(body).not.toContain(usdCap);
  });

  it('says payout is blocked too, because that is the consequence a donor cares about', () => {
    render(<PendingVerificationBadge verificationStatus="unverified" currency="USD" />);
    expect(document.body.textContent).toMatch(/no money can be paid out/i);
  });

  it.each(['identity_verified', 'fully_verified'])(
    'renders nothing once the campaign is %s',
    (status) => {
      const { container } = render(
        <PendingVerificationBadge verificationStatus={status} currency="USD" />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );

  it.each(['pending', 'documents_uploaded', 'submitted_for_review', 'rejected'])(
    'still shows for %s, because none of those means a person has checked the ID',
    (status) => {
      const { container } = render(
        <PendingVerificationBadge verificationStatus={status} currency="USD" />,
      );
      expect(container).not.toBeEmptyDOMElement();
    },
  );

  it('renders nothing, and does NOT throw, on a currency CURRENCIES does not know', () => {
    expect(() => getCurrency('ZZZ')).toThrow();
    let container: HTMLElement | undefined;
    expect(() => {
      container = render(
        <PendingVerificationBadge verificationStatus="unverified" currency="ZZZ" />,
      ).container;
    }).not.toThrow();
    expect(container).toBeEmptyDOMElement();
  });
});
