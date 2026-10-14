/**
 * Image validation utilities for campaign publishing.
 * Validates external image URLs are accessible before storing them.
 *
 * The HEAD probe below targets a host supplied by third-party news content,
 * so it goes through `safeFetch` (audit P1-15), which refuses non-public
 * hosts and re-validates every redirect hop.
 */

import { safeFetch } from '@/lib/news/safe-fetch';

const VALIDATION_TIMEOUT_MS = 5_000;

const CATEGORY_FALLBACK_MAP: Record<string, string> = {
  emergency: 'disaster',
  charity: 'community',
  education: 'community',
  animal: 'community',
  environment: 'community',
  business: 'community',
  competition: 'community',
  creative: 'community',
  event: 'community',
  faith: 'community',
  family: 'essential-needs',
  sports: 'community',
  travel: 'community',
  volunteer: 'community',
  wishes: 'memorial',
};

export function getCategoryFallbackImage(category: string): string {
  const mapped = CATEGORY_FALLBACK_MAP[category] ?? category;
  return `/images/categories/${mapped}-default.svg`;
}

/**
 * Validate that an image URL is accessible and returns an image content type.
 * Returns the URL if valid, undefined if not.
 */
export async function validateImageUrl(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;

  // Local paths are always valid
  if (url.startsWith('/')) return url;

  try {
    const res = await safeFetch(url, {
      method: 'HEAD',
      timeoutMs: VALIDATION_TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LastDonor/1.0)',
        Accept: 'image/*',
      },
    });

    if (!res.ok) return undefined;

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.startsWith('image/') || contentType.startsWith('application/octet-stream')) {
      return url;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the hero image URL for a campaign.
 * Validates the source image URL and falls back to category SVG if unavailable.
 */
export async function resolveHeroImage(
  imageUrl: string | undefined,
  category: string,
): Promise<string> {
  const validatedUrl = await validateImageUrl(imageUrl);
  return validatedUrl ?? getCategoryFallbackImage(category);
}
