'use client';

import { useRef, useState } from 'react';
import { ShareIcon, CheckIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';
import { useAuthState } from '@/lib/auth-state';
import { mintAttributedUrl } from '@/lib/attributed-share';

interface SidebarShareButtonProps {
  /** The plain campaign URL. Always the fallback, never a dead end. */
  url: string;
  title: string;
  /** Present when an attributed link can be minted for this campaign. */
  campaignSlug?: string;
  className?: string;
}

/**
 * The sidebar's second primary action.
 *
 * Uses the native share sheet where the browser has one - on a phone that is
 * the whole contact list, one tap, with no social account required - and falls
 * back to copying the link. The capability is probed inside the handler rather
 * than at render, so the server and client markup stay identical.
 *
 * ## Attribution (2026-10-16)
 *
 * For a signed-in sharer this shares `/s/<token>`, not the plain campaign URL,
 * so the donations it produces show up on `/dashboard/impact`. GoFundMe's
 * help-centre article 24972788571803 (VERIFIED, edited 2026-10-07) states a
 * signed-in user gets a unique link from **any** share option; ours previously
 * minted one only on the post-donation screen, so the main share surface - this
 * button - was handing out an uncountable URL and the impact dashboard had
 * nothing to report. See `docs/58`.
 *
 * Three things here are deliberate:
 *
 *  - **Minted on click, not on mount.** A mint is a write. Doing it at render
 *    would create a link for every campaign a signed-in person merely looked
 *    at, and "Campaigns shared: 47" would then count 47 pages they scrolled
 *    past. The dashboard would be reporting something untrue.
 *  - **Bounded, and never blocking.** `MINT_TIMEOUT_MS` caps the wait, and any
 *    failure shares the plain URL instead. Attribution is an enhancement; the
 *    share itself is the feature.
 *  - **`unknown` auth shares the plain URL.** Per `docs/44` a failed or
 *    rate-limited session read must not be treated as signed out; here it
 *    simply means no attribution, which is the harmless reading.
 */
export function SidebarShareButton({
  url,
  title,
  campaignSlug,
  className,
}: SidebarShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const { isAuthenticated } = useAuthState();
  /** Resolved attributed link, kept so a second share costs no request. */
  const minted = useRef<string | null>(null);

  /** This sharer's attributed link, or the plain URL if one cannot be had. */
  async function resolveShareUrl(): Promise<string> {
    if (minted.current) return minted.current;
    if (!isAuthenticated || !campaignSlug) return url;

    const attributed = await mintAttributedUrl(campaignSlug);
    if (!attributed) return url;
    minted.current = attributed;
    return attributed;
  }

  async function handleShare() {
    const target = await resolveShareUrl();

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url: target });
        return;
      } catch (err) {
        // The user dismissing the share sheet is a normal outcome, not a
        // failure worth reporting. Anything else falls through to copying -
        // including a NotAllowedError from a browser that considers the
        // activation spent by the await above.
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      const { toast } = await import('sonner');
      toast.success('Link copied, paste it anywhere');
    } catch {
      const { toast } = await import('sonner');
      toast.error('Could not copy the link');
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={cn(
        /*
          Deliberately neutral, not brand-coloured. Donate is the filled
          accent; giving Share a second saturated hue makes two stacked
          buttons compete instead of ranking.
        */
        'btn-press flex w-full items-center justify-center gap-2 rounded-full border border-border bg-transparent py-3.5 text-base font-bold text-foreground transition-colors hover:bg-muted',
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="h-5 w-5" aria-hidden="true" />
      ) : (
        <ShareIcon className="h-5 w-5" aria-hidden="true" />
      )}
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}
