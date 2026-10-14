'use client';

import { motion } from 'motion/react';
import { ShieldCheckIcon, LockClosedIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { staggerContainerSlow, fadeInUp } from '@/lib/animations';

const steps = [
  {
    number: '01',
    icon: ShieldCheckIcon,
    title: 'Choose a Reviewed Campaign',
    description:
      'Every campaign is reviewed by a real person before going live. Browse by category.',
  },
  {
    number: '02',
    icon: LockClosedIcon,
    title: 'Donate Securely',
    description:
      'Pay with any card. LastDonor charges 0% platform fees on fundraisers; standard Stripe processing fees apply.',
  },
  {
    number: '03',
    icon: ChartBarIcon,
    title: 'Track Your Impact',
    description:
      'Get impact updates with photos and receipts. See exactly how your donation was used, from start to finish.',
  },
];

export function HowItWorks() {
  return (
    <section className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={fadeInUp}
          className="max-w-2xl"
        >
          <h2 className="font-display text-[1.75rem] font-bold leading-[1.15] tracking-tight text-foreground sm:text-[2rem] lg:text-[2.25rem]">
            3 Steps to Give with Confidence
          </h2>
          <p className="mt-3 font-serif text-[15px] font-light text-muted-foreground sm:mt-4 sm:text-[16px]">
            Find a reviewed campaign, donate securely, and see your impact.
          </p>
        </motion.div>

        <motion.ol
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-40px' }}
          variants={staggerContainerSlow}
          className="mt-12 grid list-none gap-10 sm:mt-14 sm:gap-12 md:grid-cols-3 md:gap-8 lg:mt-16 lg:gap-12"
        >
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <motion.li
                key={step.number}
                variants={fadeInUp}
                className="flex flex-col border-t border-border pt-6 sm:pt-7"
              >
                <div className="flex items-center gap-3">
                  <span className="font-display text-[12px] font-semibold tracking-[0.14em] text-muted-foreground sm:text-[13px]">
                    {step.number}
                  </span>
                  <span className="h-px w-6 bg-border" aria-hidden="true" />
                  <Icon
                    className="h-[18px] w-[18px] text-muted-foreground sm:h-5 sm:w-5"
                    aria-hidden="true"
                  />
                </div>

                <h3 className="mt-4 font-display text-[17px] font-bold tracking-tight text-foreground sm:mt-5 sm:text-[18px]">
                  {step.title}
                </h3>
                <p className="mt-2.5 max-w-prose font-serif text-[14px] font-light leading-[1.7] text-muted-foreground sm:mt-3 sm:text-[15px] md:text-[14px]">
                  {step.description}
                </p>
              </motion.li>
            );
          })}
        </motion.ol>
      </div>
    </section>
  );
}
