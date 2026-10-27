/**
 * What a donor is told when an organisation's word lifted the raise cap.
 *
 * ── WHY THE COPY ITSELF IS UNDER TEST ───────────────────────────────────────
 *
 * This is the only place on a public page where the platform reports a trust
 * decision it did not make itself. The whole trade in `docs/108` is that an
 * institution's assertion stands in for a document review - and that is only
 * acceptable while the donor is told so. One edit to this copy, from
 * "Confirmed by X" to "Verified", turns an honest statement into a claim the
 * platform cannot substantiate, which is the thing CLAUDE.md's rule on trust
 * copy is about and which the type system cannot notice.
 *
 * So the wording is asserted, including the sentences that are NOT allowed to
 * appear.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PendingVerificationBadge, VouchedByBadge } from '@/components/campaigns/TrustBadge';

const hospital = { institutionName: 'St Mary Hospital', institutionCountry: 'KE' };
const church = { institutionName: 'All Saints Cathedral', institutionCountry: 'KE' };

describe('VouchedByBadge', () => {
  it('names the organisation that confirmed the need', () => {
    render(<VouchedByBadge institutions={[hospital]} />);
    expect(screen.getByText(/Confirmed by St Mary Hospital/)).toBeInTheDocument();
  });

  it('⛔ says we have not seen the organiser’s ID', () => {
    const { container } = render(<VouchedByBadge institutions={[hospital]} />);
    expect(container.textContent).toMatch(/have not seen the organiser.s ID/i);
  });

  it('⛔ never claims the platform verified anything', () => {
    const { container } = render(<VouchedByBadge institutions={[hospital]} />);
    const text = container.textContent ?? '';
    for (const forbidden of [/\bverified\b/i, /\bverification\b/i, /document/i, /\bwe checked\b/i]) {
      expect(text, `copy must not contain ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('lists several organisations readably', () => {
    render(<VouchedByBadge institutions={[church, hospital]} />);
    expect(
      screen.getByText(/Confirmed by All Saints Cathedral and St Mary Hospital/),
    ).toBeInTheDocument();
  });

  it('renders nothing when no organisation has vouched', () => {
    const { container } = render(<VouchedByBadge institutions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('exactly one verification banner shows at a time', () => {
  /*
    The two banners are complementary by construction, not by a conditional
    at the call site: `PendingVerificationBadge` returns null once the status
    is cap-exempt, and `VouchedByBadge` is empty unless a live vouch was
    passed. A donor must never see "we have not checked this organiser's ID"
    and "Confirmed by St Mary Hospital" stacked on each other, and must never
    see neither.
  */
  it('shows the pending banner, and not the vouch banner, before a vouch', () => {
    const { container } = render(
      <>
        <PendingVerificationBadge verificationStatus="unverified" currency="USD" isDonatable />
        <VouchedByBadge institutions={[]} />
      </>,
    );
    expect(container.textContent).toMatch(/Pending verification/i);
    expect(container.textContent).not.toMatch(/Confirmed by/);
  });

  it('shows the vouch banner, and not the pending banner, after one', () => {
    const { container } = render(
      <>
        <PendingVerificationBadge verificationStatus="identity_verified" currency="USD" isDonatable />
        <VouchedByBadge institutions={[hospital]} />
      </>,
    );
    expect(container.textContent).not.toMatch(/Pending verification/i);
    expect(container.textContent).toMatch(/Confirmed by St Mary Hospital/);
  });
});
