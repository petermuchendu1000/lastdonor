/**
 * Trust badges for campaigns - shows verification status and payout indicators.
 *
 * Designed per spec Section 5.4:
 * - 🔵 "ID Verified" - identity_verified
 * - 🟢 "Fully Verified" - fully_verified
 * - Payout status - "100% Released" (lump-sum model)
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { hasCheckedOrganiserId } from '@/lib/campaign-raise-cap';
import { getCurrency, isSupportedCurrency } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';

// ─── Verification Badge ──────────────────────────────────────────────────────

type VerificationBadgeProps = {
  status: string;
  className?: string;
  compact?: boolean;
};

const VERIFICATION_CONFIG: Record<string, { label: string; icon: string; className: string }> = {
  fully_verified: {
    label: 'Fully Verified',
    icon: '✅',
    className: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800',
  },
  identity_verified: {
    label: 'ID Verified',
    icon: '🔵',
    className: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800',
  },
  verified: {
    label: 'Verified',
    icon: '✅',
    className: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800',
  },
};

export function VerificationBadge({ status, className, compact }: VerificationBadgeProps) {
  const config = VERIFICATION_CONFIG[status];
  if (!config) return null;

  return (
    <Badge
      variant="outline"
      className={cn('font-medium', config.className, className)}
    >
      {config.icon} {compact ? '' : config.label}
    </Badge>
  );
}

// ─── Pending Verification ────────────────────────────────────────────────────

type PendingVerificationBadgeProps = {
  /** `campaigns.verification_status`. */
  verificationStatus: string;
  /** `campaigns.currency` - the cap is a per-currency figure. */
  currency: string;
  /**
   * Can this campaign still take money at all?
   *
   * ⛔ REQUIRED, not optional, so the compiler names the call site. This badge
   * states a FUTURE allowance - "can raise up to X until we check the ID" -
   * and on a campaign that cannot take a penny that is a claim the platform
   * cannot substantiate, printed directly above "It can no longer take
   * donations". [VERIFIED 2026-10-27 in a browser] it rendered on a `closed`
   * campaign and on a `completed` one. `docs/119` §9.
   *
   * ⚠️ The class PREDATES serving `archived` (`docs/118` §9): `isDonatable` is
   * `active || last_donor_zone`, so `completed`, `paused`, `suspended` and
   * `cancelled` have all been served and non-donatable for months. Serving
   * `archived` added one more instance and is what made somebody look.
   */
  isDonatable: boolean;
  className?: string;
};

/**
 * The donor-facing counterpart of the pre-verification cap.
 *
 * Deliberately NOT an extra entry in `VERIFICATION_CONFIG` above. That map
 * feeds `VerificationBadge`, whose only two callers are admin screens
 * (`src/components/admin/CampaignsList.tsx`,
 * `src/components/admin/CampaignDetail.tsx`). Adding an `unverified` entry
 * there would have put a new badge on every row of two admin tables as a side
 * effect of a donor-facing change.
 *
 * It is also a different statement. `VerificationBadge` reports a status;
 * this reports a CONSEQUENCE - that there is a ceiling on what this campaign
 * can raise until a person has checked the organiser's ID - which is the part
 * a donor needs before deciding.
 *
 * Renders nothing once the campaign is past the cap gate, so it disappears
 * on its own when verification lands - and nothing when the campaign can no
 * longer take money, because the cap is then a statement about a future that
 * cannot happen.
 */
export function PendingVerificationBadge({
  verificationStatus,
  currency,
  isDonatable,
  className,
}: PendingVerificationBadgeProps) {
  // A ceiling on future giving means nothing where there is no future giving.
  if (!isDonatable) return null;
  /*
    ⛔ `hasCheckedOrganiserId`, NOT `isCapExempt`.

    This badge's first sentence is a claim about whether a person has seen the
    organiser's ID; the cap exemption is a decision about how much a campaign
    may raise. They share an answer today and they are not the same question -
    keying this on the cap meant a money decision silently deleted a donor
    disclosure (`docs/121` §10).
  */
  if (hasCheckedOrganiserId(verificationStatus)) return null;

  // `getCurrency` throws on an unknown code rather than defaulting to USD
  // (docs/92), which is right for money arithmetic and wrong for a badge:
  // a server component that throws takes the whole campaign page down.
  if (!isSupportedCurrency(currency)) return null;

  const def = getCurrency(currency);
  if (!Number.isFinite(def.unverifiedCapMinor)) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
        className,
      )}
    >
      <span className="font-semibold">&#9203; Pending verification</span>
      <span>
        We have not checked this organiser&apos;s ID yet. This campaign can raise up to{' '}
        {formatMoney(def.unverifiedCapMinor, def.code, 'exact')} until we do, and no money can
        be paid out to them before then.
      </span>
    </div>
  );
}

// ─── Vouched by an organisation ──────────────────────────────────────────────

type VouchedByBadgeProps = {
  /** Live vouches only. Empty renders nothing. */
  institutions: { institutionName: string; institutionCountry: string }[];
  className?: string;
};

/**
 * What replaces the pending-verification banner when an organisation vouched.
 *
 * ── THE COPY IS THE WHOLE COMPONENT ─────────────────────────────────────────
 *
 * Before a vouch, a donor is told plainly that nobody has checked the
 * organiser's ID and that there is a ceiling on what the campaign can raise.
 * A vouch removes both, so something has to take its place or the donor is
 * left to assume the usual check happened. It did not.
 *
 * ⛔ So this says who confirmed it and does NOT say "verified". It must never
 * read as though LastDonor saw a document, because nobody did - that is the
 * entire trade `docs/108` makes, and `TrustBadge.vouched.test.tsx` pins the
 * wording against exactly that drift.
 *
 * Deliberately NOT an entry in `VERIFICATION_CONFIG` above: that map feeds
 * `VerificationBadge`, whose only callers are two admin screens, and adding
 * to it would put a new badge on every row of two admin tables as a side
 * effect of a donor-facing change. Same reasoning as
 * `PendingVerificationBadge` (docs/101).
 */
export function VouchedByBadge({ institutions, className }: VouchedByBadgeProps) {
  if (institutions.length === 0) return null;

  const names = institutions.map((i) => i.institutionName);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100',
        className,
      )}
    >
      <span className="font-semibold">Confirmed by {list}</span>
      <span>
        {names.length === 1 ? 'They told us' : 'They told us'} this need is real.
        We have not seen the organiser&apos;s ID ourselves.
      </span>
    </div>
  );
}

// ─── Payout Indicator ────────────────────────────────────────────────────────

type FundReleaseIndicatorProps = {
  totalReleased: number;
  raisedAmount: number;
  className?: string;
};

export function FundReleaseIndicator({ totalReleased, raisedAmount, className }: FundReleaseIndicatorProps) {
  if (totalReleased <= 0 || raisedAmount <= 0) return null;

  const percent = Math.min(Math.round((totalReleased / raisedAmount) * 100), 100);

  return (
    <Badge
      variant="outline"
      className={cn(
        'font-medium bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:border-teal-800',
        className,
      )}
    >
      💰 {percent}% Released
    </Badge>
  );
}

// ─── Combined Trust Badge Row ────────────────────────────────────────────────

type TrustBadgeRowProps = {
  verificationStatus: string;
  totalReleased?: number;
  raisedAmount?: number;
  className?: string;
  compact?: boolean;
};

export function TrustBadgeRow({
  verificationStatus,
  totalReleased,
  raisedAmount,
  className,
  compact,
}: TrustBadgeRowProps) {
  const hasVerification = ['verified', 'identity_verified', 'fully_verified'].includes(verificationStatus);
  const hasFundRelease = totalReleased && totalReleased > 0 && raisedAmount && raisedAmount > 0;

  if (!hasVerification && !hasFundRelease) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {hasVerification && (
        <VerificationBadge status={verificationStatus} compact={compact} />
      )}
      {hasFundRelease && (
        <FundReleaseIndicator
          totalReleased={totalReleased}
          raisedAmount={raisedAmount}
        />
      )}
    </div>
  );
}
