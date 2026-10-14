/**
 * Fetch the full article body text from a URL.
 * Uses a simple HTML-to-text approach - no external dependencies.
 * Falls back gracefully to the provided summary if fetching or parsing fails.
 */

import { safeFetch } from '@/lib/news/safe-fetch';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_LENGTH = 5000; // chars - enough context for entity extraction

/**
 * Fetch the full article text from a news URL.
 * Returns the extracted body text, or the fallback string on any failure.
 */
export async function fetchArticleBody(
  url: string,
  fallback: string,
): Promise<string> {
  try {
    // SSRF guard (audit P1-15): `url` is a link harvested from an RSS feed or
    // the GNews API, i.e. third-party data. safeFetch refuses non-public hosts
    // and re-validates every redirect hop instead of following blindly.
    const res = await safeFetch(url, {
      method: 'GET',
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) return fallback;

    const html = await res.text();

    // Try structured data first (ld+json) - most reliable source
    const ldBody = extractFromLdJson(html);
    if (ldBody && ldBody.length > fallback.length + 50) return ldBody;

    // Try article body extraction from HTML
    const body = extractArticleText(html);
    if (body.length > fallback.length + 50) return body;

    // Try meta description as last resort supplement
    const metaDesc = extractMetaDescription(html);
    if (metaDesc && metaDesc.length > fallback.length + 20) return metaDesc;

    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Extract readable article text from raw HTML.
 * Strips scripts, styles, nav, header, footer, ads, then extracts <p> tag content.
 */
function extractArticleText(html: string): string {
  // Remove scripts, styles, and non-content elements
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Try to find the article body first (common containers)
  const articleMatch =
    cleaned.match(/<article[\s\S]*?<\/article>/i) ??
    cleaned.match(/<div[^>]*class="[^"]*(?:article|story|post|content)[^"]*"[\s\S]*?<\/div>/i);

  const source = articleMatch ? articleMatch[0] : cleaned;

  // Extract text from <p> tags - the most reliable content signal
  const paragraphs: string[] = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(source)) !== null) {
    const text = match[1]
      .replace(/<[^>]+>/g, '') // strip inner tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Skip very short paragraphs (likely UI elements, not content)
    if (text.length > 30) {
      paragraphs.push(text);
    }
  }

  const body = paragraphs.join('\n\n');
  return body.length > MAX_BODY_LENGTH ? body.slice(0, MAX_BODY_LENGTH) : body;
}

/**
 * Extract article body from ld+json structured data.
 * Many news sites embed full article text in JSON-LD NewsArticle schema.
 */
function extractFromLdJson(html: string): string | null {
  const ldRegex =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = ldRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (
          item['@type'] === 'NewsArticle' ||
          item['@type'] === 'Article' ||
          item['@type'] === 'ReportageNewsArticle'
        ) {
          const body = item.articleBody ?? item.text;
          if (typeof body === 'string' && body.length > 100) {
            return body.length > MAX_BODY_LENGTH
              ? body.slice(0, MAX_BODY_LENGTH)
              : body;
          }
        }
      }
    } catch {
      // Invalid JSON - skip
    }
  }
  return null;
}

/**
 * Extract og:description or meta description from HTML.
 */
function extractMetaDescription(html: string): string | null {
  const ogMatch = html.match(
    /<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i,
  );
  if (ogMatch?.[1] && ogMatch[1].length > 50) return ogMatch[1];

  const metaMatch = html.match(
    /<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i,
  );
  if (metaMatch?.[1] && metaMatch[1].length > 50) return metaMatch[1];

  return null;
}
