'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import { Money } from '@/components/ui/Money';

interface ImpactLinkRowProps {
  campaignTitle: string;
  /*
    Resolved on the server by `share-impact.ts` from `status` +
    `published_at` (`docs/131`). The title below was an unconditional link to
    `/campaigns/<slug>`, and a share link outlives its campaign's public page
    (`docs/118` §2.5), so a sharer could be handed a 404 on the screen that
    exists to thank them. `docs/154`.
  */
  campaignHref: string | null;
  url: string;
  clicks: number;
  donorsBrought: number;
  /**
   * The campaign's currency.
   *
   * ⛔ Required, not defaulted: all three `<Money>` calls below were bare, so
   * a shilling campaign's figures rendered as dollars (`docs/92`). The
   * campaign is single-currency by composite FK, so one code covers both the
   * brought and the given figure on this row.
   */
  currency: string;
  amountBroughtMinor: number;
  /** What this person gave to this campaign themselves. 0 if they did not. */
  ownGivingMinor: number;
}

/**
 * One campaign's share link, with what it has brought in.
 *
 * GoFundMe's impact dashboard lets a sharer "generate more unique share
 * links" from the page. Ours shows the one link they already have for each
 * campaign and makes it copyable, because `mintShareLink` is idempotent per
 * (campaign, signed-in user): one link per campaign keeps a person's own
 * total in one place instead of splitting it across links they cannot tell
 * apart. See docs/58.
 */
export function ImpactLinkRow({
  campaignTitle,
  campaignHref,
  url,
  clicks,
  donorsBrought,
  currency,
  amountBroughtMinor,
  ownGivingMinor,
}: ImpactLinkRowProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const { toast } = await import('sonner');
      toast.error('Could not copy the link');
    }
  }

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {campaignHref ? (
          <Link
            href={campaignHref}
            className="min-w-0 flex-1 font-display text-base font-semibold text-card-foreground hover:text-primary"
          >
            {campaignTitle}
          </Link>
        ) : (
          <p className="min-w-0 flex-1 font-display text-base font-semibold text-card-foreground">
            {campaignTitle}
          </p>
        )}

        <div className="flex shrink-0 items-center gap-4 text-right">
          <div>
            <p className="font-sans text-lg font-bold tabular-nums text-foreground">
              <Money minor={amountBroughtMinor} currency={currency} />
            </p>
            <p className="text-[11px] text-muted-foreground">raised through you</p>
          </div>
          <div>
            <p className="font-sans text-lg font-bold tabular-nums text-foreground">
              {donorsBrought.toLocaleString('en-US')}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {donorsBrought === 1 ? 'donor' : 'donors'}
            </p>
          </div>
          <div>
            <p className="font-sans text-lg font-bold tabular-nums text-muted-foreground">
              {clicks.toLocaleString('en-US')}
            </p>
            <p className="text-[11px] text-muted-foreground">visits</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy your share link for ${campaignTitle}`}
          className="btn-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {copied ? (
            <CheckIcon className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ClipboardIcon className="h-4 w-4" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/*
        Honest reading of the two numbers, shown only when they disagree in
        the way that is actionable: visits arrived but nobody gave. Without
        this a sharer sees "12 visits, 0 donors" and has no idea whether
        that is normal.
      */}
      {/*
        Gave AND brought, in one sentence, because that is the sharer's whole
        contribution and either number alone understates it. GoFundMe pairs
        them for the same reason: "Not only will you be able to see the amount
        you donated, but you'll also be able to see how many other donations
        you brought." Shown only when they gave - for the many sharers who
        have not, a "$0 given" line is a reproach, not information.
      */}
      {ownGivingMinor > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          You gave <Money minor={ownGivingMinor} currency={currency} className="font-semibold text-foreground" />
          {amountBroughtMinor > 0 ? (
            <>
              {' and brought in '}
              <Money minor={amountBroughtMinor} currency={currency} className="font-semibold text-foreground" />
              {' more.'}
            </>
          ) : (
            '.'
          )}
        </p>
      )}

      {clicks > 0 && donorsBrought === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          People are opening this link but not donating yet.
        </p>
      )}
      {clicks === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          No one has opened this link yet.
        </p>
      )}
    </li>
  );
}
