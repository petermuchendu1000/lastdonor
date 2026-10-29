import type { ComponentType } from 'react';
import {
  AcademicCapIcon,
  BoltIcon,
  BriefcaseIcon,
  BuildingLibraryIcon,
  CalendarDaysIcon,
  FireIcon,
  FlagIcon,
  GiftIcon,
  GlobeAmericasIcon,
  HandRaisedIcon,
  HeartIcon,
  HomeIcon,
  LifebuoyIcon,
  PaintBrushIcon,
  PaperAirplaneIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  TrophyIcon,
  UserGroupIcon,
  WarningIcon,
  type IconProps,
} from '@/components/ui/icon';
import { getCategoryContent } from '@/lib/category-content';
import type { CampaignCategory } from '@/types';

/**
 * Which categories the homepage grid promotes, and in what order.
 *
 * ── ⛔ WHY THIS IS DERIVED FROM THE DATABASE ────────────────────────────────
 *
 * `CategoryShowcase` used to render a hand-curated array of eight
 * (`TOP_CATEGORIES`), and `docs/143` §4 measured what that had drifted into:
 *
 *   | Has campaigns AND linked | medical, emergency, memorial, disaster,
 *   |                          | veterans, community                       (6)
 *   | **Has campaigns, NOT linked** | **military (3), essential-needs (1)** |
 *   | Linked but **empty**     | family, education                         |
 *
 * So `military` - tied for the most campaigns on the platform - was reachable
 * from no crawler-visible link at all, while two empty categories occupied
 * grid slots and sent every visitor who pressed them to a page saying "No
 * active campaigns right now". That component is the ONLY place in the repo
 * that links `/campaigns/category/*`, so a curated list is the whole internal
 * link graph for 23 URLs.
 *
 * A hand-written list is only as good as whoever remembered to extend it -
 * the same shape as `docs/119`'s sealed-region list, `docs/124`'s PII scrub
 * and `docs/116` §4's two-file gate. This asks the data instead.
 *
 * ── ⚠️ WHAT IS *NOT* DERIVED, AND WHY ──────────────────────────────────────
 *
 * The **sitemap still advertises all 23** (`sitemap.ts` maps
 * `ALL_CATEGORY_SLUGS`). A category page with no campaigns today is still a
 * real page that will fill, and `generateStaticParams` builds all 23. What
 * changes here is only which of them the homepage *promotes*. A test pins
 * that the 23 stay in the sitemap, because the obvious "tidy-up" after this
 * change is to drop them, and that would be a different decision.
 */

/** The icon and one-line gloss for each category card. */
export interface CategoryCardMeta {
  /**
   * The second line, shown from `sm` up only - on a phone the label is the
   * whole message (`docs/60`). Each is grounded in that category's own
   * `ogSubtitle` in `category-content.ts` rather than invented, so the grid
   * does not become a 23rd place where the product describes itself.
   */
  gloss: string;
  Icon: ComponentType<IconProps>;
}

/**
 * ⛔ A `Record` over the union, not a partial map or an array.
 *
 * `CampaignCategory` has 23 members, so `tsc` enumerates them here: adding a
 * 24th category to the enum fails the build until somebody decides what its
 * card looks like. An array with a lookup would have compiled with a hole in
 * it, which is how the curated list came to be missing `military`.
 *
 * ⚠️ Three of these are APPROXIMATIONS and are marked. The icon set is
 * stroke-only heroicons (`docs/70`) and contains no paw, no ball and no place
 * of worship - verified by searching all 324 exported names. The alternative
 * was drawing them, and `docs/70` draws a mark only when "the concept is
 * ours". The icon is `aria-hidden` and the LABEL carries the meaning, so an
 * approximate mark costs nothing a screen reader can hear; a wrong one would
 * still be wrong.
 */
export const CATEGORY_CARDS: Record<CampaignCategory, CategoryCardMeta> = {
  medical: { gloss: 'Bills, surgery, treatment', Icon: HeartIcon },
  emergency: { gloss: 'Urgent help after crisis', Icon: BoltIcon },
  memorial: { gloss: 'Funeral and grief support', Icon: FireIcon },
  disaster: { gloss: 'Fires, floods, storms', Icon: WarningIcon },
  military: { gloss: 'Serving members and families', Icon: ShieldCheckIcon },
  veterans: { gloss: 'Former service members', Icon: FlagIcon },
  'first-responders': { gloss: 'Police, fire, paramedics', Icon: LifebuoyIcon },
  'essential-needs': { gloss: 'Food, rent, utilities', Icon: ShoppingBagIcon },
  family: { gloss: 'Housing and daily needs', Icon: HomeIcon },
  community: { gloss: 'Local projects and care', Icon: UserGroupIcon },
  education: { gloss: 'Tuition and school costs', Icon: AcademicCapIcon },
  charity: { gloss: 'Charitable causes and groups', Icon: GiftIcon },
  volunteer: { gloss: 'Volunteer and service work', Icon: HandRaisedIcon },
  environment: { gloss: 'Conservation and clean-up', Icon: GlobeAmericasIcon },
  business: { gloss: 'Small business recovery', Icon: BriefcaseIcon },
  competition: { gloss: 'Athletes and teams competing', Icon: TrophyIcon },
  creative: { gloss: 'Creative work and projects', Icon: PaintBrushIcon },
  event: { gloss: 'Community events', Icon: CalendarDaysIcon },
  travel: { gloss: 'Trips people need to make', Icon: PaperAirplaneIcon },
  wishes: { gloss: 'Wishes made possible', Icon: SparklesIcon },
  // Approximations. See the note above.
  sports: { gloss: 'Athletes and teams', Icon: StarIcon },
  faith: { gloss: 'Churches and ministries', Icon: BuildingLibraryIcon },
  animal: { gloss: 'Vet bills, pets, rescues', Icon: TagIcon },
};

/**
 * How many cards the grid may show.
 *
 * ⛔ Not a round number. `docs/60` measured this grid's mobile height budget
 * against exactly eight cards: at one column it ran **1,944px on a 390px
 * phone for 81 words**, the tallest section on the homepage, and the fix was
 * two columns from the smallest screen. Raising this re-opens that
 * measurement. Today the data yields exactly eight, so the live page is
 * unchanged in height and only its CONTENTS move.
 */
export const MAX_SHOWCASE_CARDS = 8;

/** One rendered card. */
export interface ShowcaseCategory {
  slug: CampaignCategory;
  label: string;
  gloss: string;
  Icon: ComponentType<IconProps>;
  /** Live campaigns in this category. Always >= 1; a zero never gets here. */
  count: number;
}

/** A per-category tally, as the homepage's `GROUP BY` returns it. */
export interface CategoryCount {
  category: string | null;
  count: number | string;
}

/**
 * Pick the cards to render from a per-category tally.
 *
 * Pure: no database, no clock, no environment. The query that feeds it lives
 * in `(home)/page.tsx`; this is the part worth testing, so it is the part
 * that is separable (`docs/107`, `docs/126` - a decision inside a route
 * handler is a decision no test can execute).
 *
 * ⚠️ The tie-break is the LABEL, not input order. Four categories sit on one
 * campaign each, and `GROUP BY` makes no promise about row order, so without
 * a deterministic second key the homepage grid would reshuffle itself between
 * cache revalidations for no reason a reader could see.
 */
export function selectShowcaseCategories(counts: readonly CategoryCount[]): ShowcaseCategory[] {
  const cards: ShowcaseCategory[] = [];

  for (const row of counts) {
    const slug = row.category as CampaignCategory | null;
    // An unknown slug means the enum and this map have drifted. Skipping is
    // the safe direction: it can only under-promote.
    if (!slug || !(slug in CATEGORY_CARDS)) continue;

    const n = Number(row.count);
    // The whole point. A category with nothing in it is not promoted, because
    // the page behind the card says "No active campaigns right now".
    if (!Number.isFinite(n) || n <= 0) continue;

    const content = getCategoryContent(slug);
    if (!content) continue;

    const meta = CATEGORY_CARDS[slug];
    cards.push({ slug, label: content.label, gloss: meta.gloss, Icon: meta.Icon, count: n });
  }

  cards.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return cards.slice(0, MAX_SHOWCASE_CARDS);
}
