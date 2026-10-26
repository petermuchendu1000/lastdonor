'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRightIcon, HomeIcon } from '@heroicons/react/24/outline';

const LABEL_OVERRIDES: Record<string, string> = {
  withdrawals: 'Finances',
  'payout-settings': 'Payout Account',
};

function toLabel(segment: string): string {
  if (LABEL_OVERRIDES[segment]) return LABEL_OVERRIDES[segment];
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, i) => ({
    label: toLabel(seg),
    href: '/' + segments.slice(0, i + 1).join('/'),
    isLast: i === segments.length - 1,
  }));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://lastdonor.org' },
      ...crumbs.map((c, i) => ({
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
              ) : (
                <Link
                  href={crumb.href}
                  className="transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
