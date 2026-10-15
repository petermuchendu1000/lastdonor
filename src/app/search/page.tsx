import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { BROWSE_PARAM_KEYS, campaignsHref } from '@/app/campaigns/browse-params';

export const metadata: Metadata = {
  title: 'Search - LastDonor.org',
  robots: { index: false, follow: true },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/search` is the target of the sitelinks SearchAction declared in
 * `src/app/layout.tsx` (`/search?q={search_term_string}`), so it is the URL
 * Google, bookmarks, emails and external links use. It has no UI of its own:
 * every browse surface lives at `/campaigns`.
 *
 * It used to `redirect('/campaigns')` with no query string at all, which threw
 * away the search term and left the visitor on an unfiltered listing with no
 * sign that anything had been searched. Forward every param `/campaigns`
 * understands instead.
 */
export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const forwarded: Record<string, string> = {};
  for (const key of BROWSE_PARAM_KEYS) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim() !== '') {
      forwarded[key] = value;
    }
  }

  redirect(campaignsHref(forwarded));
}
