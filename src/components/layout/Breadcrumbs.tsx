'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRightIcon, HomeIcon } from '@heroicons/react/24/outline';

import { isNavigablePath } from '@/lib/navigable-routes';

const LABEL_OVERRIDES: Record<string, string> = {
  withdrawals: 'Finances',
  'payout-settings': 'Payout Account',
};

/*
  An id is not a name.

  Every crumb was title-cased from its path segment, so on any `[id]` route
  the trail read **"E2e00000 0000 4000 8000 000000000004"** - a UUID with its
  hyphens turned into spaces and each group capitalised, presented as though
  it were the page's title. It is on every admin and dashboard detail screen,
  including the campaign page an administrator reads before approving an
  appeal, and it is also emitted as a `name` in the `BreadcrumbList` JSON-LD
  below.

  This component is a client component with nothing but the pathname, so it
  cannot know the campaign's title; "Details" is the honest label for a
  segment that carries no name. Found by LOOKING at a screenshot during the
  `docs/120` review walk - no assertion was anywhere near it.
*/
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toLabel(segment: string): string {
  if (LABEL_OVERRIDES[segment]) return LABEL_OVERRIDES[segment];
  if (UUID_SEGMENT.test(segment)) return 'Details';
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  /*
    ⛔ A crumb is only a LINK if something is served at its href.

    This used to link every segment unconditionally, and four of those hrefs
    were 404s - one of them public and indexable. [VERIFIED live]
    `/campaigns/category` answers 404 while `/campaigns/category/medical`
    answers 200, carries `index, follow`, and had `href="/campaigns/category"`
    in its markup; 23 such category URLs are in the production sitemap. The
    other three are `/admin/blog/<id>`, `/admin/campaigns/<id>/updates` and
    `/admin/institutions/<id>`, each linked from the screen one level below
    it. `docs/128`.

    `isNavigablePath` is checked against a list the ratchet derives from
    `src/app/`, so a route deleted tomorrow stops being linked without anybody
    remembering this file (`docs/109`).
  */
  const crumbs = segments.map((seg, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/');
    const isLast = i === segments.length - 1;
    return {
      label: toLabel(seg),
      href,
      isLast,
      // The last crumb is already plain text, so its target is irrelevant.
      navigable: !isLast && isNavigablePath(href),
    };
  });

  /*
    ⚠️ The JSON-LD lists only the crumbs that ARE navigable, renumbered.

    A `BreadcrumbList` item is a claim that the URL is a navigable ancestor of
    this page. Emitting one that 404s states something untrue to every
    consumer of the structured data, and on `/campaigns/category/*` that page
    is indexable. Positions are recomputed rather than carried over, so the
    list stays contiguous.

    The LAST crumb keeps its `item`: it is this page, which plainly exists.
  */
  const linkedCrumbs = crumbs.filter((c) => c.navigable || c.isLast);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://lastdonor.org' },
      ...linkedCrumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 2,
        name: c.label,
        item: `https://lastdonor.org${c.href}`,
      })),
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        {/*
          ⚠️ `flex-wrap` and `min-w-0`. This was a no-wrap flex, and crumb
          labels come from page titles, so the trail's width is unbounded.
          Measured at 390px: `/admin/campaigns/[id]/updates/new` pushed the
          page to 437px and the verification screen to 446px - a phone that
          scrolls sideways on an admin tool and on an organiser's own
          verification page.

          Rendered through `src/app/admin/layout.tsx`, so this is every admin
          screen, not two.
        */}
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
          <li>
            <Link
              href="/"
              className="inline-flex items-center transition-colors hover:text-foreground"
            >
              <HomeIcon className="h-4 w-4" />
              <span className="sr-only">Home</span>
            </Link>
          </li>
          {crumbs.map((crumb) => (
            <li key={crumb.href} className="flex items-center gap-1">
              <ChevronRightIcon className="h-3 w-3" />
              {crumb.isLast ? (
                <span
                  className="min-w-0 truncate font-medium text-foreground"
                  aria-current="page"
                >
                  {crumb.label}
                </span>
              ) : crumb.navigable ? (
                <Link
                  href={crumb.href}
                  className="transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                /*
                  Nothing is served here, so it is text. The trail still shows
                  the step - deleting it would hide where the reader is - it
                  simply does not pretend to be a destination. Same shape as
                  `docs/118`, where `publicCampaignPath` returns null and both
                  renderers show plain text rather than a dead link.
                */
                <span className="min-w-0 truncate">{crumb.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
