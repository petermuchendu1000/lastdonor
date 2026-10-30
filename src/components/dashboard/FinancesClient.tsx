'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { campaignStatusLabel } from '@/lib/campaign-labels';
import { Money } from '@/components/ui/Money';
import { formatMoney, majorToMinor, minorToMajor } from '@/lib/money/format';
import { PLATFORM_PAYOUT_CURRENCY } from '@/lib/validators/payout';
import {
  financeTotalsByCurrency,
  type FinanceCurrencyTotals,
} from '@/lib/dashboard-finance-totals';

// ─── Types ───────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  title: string;
  slug: string;
  status: string;
  /** The campaign's own currency. Every amount below is in ITS minor units. */
  currency: string;
  goalAmount: number;
  raisedAmount: number;
  totalReleasedAmount: number;
  totalWithdrawnAmount: number;
  inFlightAmount: number;
  availableBalance: number;
}

interface Withdrawal {
  id: string;
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  /*
    Resolved on the server from `status` + `published_at` (`docs/131`). The
    donation history on the sibling screen has been gated since `docs/109`;
    this withdrawal list never was. `docs/154`.
  */
  campaignHref: string | null;
  /** The campaign's currency - a withdrawal is in the money it came from. */
  currency: string;
  amount: number;
  status: string;
  notes: string | null;
  failureReason: string | null;
  requestedAt: string;
  processedAt: string | null;
}

interface FinancesClientProps {
  stripeConnectStatus: string;
  hasStripeAccount: boolean;
  campaigns: Campaign[];
  withdrawals: Withdrawal[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

/*
  ⛔ A local `fmt(cents) => '$' + cents / 100` used to live here - a FIFTH
  hand-rolled currency formatter of the kind `docs/88` F4/F5 removed from
  admin, on the screen an organiser uses to take their money out. Every amount
  column is an INTEGER in the minor units of ITS OWN ROW'S currency
  (`docs/92`), and KES has the same exponent as USD, so the figures were right
  and the SYMBOL was wrong - a shilling total under a dollar sign.

  Render through `<Money>`; where a plain string is needed (a toast, an action
  sentence) use `formatMoney`.
*/

/**
 * One figure per currency, for a tile that used to hold a single blended sum.
 *
 * With one currency - which is every organiser on this platform today - this
 * renders exactly what the old tile did.
 */
function TotalLines({
  rows,
  pick,
  className,
}: {
  rows: readonly FinanceCurrencyTotals[];
  pick: (row: FinanceCurrencyTotals) => number;
  className?: string;
}) {
  if (rows.length === 0) {
    return <p className={className}>-</p>;
  }
  return (
    <>
      {rows.map((row) => (
        <p key={row.currency} className={className}>
          <Money minor={pick(row)} currency={row.currency} precision="exact" />
        </p>
      ))}
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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

// ─── Status Config ───────────────────────────────────────────────────

const WD_STATUS: Record<string, { label: string; className: string }> = {
  requested:  { label: 'Requested',  className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  approved:   { label: 'Approved',   className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  processing: { label: 'Processing', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  completed:  { label: 'Completed',  className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  rejected:   { label: 'Rejected',   className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  failed:     { label: 'Failed',     className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

const FILTER_OPTIONS = ['all', 'requested', 'approved', 'processing', 'completed', 'rejected', 'failed'] as const;

// ─── Component ───────────────────────────────────────────────────────

export default function FinancesClient({
  stripeConnectStatus,
  hasStripeAccount,
  campaigns,
  withdrawals,
}: FinancesClientProps) {
  const router = useRouter();
  const isVerified = stripeConnectStatus === 'verified';
  /*
    Derived from `PLATFORM_PAYOUT_CURRENCY`, the same constant
    `withdraw/route.ts` refuses on, rather than a literal 'USD' here. If the
    rail ever gains a currency, both ends move together.
  */
  const isPayableCurrency = (currency: string) =>
    currency.toUpperCase() === PLATFORM_PAYOUT_CURRENCY.toUpperCase();

  // Withdraw form state
  const [withdrawAmounts, setWithdrawAmounts] = useState<Record<string, string>>({});
  // One idempotency key per campaign per form-fill. Minted when the amount is
  // first typed, NOT per click: a double-clicked Withdraw button must send the
  // same key twice so the server dedups it instead of transferring twice. The
  // key is discarded only after the withdrawal is accepted.
  const [withdrawKeys, setWithdrawKeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  const setWithdrawAmount = useCallback((campaignId: string, value: string) => {
    setWithdrawAmounts((prev) => ({ ...prev, [campaignId]: value }));
    setWithdrawKeys((prev) => (prev[campaignId] ? prev : { ...prev, [campaignId]: newIdempotencyKey() }));
  }, []);

  /*
    ⛔ These were four `campaigns.reduce(…)` calls producing one number each.
    A campaign is single-currency by composite FK (`docs/92`); a PERSON is
    not, so an organiser holding a KES and a USD campaign got four figures
    that were the sum of two different kinds of money. Grouped by
    `financeTotalsByCurrency`, which is pure and unit-tested (`docs/107`).
  */
  const totals = financeTotalsByCurrency(campaigns);
  const anyAvailable = totals.some((t) => t.availableMinor > 0);
  const anyPending = totals.some((t) => t.pendingReleaseMinor > 0);
  const availableSentence = totals
    .filter((t) => t.availableMinor > 0)
    .map((t) => formatMoney(t.availableMinor, t.currency, 'exact'))
    .join(' and ');

  // Build action items
  const actions: Array<{
    type: string;
    text: string;
    href?: string;
    severity: 'warning' | 'info' | 'error';
  }> = [];

  if (!isVerified && campaigns.length > 0) {
    if (!hasStripeAccount || stripeConnectStatus === 'not_started') {
      actions.push({
        type: 'stripe_setup',
        text: `Set up your payout account to withdraw funds${anyAvailable ? ` (${availableSentence} available now)` : ''}`,
        href: '/dashboard/payout-settings',
        severity: 'warning',
      });
    } else if (stripeConnectStatus === 'onboarding_started' || stripeConnectStatus === 'restricted') {
      actions.push({
        type: 'stripe_resume',
        text:
          stripeConnectStatus === 'restricted'
            ? 'Your payout account needs attention. Fix issues to continue receiving funds.'
            : 'Complete your payout account setup to enable withdrawals.',
        href: '/dashboard/payout-settings',
        severity: 'warning',
      });
    } else if (stripeConnectStatus === 'pending_verification') {
      actions.push({
        type: 'stripe_pending',
        text: 'Your payout account is being verified. You will be able to withdraw once approved.',
        severity: 'info',
      });
    }
  }

  const filteredWithdrawals = filter === 'all' ? withdrawals : withdrawals.filter((w) => w.status === filter);

  const handleWithdraw = useCallback(
    async (campaignId: string) => {
      const amountStr = withdrawAmounts[campaignId];
      const major = parseFloat(amountStr);
      if (!amountStr || isNaN(major) || major <= 0) {
        toast.error('Enter a valid amount');
        return;
      }
      /*
        ⛔ This was `Math.round(dollars * 100)`. KES and USD both have
        exponent 2 so the arithmetic was right by coincidence; a zero-decimal
        currency (UGX, RWF, XOF, XAF - `docs/103`) would have been sent 100x
        the requested amount. `majorToMinor` reads the currency's own
        exponent. The same hardcoded 100 is the mutation survivor `docs/102`
        records fixing rather than excusing.
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
    },
    [withdrawAmounts, withdrawKeys, router, campaigns],
  );

  // ─── Empty state: no campaigns ────────────────────────────────────
  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No campaigns yet. Create a campaign to start receiving funds.
        </p>
        {/*
          ⛔ Was `href="/dashboard/campaigns"` labelled "Create Campaign" - it
          pointed at the LIST, not the wizard, so the one button offered to
          somebody with no campaigns did not do what it said. The wizard is
          `/share-your-story` (`docs/119`).
        */}
        <Link
          href="/share-your-story"
          className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Create Campaign
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ─── 1. Summary Cards ──────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Total Raised</p>
            <TotalLines
              rows={totals}
              pick={(t) => t.raisedMinor}
              className="mt-1 font-mono text-2xl font-bold text-foreground"
            />
            <p className="mt-0.5 text-xs text-muted-foreground">
              across {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card className={anyAvailable ? 'border-green-200 dark:border-green-900' : ''}>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Available to Withdraw</p>
            <TotalLines
              rows={totals}
              pick={(t) => t.availableMinor}
              className={`mt-1 font-mono text-2xl font-bold ${
                anyAvailable ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
              }`}
            />
            <p className="mt-0.5 text-xs text-muted-foreground">released and ready</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Pending Release</p>
            <TotalLines
              rows={totals}
              pick={(t) => t.pendingReleaseMinor}
              className={`mt-1 font-mono text-2xl font-bold ${
                anyPending ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
              }`}
            />
            <p className="mt-0.5 text-xs text-muted-foreground">awaiting verification</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Total Withdrawn</p>
            <TotalLines
              rows={totals}
              pick={(t) => t.withdrawnMinor}
              className="mt-1 font-mono text-2xl font-bold text-foreground"
            />
            <p className="mt-0.5 text-xs text-muted-foreground">paid to your account</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── 2. Action Items ───────────────────────────────────────── */}
      {actions.length > 0 && (
        <div className="space-y-3">
          {actions.map((action, i) => {
            const colors = {
              error: {
                bg: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
                text: 'text-red-800 dark:text-red-300',
                link: 'text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300',
              },
              warning: {
                bg: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
                text: 'text-amber-800 dark:text-amber-300',
                link: 'text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300',
              },
              info: {
                bg: 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30',
                text: 'text-blue-800 dark:text-blue-300',
                link: 'text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300',
              },
            }[action.severity];

            return (
              <div
                key={`${action.type}-${i}`}
                className={`flex items-center gap-3 rounded-lg border p-4 ${colors.bg}`}
              >
                <p className={`flex-1 min-w-0 text-sm font-medium ${colors.text}`}>{action.text}</p>
                {action.href && (
                  <Link
                    href={action.href}
                    className={`shrink-0 text-sm font-medium ${colors.link}`}
                  >
                    Take Action
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── 3. Per-Campaign Finances ──────────────────────────────── */}
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-foreground">Campaign Finances</h2>
        {campaigns.map((campaign) => {
          const releasePercent =
            campaign.raisedAmount > 0
              ? Math.round((campaign.totalReleasedAmount / campaign.raisedAmount) * 100)
              : 0;

          return (
            <Card key={campaign.id}>
              <CardContent className="p-5">
                {/* Header */}
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/dashboard/campaigns/${campaign.id}`}
                    className="min-w-0 truncate font-semibold text-foreground hover:text-primary"
                  >
                    {campaign.title}
                  </Link>
                  <Badge variant="outline" className="shrink-0">
                    {campaignStatusLabel(campaign.status)}
                  </Badge>
                </div>

                {/* Financial grid */}
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Raised</p>
                    <p className="font-mono text-sm font-semibold text-foreground">
                      <Money minor={campaign.raisedAmount} currency={campaign.currency} precision="exact" />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Released</p>
                    <p className="font-mono text-sm font-semibold text-foreground">
                      <Money minor={campaign.totalReleasedAmount} currency={campaign.currency} precision="exact" />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Available</p>
                    <p
                      className={`font-mono text-sm font-semibold ${
                        campaign.availableBalance > 0
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-muted-foreground'
                      }`}
                    >
                      <Money minor={campaign.availableBalance} currency={campaign.currency} precision="exact" />
                    </p>
                    {campaign.inFlightAmount > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        <Money minor={campaign.inFlightAmount} currency={campaign.currency} precision="exact" /> processing
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Withdrawn</p>
                    <p className="font-mono text-sm font-semibold text-foreground">
                      <Money minor={campaign.totalWithdrawnAmount} currency={campaign.currency} precision="exact" />
                    </p>
                  </div>
                </div>

                {/* Release progress bar */}
                {campaign.raisedAmount > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Payout progress</span>
                      <span>{releasePercent}% released</span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-green-500 transition-all"
                        style={{ width: `${Math.min(100, releasePercent)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Withdraw inline: Stripe verified + balance available */}
                {isVerified && isPayableCurrency(campaign.currency) && campaign.availableBalance > 0 && (
                  <div className="mt-4 flex flex-col gap-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/20 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                      <Money minor={campaign.availableBalance} currency={campaign.currency} precision="exact" /> available to withdraw
                    </p>
                    <div className="flex items-center gap-2">
                      {/*
                        ⛔ This used to be a literal `$` with min/step of
                        "0.01" and `max={availableBalance / 100}` - a dollar
                        field over whatever currency the campaign holds, and a
                        divide-by-100 that understates a zero-decimal currency
                        100x (`docs/92`, `docs/103`). The code, the step and
                        the ceiling now come from the campaign's own currency.
                      */}
                      <span className="text-sm text-green-700 dark:text-green-400">
                        {campaign.currency}
                      </span>
                      <input
                        type="number"
                        min={minorToMajor(1, campaign.currency)}
                        step={minorToMajor(1, campaign.currency)}
                        max={minorToMajor(campaign.availableBalance, campaign.currency)}
                        placeholder={String(minorToMajor(1, campaign.currency))}
                        value={withdrawAmounts[campaign.id] ?? ''}
                        onChange={(e) => setWithdrawAmount(campaign.id, e.target.value)}
                        className="w-24 rounded-md border border-green-300 bg-white px-2 py-1.5 text-sm font-mono focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 dark:border-green-700 dark:bg-green-950 dark:text-green-100"
                        aria-label={`Withdrawal amount for ${campaign.title}`}
                      />
                      <Button
                        size="sm"
                        onClick={() => handleWithdraw(campaign.id)}
                        disabled={loading === `withdraw-${campaign.id}`}
                        className="bg-green-700 hover:bg-green-800 text-white"
                      >
                        {loading === `withdraw-${campaign.id}` ? 'Processing...' : 'Withdraw'}
                      </Button>
                    </div>
                  </div>
                )}

                {/*
                  ⛔ A balance the payout rail cannot pay.

                  The Withdraw form above was gated on `isVerified` and a
                  positive balance and NOTHING ELSE, while
                  `withdraw/route.ts` refuses any campaign whose currency is
                  not `PLATFORM_PAYOUT_CURRENCY` - so a shilling campaign with
                  a released balance rendered a live Withdraw button that the
                  server answers 400 `WRONG_PAYMENT_RAIL` to. `docs/119`'s
                  rule: a step may offer an action only if its target will
                  accept it. The predicate is derived from the route's own
                  constant, so the two cannot drift. `docs/121`.
                */}
                {isVerified && !isPayableCurrency(campaign.currency) && campaign.availableBalance > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      <Money minor={campaign.availableBalance} currency={campaign.currency} precision="exact" />{' '}
                      is held for this campaign. We cannot pay out {campaign.currency} yet, so
                      there is nothing for you to do here. Email{' '}
                      <a href="mailto:support@lastdonor.org" className="underline">
                        support@lastdonor.org
                      </a>{' '}
                      and a person will reply.
                    </p>
                  </div>
                )}

                {/* Stripe not set up but balance available */}
                {!isVerified && campaign.availableBalance > 0 && (
                  <div className="mt-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      <Money minor={campaign.availableBalance} currency={campaign.currency} precision="exact" /> available. Set up your payout account to
                      withdraw.
                    </p>
                    <Link
                      href="/dashboard/payout-settings"
                      className="shrink-0 text-sm font-medium text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
                    >
                      Set Up &rarr;
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ─── 4. Withdrawal History ─────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Withdrawal History</h2>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((opt) => {
            const count =
              opt === 'all' ? withdrawals.length : withdrawals.filter((w) => w.status === opt).length;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setFilter(opt)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === opt
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {opt === 'all' ? 'All' : opt.charAt(0).toUpperCase() + opt.slice(1)} ({count})
              </button>
            );
          })}
        </div>

        {/* List */}
        {filteredWithdrawals.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {withdrawals.length === 0
                ? 'No withdrawal requests yet'
                : 'No withdrawals match the selected filter'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredWithdrawals.map((w) => {
              const cfg = WD_STATUS[w.status] ?? WD_STATUS.requested;
              return (
                <div
                  key={w.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {w.campaignHref ? (
                      <Link
                        href={w.campaignHref}
                        className="text-sm font-semibold text-foreground hover:text-primary"
                      >
                        {w.campaignTitle}
                      </Link>
                    ) : (
                      <p className="text-sm font-semibold text-foreground">{w.campaignTitle}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Requested {formatDate(w.requestedAt)}
                      {w.processedAt && ` · Processed ${formatDate(w.processedAt)}`}
                    </p>
                    {w.failureReason && <p className="text-xs text-destructive">{w.failureReason}</p>}
                    {w.notes && <p className="text-xs text-muted-foreground italic">{w.notes}</p>}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-lg font-bold text-foreground"><Money minor={w.amount} currency={w.currency} precision="exact" /></span>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}
                    >
                      {cfg.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
