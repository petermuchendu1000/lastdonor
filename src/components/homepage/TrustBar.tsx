'use client';

import { motion } from 'motion/react';
import { fadeInUp } from '@/lib/animations';
import {
  CurrencyDollarIcon,
  ShieldCheckIcon,
  EyeIcon,
} from '@heroicons/react/24/solid';

/**
 * Trust Bar: Three data-driven proof points beneath the hero.
 * Psychology: Each metric pre-empts a specific donor objection:
 * - "Will they take a cut?" -> 0% Fees
 * - "Was this reviewed?" -> Reviewed by humans
 * - "Where does my money go?" -> Full tracking
 */
const proofPoints = [
  {
    icon: CurrencyDollarIcon,
    label: '0% Platform Fees.',
    sublabel: 'Standard Stripe payment processing fees apply.',
    tint: 'bg-brand-amber/10 text-brand-amber ring-brand-amber/20',
  },
  {
    icon: ShieldCheckIcon,
    label: 'Human Reviewed.',
    sublabel: 'Reviewed before going live.',
    tint: 'bg-brand-teal/10 text-brand-teal ring-brand-teal/20',
  },
  {
    icon: EyeIcon,
    label: 'Impact Updates.',
    sublabel: 'Photos, receipts, transparency.',
    tint: 'bg-brand-green/10 text-brand-green ring-brand-green/20',
  },
];

export function TrustBar() {
  return (
    <section
      className="border-t border-border bg-background"
      aria-label="Platform trust indicators"
    >
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-20px' }}
          variants={fadeInUp}
          className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-evenly sm:gap-0"
        >
          {proofPoints.map((point) => (
            <div key={point.label} className="flex items-center gap-4">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ${point.tint}`}
              >
                <point.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  {point.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {point.sublabel}
                </p>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
