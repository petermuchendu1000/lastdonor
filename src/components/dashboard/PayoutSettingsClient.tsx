'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Money } from '@/components/ui/Money';
import { formatMoney, majorToMinor, minorToMajor } from '@/lib/money/format';
// Zod-only module: safe in a client component, unlike @/lib/stripe-connect.
import { PLATFORM_PAYOUT_CURRENCY, isSupportedPayoutCurrency } from '@/lib/validators/payout';
import {
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

// ─── Types ───────────────────────────────────────────────────────────

interface ConnectStatus {
  hasAccount: boolean;
  status: string;
  onboardedAt: string | null;
  payoutCurrency: string | null;
}

interface CampaignBalance {
  id: string;
  title: string | null;
  slug: string | null;
  status: string | null;
  goalAmount: number;
  /** The campaign's own currency; every amount here is in ITS minor units. */
  currency: string;
  raisedAmount: number;
  totalReleasedAmount: number;
  totalWithdrawnAmount: number;
  availableBalance: number;
}

interface Withdrawal {
  id: string;
  campaignId: string;
  /** The currency of the campaign the money came out of. */
  currency: string;
  amount: number;
  status: string;
  stripeTransferId: string | null;
  failureReason: string | null;
  requestedAt: string;
  processedAt: string | null;
}

interface PayoutSettingsProps {
  connectStatus: ConnectStatus;
  campaigns: CampaignBalance[];
  withdrawals: Withdrawal[];
  connectAvailable: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/*
  ⛔ A local `centsToDollars` with a hardcoded `currency: 'USD'` used to live
  here - a SIXTH hand-rolled currency formatter, after the five `docs/88`
  F4/F5 removed from admin, on the screen where an organiser connects the
  account their money lands in. Every amount column is an INTEGER in the minor
  units of ITS OWN ROW'S currency (`docs/92`). Render through `<Money>`; use
  `formatMoney` where a plain string is needed.
*/

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  not_started: { label: 'Not Started', variant: 'outline' },
  onboarding_started: { label: 'Onboarding In Progress', variant: 'secondary' },
  pending_verification: { label: 'Pending Verification', variant: 'secondary' },
  verified: { label: 'Verified', variant: 'default' },
  restricted: { label: 'Pending Review', variant: 'secondary' },
  // Stripe rejects an account outright (fraud, ToS, sanctions list). It can
  // never be used again and the API returns 409 forever once an account id is
  // stored, so 'Needs Attention' with no button was a dead end.
  rejected: { label: 'Account Cannot Be Used', variant: 'destructive' },
};

/**
 * Mints a v4 UUID for the withdrawal idempotency key.
 * crypto.randomUUID() is unavailable in non-secure contexts, so there is a
 * Math.random fallback: a weak key is still a key, and a missing one means the
 * request is rejected outright.
 */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.trunc(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const WITHDRAWAL_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  requested: { label: 'Requested', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  approved: { label: 'Approved', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  processing: { label: 'Processing', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  rejected: { label: 'Needs Review', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
  failed: { label: 'Unsuccessful', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

// ─── Component ───────────────────────────────────────────────────────

export function PayoutSettingsClient({ connectStatus, campaigns, withdrawals, connectAvailable }: PayoutSettingsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [withdrawAmounts, setWithdrawAmounts] = useState<Record<string, string>>({});
  // One idempotency key per campaign per form-fill. Minted when the amount is
  // first typed, NOT per click: a double-clicked Withdraw button must send the
  // same key twice so the server dedups it instead of transferring twice. The
  // key is discarded only after the withdrawal is accepted.
  const [withdrawKeys, setWithdrawKeys] = useState<Record<string, string>>({});

  const setWithdrawAmount = useCallback((campaignId: string, value: string) => {
    setWithdrawAmounts((prev) => ({ ...prev, [campaignId]: value }));
    setWithdrawKeys((prev) => (prev[campaignId] ? prev : { ...prev, [campaignId]: newIdempotencyKey() }));
  }, []);

  const handleSetupAccount = useCallback(async (country?: string) => {
    setLoading('setup');
    try {
      const res = await fetch('/api/v1/user/stripe-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(country ? { country } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Failed to create account');
        return;
      }
      // Redirect to Stripe onboarding
      window.location.href = data.data.onboardingUrl;
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(null);
    }
  }, []);

  const handleResumeOnboarding = useCallback(async () => {
    setLoading('onboarding');
    try {
      const res = await fetch('/api/v1/user/stripe-connect/onboarding', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Failed to generate link');
        return;
      }
      window.location.href = data.data.onboardingUrl;
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(null);
    }
  }, []);

  const handleWithdraw = useCallback(async (campaignId: string) => {
    const amountStr = withdrawAmounts[campaignId];
    const major = parseFloat(amountStr);
    if (!amountStr || isNaN(major) || major <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    /*
      ⛔ This was `Math.round(dollars * 100)`. KES and USD share exponent 2,
      so it was right by coincidence; a zero-decimal currency (UGX, RWF, XOF,
      XAF - `docs/103`) would have been sent 100x the requested amount.
      `majorToMinor` reads the currency's own exponent.
    */
    const currency = campaigns.find((c) => c.id === campaignId)?.currency;
    if (!currency) {
      toast.error('Could not find that campaign');
      return;
    }
    const minor = majorToMinor(major, currency);

    // The server requires this key; omitting it 400s every withdrawal.
    const idempotencyKey = withdrawKeys[campaignId] ?? newIdempotencyKey();
    setWithdrawKeys((prev) => (prev[campaignId] ? prev : { ...prev, [campaignId]: idempotencyKey }));

    setLoading(`withdraw-${campaignId}`);
    try {
      const res = await fetch(`/api/v1/user-campaigns/${campaignId}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: minor, idempotencyKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Withdrawal failed');
        return;
      }
      toast.success(`Withdrawal of ${formatMoney(minor, currency, 'exact')} initiated`);
      setWithdrawAmounts((prev) => ({ ...prev, [campaignId]: '' }));
      // Only now is the key spent: a new form-fill gets a new one.
      setWithdrawKeys((prev) => {
        const next = { ...prev };
        delete next[campaignId];
        return next;
      });
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(null);
    }
  }, [withdrawAmounts, withdrawKeys, router, campaigns]);

  const statusInfo = STATUS_CONFIG[connectStatus.status] ?? STATUS_CONFIG.not_started;
  const isVerified = connectStatus.status === 'verified';
  const isRejected = connectStatus.status === 'rejected';
  // Surfaced here, at account level, rather than at the moment of transfer:
  // the ledger is USD cents and nothing in the platform converts currency, so
  // a non-USD settlement currency blocks every withdrawal on this account.
  const currencyUnsupported = !isSupportedPayoutCurrency(connectStatus.payoutCurrency);
  const canWithdraw = isVerified && !currencyUnsupported;

  return (
    <div className="space-y-8">
      {/* Section 1: Account Setup / Status */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Payout Account
          </h2>
        </div>

        {!connectStatus.hasAccount ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Connect your bank account through Stripe to receive funds from your campaigns.
              Stripe handles identity verification, tax forms, and secure payouts.
            </p>
            {connectAvailable ? (
              <Button
                onClick={() => handleSetupAccount()}
                disabled={loading === 'setup'}
                className="bg-teal-700 hover:bg-teal-800"
              >
                {loading === 'setup' ? 'Setting up...' : 'Connect with Stripe'}
              </Button>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/20">
                <div className="flex items-start gap-3">
                  <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Payouts are not available yet
                    </p>
                    <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                      Stripe Connect has not been activated on this platform.
                      The platform administrator needs to complete the Connect platform profile
                      in the Stripe Dashboard before campaign creators can receive payouts.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant={statusInfo.variant}>
                {statusInfo.label}
              </Badge>
              {connectStatus.payoutCurrency && (
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Currency: {connectStatus.payoutCurrency.toUpperCase()}
                </span>
              )}
            </div>

            {connectStatus.onboardedAt && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Connected since {formatDate(connectStatus.onboardedAt)}
              </p>
            )}

            {isRejected && (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-900/20">
                <div className="flex items-start gap-3">
                  <ExclamationTriangleIcon className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-red-800 dark:text-red-300">
                      This payout account cannot be used
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-400">
                      Stripe has declined this connected account, and that decision cannot be
                      changed from here or by starting the setup again. Until a replacement account
                      is connected for you, withdrawals are unavailable, and any funds already
                      released stay in your balance and are not lost.
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-400">
                      Email{' '}
                      <a
                        href="mailto:support@lastdonor.org?subject=Payout%20account%20declined"
                        className="font-medium underline underline-offset-2 hover:no-underline"
                      >
                        support@lastdonor.org
                      </a>{' '}
                      to have your payout account reviewed and reconnected. Stripe may also have
                      emailed you with its reason.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {currencyUnsupported && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/20">
                <div className="flex items-start gap-3">
                  <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Withdrawals are blocked on this account&apos;s currency
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Your payout account settles in{' '}
                      {connectStatus.payoutCurrency?.toUpperCase()}, but donations are collected
                      and tracked in {PLATFORM_PAYOUT_CURRENCY.toUpperCase()} and we do not convert
                      between currencies. Paying out as-is would send you the wrong amount, so
                      withdrawals are blocked rather than risked.
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Email{' '}
                      <a
                        href="mailto:support@lastdonor.org?subject=Payout%20currency%20mismatch"
                        className="font-medium underline underline-offset-2 hover:no-underline"
                      >
                        support@lastdonor.org
                      </a>{' '}
                      to arrange your payout. Your released balance is unaffected.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              {(connectStatus.status === 'onboarding_started' || connectStatus.status === 'pending_verification' || connectStatus.status === 'restricted') && (
                <Button
                  variant="outline"
                  onClick={handleResumeOnboarding}
                  disabled={loading === 'onboarding'}
                >
                  {connectStatus.status === 'restricted' ? 'Fix Account Issues' : connectStatus.status === 'pending_verification' ? 'Complete Verification' : 'Resume Onboarding'}
                </Button>
              )}

            </div>
          </div>
        )}
      </section>

      {/* Section 2: Campaign Balances */}
      {campaigns.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Campaign Balances
          </h2>

          <div className="space-y-4">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="rounded-lg border border-gray-100 p-4 dark:border-gray-800"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {campaign.title ?? 'Untitled Campaign'}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                      <span>
                        Raised: <span className="font-mono font-medium text-gray-700 dark:text-gray-300"><Money minor={campaign.raisedAmount} currency={campaign.currency} precision="exact" /></span>
                      </span>
                      <span>
                        Released: <span className="font-mono font-medium text-gray-700 dark:text-gray-300"><Money minor={campaign.totalReleasedAmount} currency={campaign.currency} precision="exact" /></span>
                      </span>
                      <span>
                        Withdrawn: <span className="font-mono font-medium text-gray-700 dark:text-gray-300"><Money minor={campaign.totalWithdrawnAmount} currency={campaign.currency} precision="exact" /></span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Available</p>
                      <p className={cn(
                        'font-mono text-lg font-semibold',
                        campaign.availableBalance > 0
                          ? 'text-teal-700 dark:text-teal-400'
                          : 'text-gray-400 dark:text-gray-600',
                      )}>
                        <Money minor={campaign.availableBalance} currency={campaign.currency} precision="exact" />
                      </p>
                    </div>

                    {canWithdraw && campaign.availableBalance > 0 && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={minorToMajor(1, campaign.currency)}
                          step={minorToMajor(1, campaign.currency)}
                          max={minorToMajor(campaign.availableBalance, campaign.currency)}
                          placeholder={`Amount (${campaign.currency})`}
                          aria-label={`Withdrawal amount in ${campaign.currency}`}
                          value={withdrawAmounts[campaign.id] ?? ''}
                          onChange={(e) => setWithdrawAmount(campaign.id, e.target.value)}
                          className="w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        />
                        <Button
                          size="sm"
                          onClick={() => handleWithdraw(campaign.id)}
                          disabled={loading === `withdraw-${campaign.id}`}
                          className="bg-teal-700 hover:bg-teal-800"
                        >
                          {loading === `withdraw-${campaign.id}` ? 'Processing...' : 'Withdraw'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 3: Withdrawal History */}
      {withdrawals.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Withdrawal History
          </h2>

          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-gray-400">Date</th>
                  <th className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-gray-400">Campaign</th>
                  <th className="py-2 pr-4 text-right font-medium text-gray-500 dark:text-gray-400">Amount</th>
                  <th className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-gray-400">Status</th>
                  <th className="py-2 text-left font-medium text-gray-500 dark:text-gray-400">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {withdrawals.map((w) => {
                  const campaign = campaigns.find((c) => c.id === w.campaignId);
                  const statusConfig = WITHDRAWAL_STATUS_CONFIG[w.status] ?? WITHDRAWAL_STATUS_CONFIG.requested;

                  return (
                    <tr key={w.id}>
                      <td className="py-3 pr-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                        {formatDate(w.requestedAt)}
                      </td>
                      <td className="py-3 pr-4 text-gray-900 dark:text-gray-100 truncate max-w-[200px]">
                        {campaign?.title ?? 'Unknown'}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono font-medium text-gray-900 dark:text-gray-100">
                        <Money minor={w.amount} currency={w.currency} precision="exact" />
                      </td>
                      <td className="py-3 pr-4">
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', statusConfig.className)}>
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="py-3 text-xs text-gray-500 dark:text-gray-400">
                        {w.failureReason && (
                          <span className="text-red-600 dark:text-red-400">{w.failureReason}</span>
                        )}
                        {w.stripeTransferId && !w.failureReason && (
                          <span className="font-mono">{w.stripeTransferId}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Empty state */}
      {campaigns.length === 0 && (
        <section className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            You don&apos;t have any campaigns yet. Create a campaign to start receiving funds.
          </p>
        </section>
      )}
    </div>
  );
}
