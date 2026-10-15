'use client';

import { useState } from 'react';
import { ShareIcon, CheckIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

interface SidebarShareButtonProps {
  url: string;
  title: string;
  className?: string;
}

/**
 * The sidebar's second primary action.
 *
 * Uses the native share sheet where the browser has one — on a phone that is
 * the whole contact list, one tap, with no social account required — and falls
 * back to copying the link. The capability is probed inside the handler rather
 * than at render, so the server and client markup stay identical.
 */
export function SidebarShareButton({ url, title, className }: SidebarShareButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // The user dismissing the share sheet is a normal outcome, not a
        // failure worth reporting. Anything else falls through to copying.
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
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
