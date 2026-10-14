'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { fadeInUp, staggerContainer } from '@/lib/animations';

/**
 * Fee chart: a simple visual anchor for the core claim.
 * The exact Stripe processing fee varies by transaction, so this intentionally
 * avoids fixed allocation percentages that would contradict checkout math.
 */
function PlatformFeeChart() {
  const radius = 15.9155;
  const circumference = 2 * Math.PI * radius;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative mx-auto h-[280px] w-[280px] sm:h-[340px] sm:w-[340px]"
    >
      <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" aria-hidden="true">
        <motion.circle
          cx="21" cy="21" r={radius} fill="none" strokeWidth="6"
          className="stroke-primary"
          strokeLinecap="round"
          initial={{ strokeDasharray: `0 ${circumference}` }}
          whileInView={{ strokeDasharray: `${circumference} 0` }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.2 }}
        />
      </svg>
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: 0.6 }}
        className="absolute inset-0 flex flex-col items-center justify-center pt-2"
      >
        <span className="font-sans text-[4.5rem] font-bold leading-none tracking-tighter text-foreground sm:text-[5.5rem]">0%</span>
        <span className="text-[17px] font-medium tracking-tight text-foreground">platform fee</span>
      </motion.div>
    </motion.div>
  );
}

/**
 * WhereYourMoneyGoes: Fund allocation transparency.
 *
 * Psychology: The #1 donor objection is "Will they take a cut?"
 * This section answers it without fixed allocation percentages because
 * card processing fees vary by transaction.
 */
export function WhereYourMoneyGoes() {
  const items = [
    {
      label: 'Campaign Support',
      value: 'Your donation',
      dotClass: 'bg-primary',
      description: 'Your gift supports the specific campaign you choose, after third-party payment processing.',
    },
    {
      label: 'Payment Processing',
      value: 'Stripe fee',
      dotClass: 'bg-brand-amber',
      description: 'Stripe charges its standard card processing fee. LastDonor does not receive any part of it.',
    },
    {
      label: 'LastDonor Platform Fee',
      value: '0%',
      dotClass: 'bg-[#D1D5DB]',
      description: 'LastDonor does not add a platform cut or tip request to fundraiser donations.',
    },
  ];

  return (
    <section className="py-20 sm:py-24 bg-surface-amber">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        
        {/* Header centered */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={fadeInUp}
          className="mx-auto max-w-3xl text-center mb-16 sm:mb-24"
        >
          <h2 className="font-display text-[2.5rem] font-bold leading-[1.15] tracking-[-0.02em] text-foreground sm:text-[3.25rem]">
            0% Platform Fees,<br className="hidden md:block" /> Clear Payment Processing
          </h2>
          <p className="mx-auto mt-6 max-w-2xl font-sans text-[17px] leading-relaxed text-foreground">
            LastDonor charges 0% platform fees on fundraisers. Standard Stripe payment processing fees apply.<br className="hidden md:block" />
            Operations are funded separately through general fund donations, grants, sponsorships, and operating support.
          </p>
        </motion.div>

        <div className="grid items-center gap-16 md:grid-cols-2 md:gap-8 lg:gap-24">
          {/* Left: breakdown list */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-60px' }}
            variants={staggerContainer}
            className="flex flex-col"
          >
            {/* Breakdown items */}
            <motion.div variants={staggerContainer} className="space-y-12">
              {items.map((item) => (
                <motion.div key={item.label} variants={fadeInUp} className="flex flex-row items-stretch gap-6 sm:gap-10">
                  <div className="w-[85px] sm:w-[120px] shrink-0 text-right">
                    <span className="block font-sans text-[1.65rem] font-bold leading-[1] tracking-tight text-foreground sm:text-[2rem]">
                      {item.value}
                    </span>
                  </div>
                  <div className="flex flex-1 items-start gap-3">
                    <span className={`mt-1.5 block h-3.5 w-3.5 shrink-0 rounded-full ${item.dotClass}`} />
                    <div>
                      <h3 className="font-sans text-xl font-bold tracking-tight text-foreground leading-[1.2]">
                        {item.label}
                      </h3>
                      <p className="mt-1.5 text-base leading-[1.3] text-foreground max-w-[280px]">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            <motion.div variants={fadeInUp} className="mt-12 pl-[109px] sm:pl-[160px]">
              <Link
                href="/how-it-works"
                className="btn-press inline-flex rounded-full border-[1.5px] border-primary px-8 py-3.5 font-sans text-[15px] font-bold text-primary transition-all duration-200 hover:bg-primary/5 hover:-translate-y-0.5"
              >
                See the full breakdown
              </Link>
            </motion.div>
          </motion.div>

          {/* Right: donut chart */}
          <div className="flex justify-center md:justify-end">
            <PlatformFeeChart />
          </div>
        </div>
      </div>
    </section>
  );
}
