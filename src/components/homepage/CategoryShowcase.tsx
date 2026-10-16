import Link from 'next/link';
import {
  HeartIcon,
  BoltIcon,
  FireIcon,
  AcademicCapIcon,
  HomeIcon,
  UserGroupIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
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
  { slug: 'disaster', label: 'Disaster Relief', description: 'Fires, floods, storms', icon: ExclamationTriangleIcon },
  { slug: 'family', label: 'Family', description: 'Housing and daily needs', icon: HomeIcon },
  { slug: 'veterans', label: 'Veterans', description: 'Military family support', icon: ShieldCheckIcon },
  { slug: 'education', label: 'Education', description: 'Tuition and school costs', icon: AcademicCapIcon },
  { slug: 'community', label: 'Community', description: 'Local projects and care', icon: UserGroupIcon },
];

export function CategoryShowcase() {
  return (
    <section className="bg-surface-teal py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
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
        </div>

        {/*
          Two columns from the smallest screen. This grid previously started
          at ONE column (`grid` with `sm:grid-cols-2`), so eight cards of
          `min-h-[168px]` stacked into 1,944px of scroll on a 390px phone for
          81 words - the tallest section on the homepage. A category name is
          a short label; two fit side by side at 390px with room to spare.
          See docs/60.
        */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:mt-12 sm:gap-4 lg:grid-cols-4 lg:gap-5">
          {TOP_CATEGORIES.map(({ slug, label, description, icon: Icon }) => (
            <Link
              key={slug}
              href={`/campaigns/category/${slug}`}
              className="group flex h-full flex-col rounded-[10px] border border-border/70 bg-card px-4 py-4 shadow-elevation-1 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevation-2 sm:px-5 sm:py-5"
            >
              <Icon
                className="h-6 w-6 text-primary/70 transition-colors duration-200 group-hover:text-primary"
                strokeWidth={1.6}
                aria-hidden="true"
              />
              <span className="mt-3 font-display text-[16px] font-bold leading-tight tracking-tight text-card-foreground sm:mt-4 sm:text-[18px]">
                {label}
              </span>
              {/*
                The gloss earns its space only where the space is free. On a
                phone the label is the whole message and the description was
                a third line on every one of eight cards.
              */}
              <span className="mt-1.5 hidden text-[14px] leading-relaxed text-muted-foreground sm:block">
                {description}
              </span>
              {/*
                No "Browse ->" line. The card IS the link, so that span was a
                decorative duplicate of the element containing it - and it
                added a row plus `pt-5` to all eight cards. The accessible
                name is carried by the label text, which is what a screen
                reader should announce anyway.
              */}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
