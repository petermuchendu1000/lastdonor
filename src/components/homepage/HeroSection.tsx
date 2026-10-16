'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'motion/react';
import { CheckBadgeIcon } from '@heroicons/react/24/solid';
import { fadeInUp, staggerContainer } from '@/lib/animations';

export function HeroSection() {
  return (
    <section
      className="relative flex flex-col overflow-hidden bg-muted lg:block"
      aria-label="Welcome"
    >
      {/* Desktop hero image - right portion, fades into background */}
      <div
        className="absolute inset-y-0 right-0 hidden w-[55%] lg:block"
      >
        <Image
          src="/images/hero-bg.webp"
          alt="LastDonor.org reviewed crowdfunding platform showing donation support and campaign progress"
          fill
          priority
          sizes="55vw"
          className="object-cover object-center"
        />
        {/* Gradient fade - blends image seamlessly into background */}
        <div className="absolute inset-0 bg-gradient-to-r from-muted via-muted/50 to-transparent" />
      </div>

      {/*
        Mobile hero image - stacked BELOW the text.
        Measured 2026-10-15: stacked above, it took the first 215px of a 844px
        viewport, so the headline did not begin until y=332 and the secondary
        CTA fell below the fold. GoFundMe's mobile hero opens on the headline
        at y=56 and puts its imagery after the CTA. `order` keeps the image
        early in the DOM, so it stays the LCP candidate and `priority` still
        pays for itself. See docs/49.
      */}
      <div
        className="relative order-2 aspect-[16/9] sm:aspect-[2/1] lg:hidden"
      >
        <Image
          src="/images/hero-bg.webp"
          alt="LastDonor.org reviewed crowdfunding platform showing donation support and campaign progress"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-muted via-muted/40 to-transparent" />
      </div>

      {/* Text content - left column on desktop, full-width on mobile */}
      <div className="relative order-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="py-12 sm:py-16 lg:w-1/2 lg:py-28 xl:py-32"
        >
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
          <motion.p
            variants={fadeInUp}
            className="hero-summary mt-6 max-w-lg text-xl leading-relaxed text-muted-foreground"
          >
            Support real people through medical, emergency, and disaster
            relief campaigns, each one reviewed before it goes live.
          </motion.p>

          {/* CTAs - primary (amber) + secondary (teal outlined) */}
          <motion.div
            variants={fadeInUp}
            className="mt-10 flex flex-wrap items-center gap-4"
          >
            {/*
              Both buttons carry `border-2` so they are the same height. The
              filled one had no border and measured 48px against the outlined
              one's 52px, so the pair sat on two different baselines.
              Type is 16px, not 14px: these are the page's primary actions and
              were the smallest text on any button in either product's hero.
            */}
            <Link
              href="/campaigns"
              className="btn-press inline-flex items-center justify-center rounded-full border-2 border-transparent bg-brand-amber px-8 py-3.5 text-base font-bold text-white shadow-md transition-all duration-200 hover:shadow-[--shadow-amber] hover:-translate-y-0.5"
            >
              Browse Reviewed Campaigns
            </Link>
            <Link
              href="/share-your-story"
              className="btn-press inline-flex items-center justify-center rounded-full border-2 border-primary px-8 py-3.5 text-base font-semibold text-primary transition-all duration-200 hover:bg-primary/5 hover:-translate-y-0.5"
            >
              Share Your Story
            </Link>
          </motion.div>

          {/* Zero-Knowledge Proof strip: pre-empts top FUDs at point of CTA click */}
          <motion.p
            variants={fadeInUp}
            className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          >
            <CheckBadgeIcon className="h-4 w-4 text-brand-teal" aria-hidden="true" />
            <span>No signup required to donate</span>
            <span aria-hidden="true" className="text-border">·</span>
            <span>Every campaign human-reviewed</span>
            <span aria-hidden="true" className="text-border">·</span>
            <span>0% platform fees</span>
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
