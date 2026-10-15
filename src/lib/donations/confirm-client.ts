import type { DonationReturnState } from '@/lib/donations/verify-return';

/**
 * Browser-side wrapper around POST /api/v1/donations/confirm.
 *
 * The donate page and the embedded-checkout completion handler both need the
 * same thing: ask the server what Stripe says about this payment. Neither is
 * allowed to decide that for itself, so both go through here.
 *
 * Anything unexpected (network failure, non-JSON body, unknown state) maps to
 * `unverified`, which renders a pending state rather than a receipt.
 */

export interface ConfirmDonationResult {
  state: DonationReturnState;
  /** Cents, as reported by Stripe via the server. Null unless verified succeeded. */
  amountCents: number | null;
}

const UNVERIFIED: ConfirmDonationResult = { state: 'unverified', amountCents: null };

const KNOWN_STATES: readonly DonationReturnState[] = [
  'succeeded',
  'processing',
  'failed',
  'unverified',
];

export async function confirmDonation({
  campaignId,
  sessionId,
  paymentIntentId,
}: {
  campaignId: string;
  sessionId?: string;
  paymentIntentId?: string;
}): Promise<ConfirmDonationResult> {
  if (!sessionId && !paymentIntentId) return UNVERIFIED;

  try {
    const res = await fetch('/api/v1/donations/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId,
        ...(sessionId ? { sessionId } : {}),
        ...(paymentIntentId ? { paymentIntentId } : {}),
      }),
    });

    const json = await res.json();
    if (!json || json.ok !== true) return UNVERIFIED;

    const state = KNOWN_STATES.includes(json.state) ? (json.state as DonationReturnState) : 'unverified';
    const amountCents =
      state === 'succeeded' && typeof json.amount === 'number' && json.amount > 0
        ? json.amount
        : null;

    return { state, amountCents };
  } catch {
    return UNVERIFIED;
  }
}
