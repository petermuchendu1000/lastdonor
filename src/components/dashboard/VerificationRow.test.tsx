/**
 * The organiser's route into identity verification.
 *
 * The Didit integration, the verification page and the API route all
 * worked, and no organiser could reach any of them: the only link was an
 * "urgent action" banner gated on `status === 'active' && donorCount > 0`,
 * and after docs/79 and docs/72 neither condition is satisfiable. A
 * working integration behind a door nobody can open is not shipped.
 *
 * These tests pin the door open. See docs/83.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerificationRow } from './VerificationRow';

const CAMPAIGN = 'c-1';
const HREF = `/dashboard/campaigns/${CAMPAIGN}/verification`;

/** Every value of the `verification_status` enum. */
const ALL_STATUSES = [
  'unverified',
  'pending',
  'verified',
  'submitted_for_review',
  'documents_uploaded',
  'identity_verified',
  'fully_verified',
  'info_requested',
  'rejected',
  'suspended',
] as const;

describe('the link is reachable', () => {
  it('offers a way in when nothing has happened yet', () => {
    render(<VerificationRow campaignId={CAMPAIGN} status="unverified" />);
    expect(screen.getByRole('link', { name: 'Verify identity' })).toHaveAttribute('href', HREF);
  });

  /*
    The whole point. No donor, not active, nothing urgent - and the
    organiser can still get to verification.
  */
  it.each(ALL_STATUSES.filter((s) => s !== 'fully_verified' && s !== 'verified'))(
    'offers a way in from %s',
    (status) => {
      render(<VerificationRow campaignId={CAMPAIGN} status={status} />);
      expect(screen.getByRole('link')).toHaveAttribute('href', HREF);
    },
  );

  it.each(['fully_verified', 'verified'])(
    'offers no action from %s, because there is nothing left to do',
    (status) => {
      render(<VerificationRow campaignId={CAMPAIGN} status={status} />);
      expect(screen.queryByRole('link')).toBeNull();
    },
  );
});

describe('it says where the organiser actually stands', () => {
  it.each(ALL_STATUSES)('%s renders a human label, never the raw enum', (status) => {
    render(<VerificationRow campaignId={CAMPAIGN} status={status} />);
    // No snake_case leaking into the page.
    expect(document.body.textContent).not.toContain(status.includes('_') ? status : '\u0000');
  });

  it('distinguishes "in progress" from "needs you"', () => {
    const pending = render(<VerificationRow campaignId={CAMPAIGN} status="pending" />);
    expect(pending.container.textContent).toMatch(/in progress/i);

    const needsYou = render(<VerificationRow campaignId={CAMPAIGN} status="info_requested" />);
    expect(needsYou.container.textContent).toMatch(/more information needed/i);
  });

  it('does not call a failed check "verified"', () => {
    render(<VerificationRow campaignId={CAMPAIGN} status="rejected" />);
    expect(screen.getByText(/did not pass/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Identity verified$/)).toBeNull();
  });
});

describe('an unknown status', () => {
  /*
    A new enum value must look odd, not silently remove the only route to
    verification - which is the exact failure this component exists to fix.
  */
  it('still renders a way in', () => {
    render(<VerificationRow campaignId={CAMPAIGN} status="some_future_state" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', HREF);
    expect(screen.getByText('some future state')).toBeInTheDocument();
  });
});
