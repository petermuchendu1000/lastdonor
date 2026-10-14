'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { NumberTicker } from '@/components/ui/number-ticker';
import { staggerContainer, fadeInUp } from '@/lib/animations';

/**
 * StatItem: Individual metric with tabular-nums for alignment.
 * Numbers are THE focal point -- largest element on screen.
 * Uses dt/dd for screen readers and semantic structure.
 *
 * Foreground is `text-primary-foreground` / `text-primary-foreground-muted`,
 * never a hard-coded `text-white`: --primary is #14B8A6 in dark mode, where
 * white computed 2.49:1 and white/70 1.89:1 (audit docs/29 P2-4).
 */
function StatItem({
  value,
  label,
  sublabel,
  prefix,
}: {
  value: number;
  label: string;
  sublabel: string;
  prefix?: string;
}) {
  return (
    <motion.div variants={fadeInUp} className="text-center">
      <dd className="font-mono text-4xl font-bold tabular-nums text-primary-foreground number-highlight sm:text-5xl lg:text-6xl">
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <NumberTicker
          value={value}
          className="font-mono text-4xl font-bold tabular-nums text-primary-foreground sm:text-5xl lg:text-6xl"
          delay={0.3}
        />
        <span className="sr-only">
          {prefix ?? ''}
          {value.toLocaleString('en-US')}
        </span>
      </dd>
      <dt className="mt-2 text-sm font-semibold text-primary-foreground">{label}</dt>
      <p className="mt-0.5 text-xs text-primary-foreground-muted">{sublabel}</p>
    </motion.div>
  );
}

interface ImpactCounterProps {
  totalRaised: number;
  totalDonors: number;
  campaignsCompleted: number;
  peopleSupported: number;
}

export function ImpactCounter({
  totalRaised,
  totalDonors,
  campaignsCompleted,
  peopleSupported,
}: ImpactCounterProps) {
  const raisedDollars = Math.round(totalRaised / 100);

  return (
    <section className="relative overflow-hidden bg-primary py-20 sm:py-24">
      {/* Grid texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
        aria-hidden="true"
      />

      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        variants={staggerContainer}
        className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
      >
        <motion.div variants={fadeInUp} className="max-w-2xl">
          <h2 className="font-display text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl">
            Real Numbers. Real People Helped.
          </h2>
          <p className="mt-3 text-base text-primary-foreground-muted">
            These are totals from real donors giving to reviewed campaigns.
            Not projections. Not estimates.
          </p>
        </motion.div>

        <motion.dl
          variants={staggerContainer}
          className="mt-14 grid grid-cols-2 gap-8 md:grid-cols-4 md:gap-12"
        >
          <StatItem
            value={raisedDollars}
            label="Total Raised"
            sublabel="Real donations"
            prefix="$"
          />
          <StatItem
            value={totalDonors}
            label="People Who Gave"
            sublabel="Unique donors"
          />
          <StatItem
            value={campaignsCompleted}
            label="Campaigns Funded"
            sublabel="Successfully completed"
          />
          <StatItem
            value={peopleSupported}
            label="Lives Changed"
            sublabel="Real people helped"
          />
        </motion.dl>

        <motion.p variants={fadeInUp} className="mt-12 text-sm text-primary-foreground-muted">
          Full breakdown of every campaign published.{' '}
          <Link
            href="/transparency"
            className="font-medium text-primary-foreground-muted underline underline-offset-4 transition-colors hover:text-primary-foreground"
          >
            View transparency report
          </Link>
        </motion.p>
      </motion.div>
    </section>
  );
}
