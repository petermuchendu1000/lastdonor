'use client';

import Link from 'next/link';
import {
  HeartIcon,
  BoltIcon,
  FireIcon,
  AcademicCapIcon,
  HomeIcon,
  UserGroupIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'motion/react';
import { staggerContainer, fadeInUp } from '@/lib/animations';
import type { CampaignCategory } from '@/types';

type CategoryItem = {
  slug: CampaignCategory;
  label: string;
  description: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const TOP_CATEGORIES: CategoryItem[] = [
  { slug: 'medical', label: 'Medical', description: 'Bills, surgery, treatment', icon: HeartIcon },
  { slug: 'emergency', label: 'Emergency', description: 'Urgent help after crisis', icon: BoltIcon },
  { slug: 'memorial', label: 'Memorial', description: 'Funeral and grief support', icon: FireIcon },
  { slug: 'disaster', label: 'Disaster Relief', description: 'Fires, floods, storms', icon: ShieldCheckIcon },
  { slug: 'family', label: 'Family', description: 'Housing and daily needs', icon: HomeIcon },
  { slug: 'veterans', label: 'Veterans', description: 'Military family support', icon: ShieldCheckIcon },
  { slug: 'education', label: 'Education', description: 'Tuition and school costs', icon: AcademicCapIcon },
  { slug: 'community', label: 'Community', description: 'Local projects and care', icon: UserGroupIcon },
];

export function CategoryShowcase() {
  return (
    <section className="bg-surface-teal py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={fadeInUp}
          className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="max-w-2xl">
            <p className="font-sans text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              Reviewed campaign categories
            </p>
            <h2 className="mt-3 font-display text-[2rem] font-bold leading-[1.15] tracking-tight text-foreground md:text-[2.25rem]">
              Find a Cause You Care About
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground md:text-[16px]">
              Browse reviewed fundraisers by real-life need and give where your support matters most.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/campaigns"
              className="btn-press inline-flex items-center justify-center rounded-full border border-primary/30 px-5 py-2.5 text-sm font-semibold text-primary transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/5"
            >
              Browse all
            </Link>
            <Link
              href="/share-your-story"
              className="btn-press inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-brand transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90"
            >
              Start a fundraiser
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-40px' }}
          variants={staggerContainer}
          className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5"
        >
          {TOP_CATEGORIES.map(({ slug, label, description, icon: Icon }) => (
            <motion.div key={slug} variants={fadeInUp}>
              <Link
                href={`/campaigns/category/${slug}`}
                aria-label={`Browse ${label} campaigns`}
                className="group flex min-h-[168px] flex-col rounded-[8px] border border-border/70 bg-white px-5 py-5 shadow-elevation-1 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevation-2"
              >
                <Icon
                  className="h-6 w-6 text-muted-foreground transition-colors duration-200 group-hover:text-slate-600"
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
                <span className="mt-5 font-display text-[18px] font-bold leading-tight tracking-tight text-foreground">
                  {label}
                </span>
                <span className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                  {description}
                </span>
                <span className="mt-auto pt-5 text-[13px] font-bold text-primary transition-colors duration-200 group-hover:text-primary/80">
                  Browse -&gt;
                </span>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
