'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CampaignHeroImage } from '@/components/campaign/CampaignHeroImage';
import { CATEGORY_LABELS } from '@/lib/categories';
import { Money } from '@/components/ui/Money';
import type { CampaignCategory } from '@/types';

interface CongratsProps {
  campaign: {
    title: string;
    slug: string;
    /**
     * Whether `/campaigns/<slug>` would actually serve this campaign.
     *
     * ⛔ `docs/109`: both links below pointed there unconditionally, and the
     * public page serves only some statuses - so for a campaign still in the
     * review queue this screen offered an organiser two buttons to a 404.
     * Computed on the server by `hasPublicPage`, which is asserted equal to
     * that page's own filter.
     */
    hasPublicPage: boolean;
    heroImageUrl: string | null;
    category: string;
    subjectName: string;
    subjectHometown: string | null;
    goalAmount: number;
    /** The campaign's own currency - never assumed to be USD (`docs/92`). */
    currency: string;
    raisedAmount: number;
    donorCount: number;
    campaignOrganizer: { name: string; relation: string; city?: string } | null;
  };
  campaignUrl: string;
  creatorName: string;
}

// ── Social share helpers ─────────────────────────────────────────────────────

function shareUrl(platform: string, url: string, title: string) {
  const e = encodeURIComponent;
  switch (platform) {
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`;
    case 'whatsapp':
      return `https://wa.me/?text=${e(`${title} ${url}`)}`;
    case 'x':
      return `https://twitter.com/intent/tweet?url=${e(url)}&text=${e(title)}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`;
    case 'email':
      return `mailto:?subject=${e(title)}&body=${e(`Check out this fundraiser: ${url}`)}`;
    default:
      return '#';
  }
}

const SOCIAL_PLATFORMS = [
  {
    id: 'facebook',
    label: 'Facebook',
    color: 'bg-[#1877F2]',
    icon: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
      </svg>
    ),
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    color: 'bg-[#25D366]',
    icon: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    ),
  },
  {
    id: 'email',
    label: 'Email',
    color: 'bg-gray-600',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    color: 'bg-[#0A66C2]',
    icon: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    id: 'x',
    label: 'X',
    color: 'bg-black dark:bg-white dark:text-black',
    icon: (
      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

export function CongratulationsClient({ campaign, campaignUrl, creatorName }: CongratsProps) {
  const [phase, setPhase] = useState<'transition' | 'share'>('transition');
  const [copied, setCopied] = useState(false);

  function handleCopyLink() {
    navigator.clipboard.writeText(campaignUrl).then(
      () => {
        setCopied(true);
        import('sonner').then(({ toast }) => toast.success('Link copied!'));
        setTimeout(() => setCopied(false), 3000);
      },
      () => {
        import('sonner').then(({ toast }) => toast.error('Could not copy link'));
      },
    );
  }

  const categoryLabel = CATEGORY_LABELS[campaign.category as CampaignCategory] ?? campaign.category;
  const organizerName = campaign.campaignOrganizer?.name ?? creatorName;

  // ── Phase 1: Transition screen ─────────────────────────────────────────
  if (phase === 'transition') {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#0a3d2f] px-4 text-white dark:bg-[#0a3d2f]">
        {/* Share icon */}
        <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-full border border-white/20">
          <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
          </svg>
        </div>

        <h1 className="font-display text-center text-3xl font-bold leading-tight sm:text-4xl">
          Your fundraiser is<br />ready to share.
        </h1>

        <div className="mt-10 flex w-full max-w-sm flex-col gap-3">
          <button
            type="button"
            onClick={() => setPhase('share')}
            className="w-full rounded-full bg-[#c7f566] py-4 text-base font-semibold text-[#0a3d2f] transition-colors hover:bg-[#b8e655]"
          >
            Share fundraiser
          </button>
          <Link
            href="/dashboard"
            className="w-full rounded-full border border-white/30 py-4 text-center text-base font-semibold text-white transition-colors hover:bg-white/10"
          >
            Skip
          </Link>
        </div>
      </div>
    );
  }

  // ── Phase 2: Share + campaign overview ─────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Top bar */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <h1 className="text-lg font-semibold text-foreground">Your Campaign Is Live!</h1>
          {campaign.hasPublicPage && (
            <Link
              href={`/campaigns/${campaign.slug}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              View campaign
            </Link>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* Campaign card + share section side by side on desktop */}
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Left: Campaign preview card */}
          <div className="flex-1">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              {campaign.heroImageUrl && (
                <CampaignHeroImage
                  src={campaign.heroImageUrl}
                  alt={campaign.title}
                  className="aspect-[16/9] w-full object-cover"
                />
              )}
              <div className="p-6">
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-teal-600 dark:text-teal-400">
                  {categoryLabel}
                </p>
                <h2 className="font-display text-xl font-bold text-foreground">
                  {campaign.title}
                </h2>
                {campaign.subjectHometown && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {campaign.subjectHometown}
                  </p>
                )}

                {/* Goal display */}
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">
                    <Money minor={campaign.goalAmount} currency={campaign.currency} precision="exact" />
                  </span>
                  <span className="text-sm text-muted-foreground">goal</span>
                </div>

                {/* Organizer */}
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                    {organizerName.charAt(0).toUpperCase()}
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {organizerName} is organizing this fundraiser
                  </p>
                </div>
              </div>
            </div>

            {/* Quick tip */}
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <span className="mt-0.5 text-lg">💡</span>
              <div className="text-sm text-muted-foreground">
                <strong className="text-foreground">Quick tip:</strong> Having donations
                will encourage others to donate. Share your fundraiser with 1-3 close
                contacts who can make the first donations.
              </div>
            </div>

            {/* Be the first to donate CTA */}
            <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-6 text-center dark:border-teal-800 dark:bg-teal-950/30">
              <h3 className="font-display text-lg font-bold text-foreground">
                Be the first to donate
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Your donation signals trust and encourages others to give
              </p>
              <Link
                href={`/donate?campaign=${campaign.slug}`}
                className="mt-4 inline-flex items-center justify-center rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Donate Now
              </Link>
            </div>
          </div>

          {/* Right: Share panel */}
          <div className="w-full lg:w-[380px]">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h3 className="text-xl font-bold text-foreground">
                Reach more donors by sharing
              </h3>
              {/*
                ⛔ The second sentence here used to read "On average, each
                share can inspire $50 in donations." That is a FABRICATED
                STATISTIC, not a currency bug: this platform has taken two
                donations in its entire history (KES 50 each, `docs/92`), so
                there is no average to quote, and it was quoted in dollars on
                a shilling campaign. CLAUDE.md: *never add a claim the
                platform cannot substantiate* - the same rule under which
                `docs/67` removed five invented figures from outgoing mail and
                `docs/94` another five. Do not replace it with a different
                number; replace it with a reason, which is all we can honestly
                offer.
              */}
              <p className="mt-2 text-sm text-muted-foreground">
                Share it as early as you can. Most people give because someone
                they know asked them to.
              </p>

              {/* Copy link */}
              <div className="mt-5">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Your unique link
                </label>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                >
                  <span className="truncate text-sm text-muted-foreground">{campaignUrl}</span>
                  <span className="ml-3 inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                    {copied ? 'Copied!' : 'Copy link'}
                  </span>
                </button>
              </div>

              {/* Social platforms grid */}
              <div className="mt-6 grid grid-cols-2 gap-3">
                {SOCIAL_PLATFORMS.map((platform) => (
                  <a
                    key={platform.id}
                    href={shareUrl(platform.id, campaignUrl, campaign.title)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/50"
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-white ${platform.color}`}>
                      {platform.icon}
                    </span>
                    {platform.label}
                  </a>
                ))}
              </div>

              {/* Sharing tips */}
              <div className="mt-6 space-y-3 border-t border-border pt-5">
                <p className="text-sm font-semibold text-foreground">Sharing tips:</p>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 font-semibold text-teal-600">1.</span>
                    <span><strong>Text or WhatsApp 5 close contacts</strong> - personal messages convert 10x better</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 font-semibold text-teal-600">2.</span>
                    <span><strong>Post on social media</strong> - add a personal note about why this matters</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 font-semibold text-teal-600">3.</span>
                    <span><strong>Email your network</strong> - sometimes the simplest approach works best</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation links */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {campaign.hasPublicPage && (
            <Link
              href={`/campaigns/${campaign.slug}`}
              className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              View Your Campaign
            </Link>
          )}
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-full border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-accent"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
