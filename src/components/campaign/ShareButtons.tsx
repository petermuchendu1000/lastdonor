'use client';

import { useRef, useState } from 'react';
import { LinkIcon, EnvelopeIcon, CheckIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';
import { useAuthState } from '@/lib/auth-state';
import { mintAttributedUrl } from '@/lib/attributed-share';

interface ShareButtonsProps {
  url: string;
  title: string;
  /**
   * Present when an attributed link can be minted for this campaign. Absent
   * on the blog, which has no campaign to credit a share to.
   */
  campaignSlug?: string;
  className?: string;
}

/**
 * The share row under a campaign story, and on a blog post.
 *
 * ## Why WhatsApp is first
 *
 * It was missing entirely from this row while three other surfaces had it
 * (the post-donation panel, the congratulations screen and the wizard
 * preview). This is the only share control a visitor sees *before* donating,
 * and on a `completed`, `paused` or `cancelled` campaign it is the only one
 * on the page at all - `CampaignSidebarClient` renders only when the campaign
 * is donatable. The platform's one working payment rail is M-Pesa in Kenya
 * (`docs/92`), where WhatsApp is how a link actually travels, so the channel
 * that mattered most was the one channel absent from the surface that matters
 * most.
 *
 * ## ⚠️ The social buttons are deliberately NOT attributed, and that is a
 * ## recorded trade-off rather than an oversight
 *
 * Copy-link and the native sheet share `/s/<token>` for a signed-in person
 * (`docs/58`). The Facebook / X links do not, and closing that gap needs one
 * of two things, both of which this codebase has already refused:
 *
 *  1. **Mint before the click** - resolve the token at render so the `href` is
 *     already attributed. `docs/58` rejected exactly this: a mint is a write,
 *     so it would credit a share to every campaign a signed-in person merely
 *     scrolled past.
 *  2. **Open the intent from script after an await** - which needs
 *     `window.open('', '_blank')` held open across the mint, and that handle
 *     is `null` when `noopener` is passed. Keeping the handle means dropping
 *     `rel="noopener"` and handing facebook.com a `window.opener` onto the
 *     campaign page. Attribution is a growth metric; reverse-tabnabbing is a
 *     security property, and this is not a trade to make quietly.
 *
 * So the links stay plain and safe, and the attributed path is the one that
 * needs no popup. If this is ever revisited, read `docs/58` first.
 */
export function ShareButtons({ url, title, campaignSlug, className }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const { isAuthenticated } = useAuthState();
  /** Resolved attributed link, kept so a second copy costs no request. */
  const minted = useRef<string | null>(null);

  /*
    One sentence, carried by every channel that accepts text. Facebook's
    sharer takes only `u` and strips anything else, which is why the row
    previously had no copy at all - but X, WhatsApp and mail all do, and each
    was sending either nothing or a bare title.

    It asks, rather than announcing. A public post reaches everyone and asks
    no one.
  */
  const shareText = `${title} - please take a look, and share it if you can.`;

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const encodedText = encodeURIComponent(shareText);
  const encodedTextWithUrl = encodeURIComponent(`${shareText} ${url}`);

  /** This sharer's attributed link, or the plain URL if one cannot be had. */
  async function resolveShareUrl(): Promise<string> {
    if (minted.current) return minted.current;
    if (!isAuthenticated || !campaignSlug) return url;

    const attributed = await mintAttributedUrl(campaignSlug);
    if (!attributed) return url;
    minted.current = attributed;
    return attributed;
  }

  async function handleCopyLink() {
    const target = await resolveShareUrl();
    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      const { toast } = await import('sonner');
      toast.success('Link copied, paste it anywhere');
    } catch {
      const { toast } = await import('sonner');
      toast.error('Could not copy link');
    }
  }

  const iconLink =
    'inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="text-sm font-medium text-muted-foreground">Share:</span>

      {/* WhatsApp */}
      <a
        href={`https://wa.me/?text=${encodedTextWithUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on WhatsApp"
        className={iconLink}
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </a>

      {/* Facebook */}
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on Facebook"
        className={iconLink}
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
        </svg>
      </a>

      {/* X / Twitter */}
      <a
        href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
        className={iconLink}
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>

      {/* Email */}
      <a
        href={`mailto:?subject=${encodedTitle}&body=${encodedTextWithUrl}`}
        aria-label="Share via email"
        className={iconLink}
      >
        <EnvelopeIcon className="h-4 w-4" />
      </a>

      {/* Copy link - attributed for a signed-in sharer */}
      <button
        type="button"
        onClick={handleCopyLink}
        aria-label="Copy link to clipboard"
        className={iconLink}
      >
        {copied ? (
          <CheckIcon className="h-4 w-4" aria-hidden="true" />
        ) : (
          <LinkIcon className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
