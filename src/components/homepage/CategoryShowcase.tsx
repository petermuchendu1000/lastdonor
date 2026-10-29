import Link from 'next/link';
import type { ShowcaseCategory } from '@/lib/homepage-categories';

/**
 * The homepage's category grid.
 *
 * ⛔ `categories` is REQUIRED and comes from the database. It used to be a
 * hand-curated array of eight declared in this file, and `docs/143` §4
 * measured the drift: two of the eight held no campaigns at all while
 * `military` - tied for the most on the platform - was linked from nowhere on
 * the site. This component is the only place in the repo that links
 * `/campaigns/category/*`, so that list WAS the internal link graph for 23
 * URLs. The selection now lives in `src/lib/homepage-categories.ts`, where it
 * can be executed by a test.
 *
 * ⛔ An empty list renders NOTHING, deliberately. The section's whole job is
 * to route a visitor to campaigns that exist; with none live, a heading
 * reading "Find a Cause You Care About" above eight doors onto empty rooms is
 * worse than no section. This is a real state, not a hypothetical one -
 * `docs/79` moved every automated campaign into the review queue and
 * `/campaigns` was empty for a day.
 */
export function CategoryShowcase({ categories }: { categories: ShowcaseCategory[] }) {
  if (categories.length === 0) return null;

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
          {categories.map(({ slug, label, gloss, Icon }) => (
            <Link
              key={slug}
              href={`/campaigns/category/${slug}`}
              className="group flex h-full flex-col rounded-[10px] border border-border/70 bg-card px-4 py-4 shadow-elevation-1 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevation-2 sm:px-5 sm:py-5"
            >
              {/*
                Through the icon layer since 2026-10-29, not `@heroicons`
                directly: `size="lg"` is the 24px step this card already used
                as `h-6 w-6`, and the stroke is now the system's 1.75 rather
                than a local 1.6. See docs/70.
              */}
              <Icon
                size="lg"
                className="text-primary/70 transition-colors duration-200 group-hover:text-primary"
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
                {gloss}
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
