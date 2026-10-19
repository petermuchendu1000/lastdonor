'use client';

import {
  ClipboardDocumentCheckIcon,
  EyeIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'motion/react';
import { staggerContainer, fadeInUp } from '@/lib/animations';

const trustSignals = [
  {
    icon: ClipboardDocumentCheckIcon,
    title: 'Campaign details are reviewed',
    body:
      'Campaigns are checked before publication so donors can evaluate the story, goal, category, and supporting context.',
    detail: 'Pre-publication review',
  },
  {
    icon: EyeIcon,
    title: 'Progress stays visible',
    body:
      'Campaign totals, donor counts, updates, and completion status are visible so donors can follow what happens after they give.',
    detail: 'Visible tracking',
  },
  {
    icon: ShieldCheckIcon,
    title: '0% platform fees',
    body:
      'We take 0%. Stripe charges 2.9% plus 30 cents on a US card, and we get none of it.',
    detail: 'Stripe-secured payments',
  },
];

export function Testimonials() {
  return (
    <section className="py-20 sm:py-24 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={fadeInUp}
        >
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            What Donors Can Verify Before Giving
          </h2>
          <p className="mt-3 max-w-xl text-base text-muted-foreground">
            No invented testimonials. Just the trust signals donors can inspect on campaign pages.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-40px' }}
          variants={staggerContainer}
          className="mt-12 grid gap-6 sm:grid-cols-3"
        >
          {trustSignals.map((signal) => {
            const Icon = signal.icon;
            return (
              <motion.article
                key={signal.title}
                variants={fadeInUp}
                className="group flex flex-col rounded-2xl border border-border bg-card p-6 card-hover-lift"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>

                <h3 className="mt-5 text-base font-semibold text-foreground">
                  {signal.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {signal.body}
                </p>

                <footer className="mt-5 border-t border-border pt-4">
                  <span className="inline-flex rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    {signal.detail}
                  </span>
                </footer>
              </motion.article>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
