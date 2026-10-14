/**
 * Multi-source image resolver for simulated campaign hero images.
 *
 * Resolution order (news-first with graceful degradation):
 *
 *   Tier 1 -> News source image (GNews article.image, RSS media:content)
 *   Tier 2 -> OG/meta image extracted from the article's HTML page
 *   Tier 3 -> Contextual Unsplash search (campaign-specific terms)
 *   Tier 4 -> Contextual Pexels search (campaign-specific terms)
 *   Tier 5 -> Category fallback SVG (guaranteed, zero-network)
 *
 * Design rationale (donor psychology & trust signals):
 * - News source images carry the highest authenticity signal. A photo from
 *   the actual news story tells the reader "this is real" before they read
 *   a single word. Eye-tracking studies show users fixate on the hero image
 *   before the title -- a contextually relevant image increases engagement
 *   by 40-60% compared to generic stock.
 * - OG images are curated by the news outlet's editorial team specifically
 *   for social sharing -- they are high quality, correctly cropped, and
 *   emotionally chosen. They outperform the thumbnail URL in GNews's API.
 * - When no news image is available, a contextual stock photo search uses
 *   the campaign's specific subject, event, and location to find a photo
 *   that resonates with the story (e.g., "house fire community support
 *   Portland" rather than generic "disaster"). This prevents the
 *   "all campaigns look the same" repetition problem that erodes trust.
 * - Queries are framed around recovery/hope/community (not destruction)
 *   because positive-adjacent imagery drives 3x more donations than
 *   suffering imagery. Donors give to uplift, not to witness pain.
 */

import {
  getCategoryFallbackImage,
} from '@/lib/news/image-validation';
import { safeFetch } from '@/lib/news/safe-fetch';
import { isSafeOutboundUrl } from '@/lib/validators/url-allowlist';

// ── Types ──────────────────────────────────────────────────────────────────

export type ImageSource = 'news' | 'og_meta' | 'unsplash' | 'pexels' | 'fallback';

export type ImageResolution = {
  url: string;
  credit: string | null;
  source: ImageSource;
};

export type ImageResolverContext = {
  /** Original image URL from the news source (GNews, RSS). */
  newsImageUrl?: string;
  /** URL of the news article (for OG image extraction). */
  articleUrl?: string;
  /** Campaign category (for fallback and query framing). */
  category: string;
  /** Entity name / subject of the campaign. */
  subjectName?: string;
  /** Key event or incident described in the campaign. */
  event?: string;
  /** Location of the subject / event. */
  location?: string;
};

// ── Minimum image size to reject tiny icons/logos ──────────────────────────

const MIN_IMAGE_BYTES = 5_000; // 5 KB -- anything below is likely a favicon or 1x1 tracker
const FETCH_TIMEOUT_MS = 6_000;

// ── Main Resolver ──────────────────────────────────────────────────────────

/**
 * Resolve the best available hero image for a campaign through a five-tier
 * cascade. Returns the URL, an optional photo credit (required for stock
 * photos per Unsplash/Pexels TOS), and the source tier for audit logging.
 */
export async function resolveHeroImageEnhanced(
  ctx: ImageResolverContext,
): Promise<ImageResolution> {
  // ── Tier 1: News source image ──────────────────────────────────────────
  const newsUrl = await validateImageWithSize(ctx.newsImageUrl);
  if (newsUrl) {
    return { url: newsUrl, credit: null, source: 'news' };
  }

  // ── Tier 2: OG / meta / LD+JSON image from article page ───────────────
  if (ctx.articleUrl) {
    const ogUrl = await extractAndValidateOgImage(ctx.articleUrl);
    if (ogUrl) {
      return { url: ogUrl, credit: null, source: 'og_meta' };
    }
  }

  // ── Tier 3: Contextual Unsplash search ─────────────────────────────────
  const unsplashResult = await searchUnsplashContextual(ctx);
  if (unsplashResult) {
    return { url: unsplashResult.url, credit: unsplashResult.credit, source: 'unsplash' };
  }

  // ── Tier 4: Contextual Pexels search ───────────────────────────────────
  const pexelsResult = await searchPexelsContextual(ctx);
  if (pexelsResult) {
    return { url: pexelsResult.url, credit: pexelsResult.credit, source: 'pexels' };
  }

  // ── Tier 5: Category fallback SVG ──────────────────────────────────────
  return {
    url: getCategoryFallbackImage(ctx.category),
    credit: null,
    source: 'fallback',
  };
}

// ── Tier 1 Helper: Validate URL + size check ─────────────────────────────

/**
 * Validate an image URL is accessible, returns an image content type,
 * AND is larger than MIN_IMAGE_BYTES (to reject favicons/logos/trackers).
 */
async function validateImageWithSize(
  url: string | undefined,
): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('/')) return url; // Local paths are always valid

  try {
    // SSRF guard (audit P1-15): the host comes from third-party content, and
    // safeFetch re-validates every redirect hop rather than following blindly.
    const res = await safeFetch(url, {
      method: 'HEAD',
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LastDonor/1.0)',
        Accept: 'image/*',
      },
    });

    if (!res.ok) return undefined;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/') && !contentType.startsWith('application/octet-stream')) {
      return undefined;
    }

    // Reject tiny images (icons, logos, 1x1 tracking pixels)
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) < MIN_IMAGE_BYTES) {
      return undefined;
    }

    return url;
  } catch {
    return undefined;
  }
}

// ── Tier 2 Helper: OG / meta / LD+JSON image extraction ─────────────────

/**
 * Fetch the article page HTML and extract the best available image URL from
 * structured metadata. Priority order:
 *   1. og:image (Open Graph -- used by Facebook, most news sites set this)
 *   2. twitter:image (Twitter Card -- often identical to og:image but
 *      sometimes higher resolution)
 *   3. LD+JSON image (NewsArticle schema -- the most structured source)
 *   4. LD+JSON thumbnailUrl (less common but sometimes present)
 *
 * Each extracted URL is validated with a HEAD request before being returned.
 */
async function extractAndValidateOgImage(
  articleUrl: string,
): Promise<string | undefined> {
  try {
    // SSRF guard (audit P1-15). The article URL itself is third-party data.
    const res = await safeFetch(articleUrl, {
      method: 'GET',
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) return undefined;

    const html = await res.text();
    const candidates = extractImageCandidates(html);

    // Validate each candidate in priority order
    for (const candidate of candidates) {
      const validated = await validateImageWithSize(candidate);
      if (validated) return validated;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract image URL candidates from HTML metadata, ordered by reliability.
 * Returns de-duplicated URLs.
 */
export function extractImageCandidates(html: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (url: string | null | undefined) => {
    if (!url || seen.has(url)) return;
    // Basic sanity: must be absolute HTTPS URL
    if (!url.startsWith('https://')) return;
    // SSRF guard (audit P1-15): these values are attacker-controlled markup
    // from an arbitrary publisher. `startsWith('https://')` alone admits
    // `https://169.254.169.254/` and `https://trusted.example@10.0.0.1/`.
    if (!isSafeOutboundUrl(url)) return;
    // Reject known non-image URLs (SVG logos, site icons)
    if (url.includes('favicon') || url.includes('logo') || url.endsWith('.ico')) return;
    seen.add(url);
    candidates.push(url);
  };

  // 1. og:image (most reliable for news sites)
  const ogMatch = html.match(
    /<meta[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i,
  ) ?? html.match(
    /<meta[^>]*content="([^"]+)"[^>]*property="og:image"[^>]*>/i,
  );
  add(ogMatch?.[1]);

  // 2. twitter:image
  const twitterMatch = html.match(
    /<meta[^>]*(?:name|property)="twitter:image(?::src)?"[^>]*content="([^"]+)"[^>]*>/i,
  ) ?? html.match(
    /<meta[^>]*content="([^"]+)"[^>]*(?:name|property)="twitter:image(?::src)?"[^>]*>/i,
  );
  add(twitterMatch?.[1]);

  // 3. LD+JSON image fields
  const ldRegex =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch;
  while ((ldMatch = ldRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(ldMatch[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (
          item['@type'] === 'NewsArticle' ||
          item['@type'] === 'Article' ||
          item['@type'] === 'ReportageNewsArticle'
        ) {
          // image can be string, array of strings, or ImageObject
          const img = item.image;
          if (typeof img === 'string') {
            add(img);
          } else if (Array.isArray(img)) {
            for (const i of img) {
              add(typeof i === 'string' ? i : i?.url);
            }
          } else if (img?.url) {
            add(img.url);
          }

          // thumbnailUrl as lower-priority alternative
          if (typeof item.thumbnailUrl === 'string') {
            add(item.thumbnailUrl);
          }
        }
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  }

  return candidates;
}

// ── Tier 3: Contextual Unsplash search ───────────────────────────────────

/**
 * Search Unsplash for a single landscape photo matching the campaign context.
 * Returns null if UNSPLASH_ACCESS_KEY is not configured or search fails.
 */
async function searchUnsplashContextual(
  ctx: ImageResolverContext,
): Promise<{ url: string; credit: string } | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;

  const query = buildStockPhotoQuery(ctx);

  try {
    const params = new URLSearchParams({
      query,
      orientation: 'landscape',
      per_page: '1',
      content_filter: 'high',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
      headers: {
        Authorization: `Client-ID ${key}`,
        'Accept-Version': 'v1',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as {
      results: Array<{
        urls: { raw: string };
        user: { name: string };
      }>;
    };

    const photo = data.results[0];
    if (!photo) return null;

    return {
      url: `${photo.urls.raw}&w=800&h=500&fit=crop&auto=format&q=80`,
      credit: `Photo by ${photo.user.name} on Unsplash`,
    };
  } catch {
    return null;
  }
}

// ── Tier 4: Contextual Pexels search ─────────────────────────────────────

/**
 * Search Pexels for a single landscape photo matching the campaign context.
 * Returns null if PEXELS_API_KEY is not configured or search fails.
 */
async function searchPexelsContextual(
  ctx: ImageResolverContext,
): Promise<{ url: string; credit: string } | null> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;

  const query = buildStockPhotoQuery(ctx);

  try {
    const params = new URLSearchParams({
      query,
      orientation: 'landscape',
      per_page: '1',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: key },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as {
      photos: Array<{
        src: { original: string };
        photographer: string;
      }>;
    };

    const photo = data.photos[0];
    if (!photo) return null;

    return {
      url: `${photo.src.original}?auto=compress&cs=tinysrgb&w=800&h=500&fit=crop`,
      credit: `Photo by ${photo.photographer} on Pexels`,
    };
  } catch {
    return null;
  }
}

// ── Stock Photo Query Builder ────────────────────────────────────────────

/**
 * Build a contextually specific, psychologically optimized search query
 * for stock photo APIs.
 *
 * Key principles:
 * - Specificity over generality: "house fire community Portland" >> "disaster"
 * - Recovery/hope framing: donors give to uplift, not to witness destruction
 * - People-centric terms: images with human presence drive stronger empathy
 * - Cultural sensitivity: no graphic terms, no images of children suffering
 * - Category-aware emotional framing matched to the campaign type
 */
const CATEGORY_QUERY_FRAMING: Record<string, string> = {
  medical: 'hospital recovery hope family support',
  disaster: 'community rebuilding hope neighbors helping',
  military: 'military family tribute honor service',
  veterans: 'veteran community support new beginning',
  memorial: 'memorial tribute remembrance candles flowers',
  'first-responders': 'first responder hero courage community',
  community: 'neighbors helping community together',
  'essential-needs': 'food shelter humanitarian aid warmth',
  emergency: 'emergency relief helping hands community',
  charity: 'volunteers donation giving generosity',
  education: 'student scholarship learning growth',
  animal: 'animal rescue shelter adoption compassion',
  environment: 'nature conservation sustainability',
  business: 'small business community support',
  competition: 'athletic determination youth sports',
  creative: 'art creative expression inspiration',
  event: 'community gathering celebration fundraiser',
  faith: 'community prayer spiritual devotion',
  family: 'family together home children love',
  sports: 'youth sports team athletics support',
  travel: 'journey hope adventure road',
  volunteer: 'volunteer service community helping',
  wishes: 'dream wish hope celebration',
};

/**
 * Extract the most salient keywords from an event description.
 * Strips common noise words and limits to the most descriptive 3 terms.
 */
function extractEventKeywords(event: string | undefined): string {
  if (!event) return '';

  const stopWords = new Set([
    'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'and', 'or', 'but', 'is', 'was', 'were', 'are', 'been', 'being',
    'has', 'had', 'have', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'that', 'this', 'these',
    'those', 'from', 'by', 'as', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'under', 'over', 'up', 'down',
    'out', 'off', 'then', 'once', 'here', 'there', 'when', 'where',
    'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'just', 'because', 'while',
    'who', 'whom', 'which', 'what', 'about', 'his', 'her', 'its',
    'their', 'our', 'your', 'my', 'he', 'she', 'it', 'they', 'we',
    'you', 'i', 'me', 'him', 'us', 'them',
  ]);

  return event
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 3)
    .join(' ');
}

export function buildStockPhotoQuery(ctx: ImageResolverContext): string {
  const parts: string[] = [];

  // Event keywords are the most specific, contextually rich signal
  const eventKeywords = extractEventKeywords(ctx.event);
  if (eventKeywords) parts.push(eventKeywords);

  // Location adds geographic specificity (skip "Unknown" placeholder)
  if (ctx.location && ctx.location !== 'Unknown') {
    // Use only city/state, not full addresses
    const shortLocation = ctx.location.split(',')[0].trim();
    if (shortLocation.length > 2 && shortLocation.length < 30) {
      parts.push(shortLocation);
    }
  }

  // Category-specific emotional framing
  const framing = CATEGORY_QUERY_FRAMING[ctx.category] ?? 'community support hope';
  parts.push(framing);

  // Combine and limit total query length (APIs have limits, ~100 chars optimal)
  return parts.join(' ').slice(0, 100).trim();
}
