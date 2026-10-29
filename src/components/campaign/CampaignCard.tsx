'use client';

import Link from 'next/link';
import { ProgressBar } from '@/components/campaign/ProgressBar';
import { CampaignHeroImage } from '@/components/campaign/CampaignHeroImage';
import { Money } from '@/components/ui/Money';
import { LocalAmount } from '@/components/money/LocalAmount';
import type { FxSnapshot } from '@/lib/money/fx-providers';


interface CampaignCardProps {
  slug: string;
  title: string;
  heroImageUrl: string;
  subjectName: string;
  category?: string;
  location?: string | null;
  raisedAmount: number;
  /**
   * The campaign's own currency.
   *
   * ⛔ Required, never defaulted. `<Money>` defaults to USD, so a call site
   * that looks right renders a dollar sign on a shilling campaign (`docs/92`:
   * every amount is in the minor units of its row's currency).
   */
  currency: string;
  goalAmount: number;
  donorCount?: number;
  /**
   * Today's exchange rates, for showing the goal in the READER's currency.
   *
   * ⛔ DISPLAY ONLY, and optional on purpose. Omit it and the card renders no
   * approximate figure at all - never a wrong one - which is also what
   * happens when the snapshot is missing (before the first `refresh-fx-rates`
   * run, or in a build with no `DATABASE_URL`, `docs/119`) or older than
   * `MAX_FX_AGE_HOURS` (`docs/102` makes staleness a REFUSAL).
   *
   * ⚠️ It is a PROP rather than a server-rendered node because `CampaignGrid`
   * appends cards in the BROWSER after a "Load more" fetch (`docs/145`), and
   * nothing built on the server can reach those. A node slot would have
   * converted page 1 and silently not page 2.
   */
  fxSnapshot?: FxSnapshot | null;
}

export function CampaignCard({
  slug,
  title,
  heroImageUrl,
  subjectName,
  category,
  location,
  raisedAmount,
  currency,
  goalAmount,
  donorCount,
  fxSnapshot,
}: CampaignCardProps) {
  /*
   * Hide "for <name>" when the title already names the subject. Matching on
   * the full name alone missed "Sgt. Vega Comes Home..." for a subject
   * recorded as "Sgt. Ramon Vega", so the surname is checked too - that is
   * the token a reader actually recognises as the same person.
   */
  const lowerTitle = title.toLowerCase();
  const surname = subjectName.trim().split(/\s+/).pop()?.toLowerCase() ?? '';
  const titleNamesSubject =
    lowerTitle.includes(subjectName.toLowerCase()) ||
    (surname.length > 2 && lowerTitle.includes(surname));

  return (
    <article
      className="animate-fade-in-up group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card card-hover-lift"
    >
      {/*
        Horizontal below `sm`, vertical from `sm` up.

        Measured 2026-10-16: our vertical card was ~400px tall on a phone, so
        the homepage spent ~2,400px to surface six campaigns. GoFundMe's
        mobile "Discover" row uses a 358x128 horizontal card - square
        thumbnail left, text right - and surfaces TEN campaigns in 869px.
        That is 87 vertical pixels per campaign against our ~400.

        Done as a direction change on ONE element rather than two cards
        toggled by CSS. A hidden card is still in the DOM and its image is
        still fetched; that mistake cost 18KB per phone load in the hero
        (docs/53) and would cost far more across a grid. See docs/55.
      */}
      <Link href={`/campaigns/${slug}`} className="flex flex-1 flex-row sm:flex-col">
        {/* Hero image - clean, no overlays */}
        <div className="relative aspect-square w-28 shrink-0 overflow-hidden sm:aspect-[16/10] sm:w-full">
          <CampaignHeroImage
            src={heroImageUrl}
            alt={title}
            category={category}
            fill
            /* 112px on a phone, not 100vw: the thumbnail is 112px wide, so
               asking for a full-width variant downloads several times the
               pixels it can show. */
            sizes="(max-width: 639px) 112px, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col p-3.5 sm:p-5">
          {/*
            Row 1: Category + Location.
            The category chip is hidden on the compact card. In ~218px of
            text column it pushes the location onto its own line, and the
            thumbnail beside it already carries the category's visual cue.
            GoFundMe's compact card shows proximity only, no category.
          */}
          <div className="flex items-center gap-2">
            {category && (
              <span className="hidden rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground sm:inline">
                {category}
              </span>
            )}
            {location && (
              <span className="truncate text-[11px] text-muted-foreground">
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
              /* Stacked on the compact card: side by side these two need
                 ~235px and the text column is ~218px, so they wrapped
                 raggedly. Side by side again from `sm`, where there is room. */
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                {/*
                  Hierarchy swapped 2026-10-16 (amends docs/47, closes the
                  case docs/62 recorded but did not take).

                  docs/47 made "Be the first to donate" the prominent line,
                  evaluating ONE card. In a grid the aggregate reads
                  differently: the homepage showed it six times, and
                  /campaigns shows it TWELVE times down a single column,
                  where it stops being an invitation and becomes "nobody has
                  donated to anything here".

                  The goal leads now, because a column of goals reads as
                  twelve campaigns with targets rather than twelve campaigns
                  with no donors. Nothing is hidden: the prompt is still
                  there, one step down. The campaign page sidebar, where
                  there is exactly one instance and intent is high, keeps
                  docs/47's order.
                */}
                <span className="font-sans text-sm font-semibold tabular-nums text-foreground">
                  <Money minor={goalAmount} currency={currency} /> goal
                </span>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  Be the first to donate
                </span>
              </div>
            ) : (
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-bold text-foreground number-highlight">
                  <Money minor={raisedAmount} currency={currency} />{' '}
                  <span className="text-sm font-medium text-muted-foreground">raised</span>
                </span>
                <span className="font-sans text-xs font-medium tabular-nums text-muted-foreground">
                  of <Money minor={goalAmount} currency={currency} />
                </span>
              </div>
            )}

            {/*
              The goal in the READER's own currency, once per card and after
              the branch above so it appears in both the funded and unfunded
              shapes.

              The GOAL and not the raised figure, deliberately. It is the
              number that tells a reader how big the appeal is, and
              [VERIFIED from production 2026-10-29] every live campaign has
              `raised_amount = 0`, so converting both would double the
              approximate figures on a twelve-card grid to say the same
              nothing twice.

              ⚠️ `fallbackCurrency` matches `campaigns/[slug]/page.tsx`: a
              non-USD appeal falls back to USD, which a diaspora reader can
              interpret, and a USD appeal falls back to NOTHING rather than
              converting USD into USD. The browser's own detection
              (`docs/103`) replaces either once it resolves, which is how a
              Kenyan reading a dollar appeal gets shillings.

              Display only - never stored, never summed, never decides
              anything. See the boundary note in `src/lib/money/fx-convert.ts`.
            */}
            <LocalAmount
              minor={goalAmount}
              fromCurrency={currency}
              fallbackCurrency={currency === 'USD' ? null : 'USD'}
              snapshot={fxSnapshot ?? null}
              label="Goal is"
              className="mt-1 block font-sans text-xs text-muted-foreground"
            />

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
