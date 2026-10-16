/*
 * Server component. It was 'use client' only for framer-motion, which the
 * CSS reveals in globals.css replaced; nothing here uses a hook or a
 * handler, so none of it needs to ship to the browser.
 */
import Image from 'next/image';
import Link from 'next/link';
import { CheckBadgeIcon } from '@heroicons/react/24/solid';

export function HeroSection() {
  return (
    <section
      className="relative flex flex-col overflow-hidden bg-muted lg:block"
      aria-label="Welcome"
    >
      {/*
        Ambient wash. With no image on phones the hero was a flat grey slab,
        so this puts warmth and depth behind the headline. Two CSS radial
        gradients: no image request, no JavaScript, nothing to lay out, so it
        cannot move the LCP or CLS that docs/47 and docs/49 won. Hidden from
        assistive tech and from anyone who has asked for less motion is
        unnecessary - it does not animate.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 lg:hidden"
        style={{
          backgroundImage:
            'radial-gradient(65% 50% at 88% -5%, color-mix(in oklab, var(--color-brand-amber) 26%, transparent) 0%, transparent 72%), ' +
            'radial-gradient(75% 55% at -10% 105%, color-mix(in oklab, var(--color-brand-teal) 22%, transparent) 0%, transparent 68%)',
        }}
      />
      {/*
        Desktop-only hero image. There is deliberately NO hero image on
        phones: it cost 215px of an 844px viewport and a download, to carry
        nothing the headline does not already say. See docs/53.

        `sizes` does the real work. A CSS-hidden <img> is still in the DOM and
        browsers still fetch it - measured 2026-10-16, the phone pulled BOTH
        hero variants (w=384 and w=640, 18KB) for an image it never showed.
        Declaring 16px below lg makes the browser resolve the srcset to Next's
        smallest candidate on a phone instead of a full-width one. Done this
        way rather than with a JS media-query hook because the hook would
        delay the desktop LCP element until after hydration and risk a
        hydration mismatch; this stays server-rendered and `priority`
        preloads it.
      */}
      <div className="absolute inset-y-0 right-0 hidden w-[55%] lg:block">
        <Image
          src="/images/hero-hope.webp"
          alt="A grandmother and her granddaughter holding each other on a sunlit porch"
          fill
          priority
          sizes="(max-width: 1023px) 16px, 55vw"
          className="object-cover object-center"
        />
        {/*
          Fade the left edge into the text column, then get out of the way.
          A wash spread evenly across the full 55% desaturated the faces,
          which are the entire reason this image is here. The stops hold it
          to the left third.
        */}
        <div className="absolute inset-0 bg-gradient-to-r from-muted from-0% via-muted/45 via-22% to-transparent to-55%" />
      </div>

      {/* Text content - left column on desktop, full-width on mobile */}
      <div className="relative order-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="py-12 sm:py-16 lg:w-1/2 lg:py-28 xl:py-32">
          {/*
            "LastDonor" was the first line of this heading, 8px below a logo
            that already says it. Removing it drops the heading from 73
            characters to 63 and frees a line, which is what pays for the
            larger size: 40px on mobile and 64px on desktop, against 36/56
            before. GoFundMe sets 40/82 but carries only 34 characters.
          */}
          <h1 className="hero-h1 font-display text-[2.5rem] font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-[4rem] lg:leading-[1.05]">
            Reviewed crowdfunding with{' '}
            <span className="text-primary">0% platform fees</span>{' '}
            and visible impact.
          </h1>

          {/*
            Trimmed from 196 characters to one sentence. The second sentence
            (progress, fund releases, impact updates) is not removed from the
            site, only from the hero: it ran to six lines on a phone and
            pushed the CTAs past the fold.
          */}
          <p className="hero-summary hero-reveal hero-reveal-1 mt-6 max-w-lg text-xl leading-relaxed text-muted-foreground">
            Support real people through medical, emergency, and disaster
            relief campaigns, each one reviewed before it goes live.
          </p>

          {/* CTAs - primary (amber) + secondary (teal outlined) */}
          {/*
            Full-width stacked on phones, inline from sm up. A 260px pill
            floating in a 390px column reads as tentative, and a full-width
            primary is the standard mobile affordance with the largest
            possible tap target.
          */}
          <div className="hero-reveal hero-reveal-2 mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            {/*
              Both buttons carry `border-2` so they are the same height. The
              filled one had no border and measured 48px against the outlined
              one's 52px, so the pair sat on two different baselines.
              Type is 16px, not 14px: these are the page's primary actions and
              were the smallest text on any button in either product's hero.
            */}
            <Link
              href="/campaigns"
              className="btn-press inline-flex w-full items-center justify-center rounded-full border-2 border-transparent bg-brand-amber px-8 py-3.5 text-base font-bold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[--shadow-amber] sm:w-auto"
            >
              Browse Reviewed Campaigns
            </Link>
            <Link
              href="/share-your-story"
              className="btn-press inline-flex w-full items-center justify-center rounded-full border-2 border-primary px-8 py-3.5 text-base font-semibold text-primary transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/5 sm:w-auto"
            >
              Share Your Story
            </Link>
          </div>

          {/*
            Zero-Knowledge Proof strip: pre-empts the top objections at the
            point of CTA click.

            Was a 12px grey run-on separated by middots, which wrapped to two
            ragged lines on a 390px screen and read as fine print. Now three
            discrete chips: each claim is its own object, legible at 13px, and
            the wrap is deliberate rather than accidental.
          */}
          <ul className="hero-reveal hero-reveal-3 mt-6 flex flex-wrap gap-2">
            {[
              'No signup to donate',
              'Human-reviewed campaigns',
              '0% platform fees',
            ].map((claim) => (
              <li
                key={claim}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-[13px] font-medium text-foreground/80 shadow-sm backdrop-blur-sm"
              >
                <CheckBadgeIcon
                  className="h-4 w-4 shrink-0 text-brand-teal"
                  aria-hidden="true"
                />
                {claim}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
