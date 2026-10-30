'use client';

import { useRef } from 'react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import Image from 'next/image';
import { CATEGORY_LABELS } from '@/lib/categories';
import type { CampaignCategory } from '@/types';
import { Button } from '@/components/ui/button';
import { MediaGallery } from '@/components/campaign/MediaGallery';

interface PreviewData {
  title: string;
  story: string;
  heroImageUrl: string;
  galleryImages: string[];
  youtubeUrl: string | null;
  photoCredit: string;
  category: string;
  subjectName: string;
  subjectHometown: string;
  goalAmount: string;
  beneficiaryRelation: string;
  organizerName: string;
  organizerImage: string | null;
}

interface FundraiserPreviewModalProps {
  data: PreviewData;
  onClose: () => void;
  onConfirmLaunch: () => void;
  launching: boolean;
}

export function FundraiserPreviewModal({
  data,
  onClose,
  onConfirmLaunch,
  launching,
}: FundraiserPreviewModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /*
    ⛔ This effect used to live here, inline, and it was the ONLY correct modal
    keyboard implementation in the product - the wizard's two hand-rolled
    dialogs one file away had none of it (`docs/155`). Lifted into
    `useModalKeyboard` so there is one decider instead of one correct copy and
    two absent ones. `canClose: !launching` is why that option exists: Escape
    must not dismiss this dialog mid-submit.
  */
  useModalKeyboard({
    open: true,
    contentRef: contentRef,
    onClose,
    canClose: !launching,
  });

  const categoryLabel =
    CATEGORY_LABELS[data.category as CampaignCategory] ?? data.category;

  const goalDollars = parseInt(data.goalAmount || '0', 10);
  const formattedGoal = `$${goalDollars.toLocaleString()}`;

  const organizerInitial = (data.organizerName || 'U').charAt(0).toUpperCase();

  // Determine organizer relation label
  const relationLabel =
    data.beneficiaryRelation === 'self'
      ? 'Organizer'
      : data.beneficiaryRelation === 'family'
        ? 'Family member'
        : data.beneficiaryRelation === 'friend'
          ? 'Friend'
          : data.beneficiaryRelation === 'colleague'
            ? 'Colleague'
            : data.beneficiaryRelation === 'organization'
              ? 'Organization representative'
              : data.beneficiaryRelation === 'community_member'
                ? 'Community member'
                : 'Organizer';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current && !launching) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Fundraiser preview"
    >
      <div
        ref={contentRef}
        className="relative mx-auto mt-4 flex h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl sm:mt-8 sm:h-[calc(100dvh-4rem)]"
      >
        {/* Header bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">
            Fundraiser preview
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={launching}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Close preview"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-6">
            {/* Title */}
            <h1 className="font-display text-2xl font-bold leading-tight text-foreground sm:text-3xl">
              {data.title || 'Untitled Campaign'}
            </h1>

            {/* Two-column layout on larger screens */}
            <div className="mt-6 flex flex-col gap-6 lg:flex-row">
              {/* Left: Hero image + organizer + story */}
              <div className="flex-1 min-w-0">
                {/* Hero image */}
                {data.heroImageUrl && (
                  <MediaGallery
                    heroImageUrl={data.heroImageUrl}
                    galleryImages={data.galleryImages}
                    youtubeUrl={data.youtubeUrl}
                    title={data.title || 'Untitled Campaign'}
                    category={data.category}
                    photoCredit={data.photoCredit || null}
                  />
                )}

                {/* Organizer row */}
                <div className="mt-4 flex items-center gap-3">
                  {data.organizerImage ? (
                    <Image
                      src={data.organizerImage}
                      alt={data.organizerName}
                      width={32}
                      height={32}
                      className="rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                      {organizerInitial}
                    </div>
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {data.organizerName}
                  </span>
                </div>

                {/* Donation protected badge */}
                <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                  Donation protected
                </div>

                {/* Story */}
                <div className="mt-6">
                  <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
                    {data.story.split('\n').map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right sidebar: Donate + Share card (visible on lg+) */}
              <div className="hidden w-[280px] shrink-0 lg:block">
                <div className="sticky top-0 space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
                  {/* Goal progress preview */}
                  <div>
                    <p className="text-2xl font-bold text-foreground">
                      $0 <span className="text-sm font-normal text-muted-foreground">raised of {formattedGoal} goal</span>
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-0 rounded-full bg-teal-500" />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">0 donations</p>
                  </div>

                  <button
                    type="button"
                    disabled
                    className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground opacity-70"
                  >
                    Donate now
                  </button>
                  <button
                    type="button"
                    disabled
                    className="w-full rounded-full border border-foreground bg-foreground py-3 text-sm font-semibold text-background opacity-70"
                  >
                    Share
                  </button>

                  <div className="flex items-start gap-3 pt-2">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30">
                      <svg className="h-3 w-3 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Become the first supporter</p>
                      <p className="text-xs text-muted-foreground">Your donation matters</p>
                    </div>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Refunds and disputes
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Donors can request a refund by email, normally within 30
                      days of giving. Requests are reviewed case by case.{' '}
                      <a href="/refund-policy" className="text-primary underline">
                        Read the refund policy.
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Donate CTA banner (visible on mobile + always) */}
            <div className="mt-8 rounded-2xl bg-gradient-to-r from-teal-50 to-teal-100/50 p-6 dark:from-teal-950/30 dark:to-teal-900/20">
              <p className="text-lg font-bold text-foreground">
                Give ${Math.min(goalDollars, 20)} and be one of the first to donate
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your donation starts {data.subjectName || data.organizerName}&apos;s
                journey to success by inspiring others to help.
              </p>
              <button
                type="button"
                disabled
                className="mt-4 rounded-full bg-primary px-8 py-2.5 text-sm font-semibold text-primary-foreground opacity-70"
              >
                Donate
              </button>
            </div>

            {/* Sharing section */}
            <div className="mt-8">
              <h3 className="text-lg font-bold text-foreground">
                Sharing helps more than you think
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                On average, <strong>each share can inspire $50 in donations</strong> by
                helping this fundraiser reach more people.
              </p>

              {/* Social share icon row (preview only, not functional) */}
              <div className="mt-4 flex items-center gap-3">
                {/* Copy link */}
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-4.122a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L5.25 9" />
                  </svg>
                </div>
                {/* Facebook */}
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1877F2] text-white">
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" /></svg>
                </div>
                {/* WhatsApp */}
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366] text-white">
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                </div>
                {/* LinkedIn */}
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0A66C2] text-white">
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
                </div>
              </div>
            </div>

            {/* Organizer section */}
            <div className="mt-8 border-t border-border pt-8">
              <h3 className="text-lg font-bold text-foreground">Organizer</h3>
              <div className="mt-4 flex items-center gap-4">
                {data.organizerImage ? (
                  <Image
                    src={data.organizerImage}
                    alt={data.organizerName}
                    width={48}
                    height={48}
                    className="rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-lg font-bold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                    {organizerInitial}
                  </div>
                )}
                <div>
                  <p className="font-medium text-foreground">{data.organizerName}</p>
                  <p className="text-sm text-muted-foreground">{relationLabel}</p>
                  {data.subjectHometown && (
                    <p className="text-sm text-muted-foreground">{data.subjectHometown}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Category + meta footer */}
            <div className="mt-6 border-t border-border pt-6 text-sm text-muted-foreground">
              <span>Just created</span>
              <span className="mx-2">&middot;</span>
              <span>{categoryLabel}</span>
            </div>

            {/* Bottom spacer for the sticky footer */}
            <div className="h-24" />
          </div>
        </div>

        {/* Sticky footer with Launch button */}
        <div className="shrink-0 border-t border-border bg-background px-6 py-4">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
            <button
              type="button"
              onClick={onClose}
              disabled={launching}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              Back to editing
            </button>
            <Button
              onClick={onConfirmLaunch}
              disabled={launching}
              className="rounded-full px-8"
            >
              {/* Submitting, not launching: a submission goes to review,
                  not to the public site. See docs/78. */}
              {launching ? 'Submitting...' : 'Submit for review'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
