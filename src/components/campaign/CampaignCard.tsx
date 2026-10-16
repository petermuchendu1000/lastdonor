'use client';

import Link from 'next/link';
import { ProgressBar } from '@/components/campaign/ProgressBar';
import { CampaignHeroImage } from '@/components/campaign/CampaignHeroImage';
import { Money } from '@/components/ui/Money';
import { centsToDollarsWhole } from '@/lib/utils/currency';

interface CampaignCardProps {
  slug: string;
  title: string;
  heroImageUrl: string;
  subjectName: string;
  category?: string;
  location?: string | null;
  raisedAmount: number;
  goalAmount: number;
  donorCount?: number;
}

export function CampaignCard({
  slug,
  title,
  heroImageUrl,
  subjectName,
  category,
  location,
  raisedAmount,
  goalAmount,
  donorCount,
}: CampaignCardProps) {
  const titleNamesSubject = title.toLowerCase().includes(subjectName.toLowerCase());

  return (
    <article
      className="animate-fade-in-up group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card card-hover-lift"
    >
      <Link href={`/campaigns/${slug}`} className="flex flex-1 flex-col">
        {/* Hero image - clean, no overlays */}
        <div className="relative aspect-[16/10] overflow-hidden">
          <CampaignHeroImage
            src={heroImageUrl}
            alt={title}
            category={category}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col p-5">
          {/* Row 1: Category + Location */}
          <div className="flex items-center gap-2">
            {category && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">
                {category}
              </span>
            )}
            {location && (
              <span className="text-[11px] text-muted-foreground">
                {location}
              </span>
            )}
          </div>

          {/* Row 2: Title */}
          <h3 className="mt-2 line-clamp-2 font-display text-base font-semibold leading-snug text-card-foreground transition-colors duration-200 group-hover:text-primary">
            {title}
          </h3>
          {/*
            "for <name>" only when the title does not already carry the name.
            Measured against production 2026-10-16: 11 of 12 live campaigns
            had the subject's full name in the title, so this line was a
            duplicate on nearly every card. See docs/51.
          */}
          {!titleNamesSubject && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              for {subjectName}
            </p>
          )}

          {/* Row 3: Financial data */}
          <div className="mt-auto pt-4">
            {raisedAmount === 0 ? (
              /*
                An unfunded campaign leads with what it is asking for, not with
                a "$0 raised" that reads as a dead page across a whole grid.
                The goal is still shown in full — see docs/47.
              */
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Be the first to donate
                </span>
                <span className="shrink-0 font-sans text-xs font-medium tabular-nums text-muted-foreground">
                  {centsToDollarsWhole(goalAmount)} goal
                </span>
              </div>
            ) : (
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-bold text-foreground number-highlight">
                  <Money cents={raisedAmount} />{' '}
                  <span className="text-sm font-medium text-muted-foreground">raised</span>
                </span>
                <span className="font-sans text-xs font-medium tabular-nums text-muted-foreground">
                  of {centsToDollarsWhole(goalAmount)}
                </span>
              </div>
            )}

            {/*
              The bar is drawn only once there is progress to draw.
              At zero it is an empty track that says nothing the goal line
              above it has not already said, and across a grid where every
              campaign is unfunded it repeats that emptiness twelve times.
              GoFundMe's discover cards carry no progress bar at all, and no
              goal either - only "$38,515 raised" - which is the same move
              made permanently. We keep the bar where it is positive and drop
              it where it is not. See docs/51.
            */}
            {raisedAmount > 0 && (
              <ProgressBar
                raisedAmount={raisedAmount}
                goalAmount={goalAmount}
                className="mt-2"
              />
            )}

            {/* Row 4: Social proof */}
            {donorCount !== undefined && donorCount > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {donorCount.toLocaleString('en-US')} donor{donorCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      </Link>
    </article>
  );
}
