/**
 * Live contract test: runs the REAL client against the REAL PayHero API.
 * Read-only. Never initiates a payment. Never prints credentials.
 */
import { describe, it, expect } from 'vitest';
import {
  getTransactionStatus,
  getWalletBalance,
  isPayHeroConfigured,
  PayHeroApiError,
} from '@/lib/payhero';

const LIVE = process.env.PAYHERO_LIVE_CONTRACT === '1';
const d = LIVE ? describe : describe.skip;

d('PayHero live contract (read-only)', () => {
  it('is configured from the environment', () => {
    expect(isPayHeroConfigured()).toBe(true);
  });

  it('reads the real service wallet', async () => {
    const w = await getWalletBalance();
    console.log(`  wallet: currency=${w.currency} status=${w.walletStatus} balance=${w.availableBalance}`);
    expect(w.currency).toBe('KES');
    expect(typeof w.availableBalance).toBe('number');
  });

  it('maps a real settled payment to SUCCESS', async () => {
    const ref = process.env.PAYHERO_KNOWN_SUCCESS_REF!;
    const s = await getTransactionStatus(ref);
    console.log(`  status=${s.status} amountMajor=${s.amountMajor} merchant=${s.merchant}`);
    expect(s.status).toBe('SUCCESS');
    expect(s.amountMajor).toBeGreaterThan(0);
    expect(s.providerReference).toBeTruthy();
  });

  it('errors on a reference PayHero has never seen', async () => {
    await expect(
      getTransactionStatus('LD-definitely-not-a-real-reference-0001'),
    ).rejects.toBeInstanceOf(PayHeroApiError);
  });

  // The leak, asserted against the live API so we notice if PayHero fixes it.
  it('still refuses a blank reference locally (the cross-merchant leak)', async () => {
    await expect(getTransactionStatus('  ')).rejects.toThrow(/non-empty reference/);
  });

  it('our own external_reference is NOT a valid lookup key', async () => {
    const ext = process.env.PAYHERO_KNOWN_EXTERNAL_REF!;
    const err = await getTransactionStatus(ext).catch((e) => e);
    expect(err).toBeInstanceOf(PayHeroApiError);
    expect((err as PayHeroApiError).status).toBe(404);
  });
});
