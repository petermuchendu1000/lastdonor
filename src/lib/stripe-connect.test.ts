/**
 * Connect account status mapping.
 *
 * `verified` used to require `charges_enabled`, but createExpressAccount()
 * requests the `transfers` capability only and never `card_payments`. On a
 * transfers-only Express account charges_enabled can stay false forever, so
 * the status could never reach 'verified' and the withdraw route - which
 * requires exactly that - rejected every withdrawal permanently. The platform
 * collects the money; the connected account only receives transfers.
 *
 * Whether Stripe really leaves charges_enabled false for a transfers-only
 * Express account is marked UNVERIFIED in the audit, and that is precisely why
 * the predicate is the defect: any false value bricks payouts forever, so the
 * gate is on what this platform actually needs.
 */

import { describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';

vi.mock('@/lib/stripe', () => ({ stripe: { accounts: {}, accountLinks: {} } }));

const { mapAccountToStatus, PLATFORM_PAYOUT_CURRENCY, isSupportedPayoutCurrency } =
  await import('./stripe-connect');

function account(overrides: Record<string, unknown> = {}): Stripe.Account {
  return {
    id: 'acct_123',
    charges_enabled: false,
    payouts_enabled: true,
    default_currency: 'usd',
    capabilities: { transfers: 'active' },
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
    ...overrides,
  } as unknown as Stripe.Account;
}

describe('mapAccountToStatus', () => {
  it('reports a transfers-only account as verified even though charges_enabled is false', () => {
    const info = mapAccountToStatus(account({ charges_enabled: false }));

    expect(info.status).toBe('verified');
    expect(info.chargesEnabled).toBe(false);
    expect(info.payoutsEnabled).toBe(true);
    expect(info.transfersCapability).toBe('active');
  });

  it('is not verified while the transfers capability is still pending', () => {
    const info = mapAccountToStatus(account({ capabilities: { transfers: 'pending' } }));
    expect(info.status).not.toBe('verified');
  });

  it('is not verified when the transfers capability is inactive or absent', () => {
    expect(mapAccountToStatus(account({ capabilities: { transfers: 'inactive' } })).status).not.toBe('verified');
    expect(mapAccountToStatus(account({ capabilities: {} })).status).not.toBe('verified');
  });

  it('is not verified while payouts are disabled', () => {
    const info = mapAccountToStatus(account({ payouts_enabled: false }));
    expect(info.status).not.toBe('verified');
  });

  it('is pending_verification while requirements are outstanding', () => {
    const info = mapAccountToStatus(
      account({ requirements: { currently_due: ['individual.id_number'], past_due: [], disabled_reason: null } }),
    );
    expect(info.status).toBe('pending_verification');
  });

  it('is restricted when requirements are past due', () => {
    const info = mapAccountToStatus(
      account({ requirements: { currently_due: [], past_due: ['individual.verification.document'], disabled_reason: null } }),
    );
    expect(info.status).toBe('restricted');
  });

  it.each([
    ['rejected.fraud'],
    ['rejected.terms_of_service'],
    ['rejected.listed'],
    ['rejected.other'],
  ])('is rejected for disabled_reason %s', (reason) => {
    const info = mapAccountToStatus(
      account({ requirements: { currently_due: [], past_due: [], disabled_reason: reason } }),
    );
    expect(info.status).toBe('rejected');
  });

  it('flags a settlement currency the ledger cannot pay out in', () => {
    expect(mapAccountToStatus(account({ default_currency: 'mxn' })).unsupportedCurrency).toBe(true);
    expect(mapAccountToStatus(account({ default_currency: 'jpy' })).unsupportedCurrency).toBe(true);
    expect(mapAccountToStatus(account({ default_currency: 'usd' })).unsupportedCurrency).toBe(false);
    expect(mapAccountToStatus(account({ default_currency: 'USD' })).unsupportedCurrency).toBe(false);
  });
});

describe('payout currency invariant', () => {
  it('is usd, because every inbound charge is created in usd', () => {
    expect(PLATFORM_PAYOUT_CURRENCY).toBe('usd');
  });

  it('accepts only usd, case-insensitively, and treats an unknown currency as usd', () => {
    expect(isSupportedPayoutCurrency('usd')).toBe(true);
    expect(isSupportedPayoutCurrency('USD')).toBe(true);
    expect(isSupportedPayoutCurrency(null)).toBe(true);
    expect(isSupportedPayoutCurrency(undefined)).toBe(true);
    expect(isSupportedPayoutCurrency('mxn')).toBe(false);
    expect(isSupportedPayoutCurrency('eur')).toBe(false);
    expect(isSupportedPayoutCurrency('jpy')).toBe(false);
  });
});
