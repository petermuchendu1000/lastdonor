/**
 * HTML Formatter - post-processing pipeline for blog HTML.
 *
 * Applies structural enhancements that the AI cannot reliably produce:
 * - Table of Contents from H2 headings
 * - Section image injection
 * - CTA block at the end
 * - HTML normalization (spacing, structure)
 * - Readability score calculation
 */

import type { BlogImageResult } from './image-generator';

// ---------------------------------------------------------------------------
// Table of Contents
// ---------------------------------------------------------------------------

/**
 * Generate a Table of Contents from H2 headings and add `id` anchors to each.
 * Inserts the TOC nav at the top of the article, before the first H2.
 */
export function injectTableOfContents(html: string): string {
  const h2Regex = /<h2([^>]*)>(.*?)<\/h2>/gi;
  const headings: { id: string; text: string }[] = [];
  let index = 0;

  // First pass - collect headings and add IDs
  const processed = html.replace(h2Regex, (_match, attrs: string, content: string) => {
    const plainText = content.replace(/<[^>]+>/g, '').trim();
    const id = `section-${index++}`;
    headings.push({ id, text: plainText });
    // Preserve existing attributes, add id
    if (attrs.includes('id=')) {
      return `<h2${attrs}>${content}</h2>`;
    }
    return `<h2 id="${id}"${attrs}>${content}</h2>`;
  });

  if (headings.length < 3) {
    // Don't add TOC for very short articles
    return processed;
  }

  const tocHtml = `<nav class="blog-toc" aria-label="Table of Contents">
<p class="blog-toc-title"><strong>In This Article</strong></p>
<ol>
${headings.map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join('\n')}
</ol>
</nav>

`;

  // Insert TOC before the first H2
  const firstH2Index = processed.search(/<h2[\s>]/i);
  if (firstH2Index === -1) return processed;

  return processed.slice(0, firstH2Index) + tocHtml + processed.slice(firstH2Index);
}

// ---------------------------------------------------------------------------
// Section Image Injection
// ---------------------------------------------------------------------------

/**
 * Insert section images after the first paragraph following every Nth H2.
 * Images are wrapped in <figure> with a <figcaption>.
 */
export function injectSectionImages(
  html: string,
  images: BlogImageResult[],
  interval: number = 2,
): string {
  if (images.length === 0) return html;

  // Find positions of H2 headings
  const h2Positions: number[] = [];
  const h2Regex = /<h2[\s>]/gi;
  let match;
  while ((match = h2Regex.exec(html)) !== null) {
    h2Positions.push(match.index);
  }

  // Select H2 sections to add images to (every Nth, starting from 2nd H2)
  const targetPositions = h2Positions.filter((_, i) => i > 0 && i % interval === 0);

  let imageIndex = 0;
  let offset = 0;

  for (const h2Pos of targetPositions) {
    if (imageIndex >= images.length) break;

    const image = images[imageIndex]!;
    const adjustedPos = h2Pos + offset;

    // Find the end of the first <p>...</p> after this H2
    const remaining = html.slice(adjustedPos);
    const firstPEnd = remaining.search(/<\/p>/i);

    if (firstPEnd === -1) continue;

    const insertAt = adjustedPos + firstPEnd + 4; // after </p>

    const captionParts = [escapeHtml(image.altText)];
    if (image.attribution) {
      captionParts.push(`<span class="blog-image-attribution">${image.attribution}</span>`);
    }

    const figureHtml = `\n<figure class="blog-section-image">
<img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.altText)}" width="${image.width}" height="${image.height}" loading="lazy" />
<figcaption>${captionParts.join(' | ')}</figcaption>
</figure>\n`;

    html = html.slice(0, insertAt) + figureHtml + html.slice(insertAt);
    offset += figureHtml.length;
    imageIndex++;
  }

  return html;
}

// ---------------------------------------------------------------------------
// CTA Block
// ---------------------------------------------------------------------------

/**
 * Insert three CTA blocks throughout the article for maximum engagement:
 * 1. Top - after TOC, warm and inviting
 * 2. Middle - at the center H2, social-proof focused
 * 3. Bottom - before FAQ/Key Takeaways, strong closing
 */
export function injectCta(html: string, causeCategory: string): string {
  const categoryLabel = causeCategory.replace(/-/g, ' ');

  const topCta = `\n<aside class="blog-cta" role="complementary" aria-label="Start your campaign">
<p class="blog-cta-heading"><strong>Need Help With a ${capitalize(categoryLabel)} Cause?</strong></p>
<p>LastDonor.org charges 0% platform fees, and nothing is deducted from a donation to process it.</p>
<p><a href="/share-your-story" class="blog-cta-button">Start a Campaign</a></p>
</aside>\n`;

  const midCta = `\n<aside class="blog-cta" role="complementary" aria-label="Find reviewed campaigns">
<p class="blog-cta-heading"><strong>Find Reviewed Campaigns That Need Support</strong></p>
<p>Browse LastDonor.org campaigns with visible progress, reviewed details, and 0% platform fees from LastDonor.</p>
<p><a href="/how-it-works" class="blog-cta-button">See How It Works</a></p>
</aside>\n`;

  const bottomCta = `\n<aside class="blog-cta" role="complementary" aria-label="Start your campaign">
<p class="blog-cta-heading"><strong>Ready to Make a Difference?</strong></p>
<p>Whether you're raising funds for a ${categoryLabel} cause or supporting someone in need, LastDonor.org makes it simple. LastDonor charges 0% platform fees, and standard Stripe processing fees apply.</p>
<p><a href="/share-your-story" class="blog-cta-button">Start a Campaign</a> or <a href="/how-it-works">learn how it works</a>.</p>
</aside>`;

  let result = html;

  // Find all H2 positions
  const h2Positions: number[] = [];
  const h2Regex = /<h2[\s>]/gi;
  let match;
  while ((match = h2Regex.exec(result)) !== null) {
    h2Positions.push(match.index);
  }

  // --- Bottom CTA: before Key Takeaways, FAQ, or at end ---
  const takeawaysIdx = result.indexOf('<section class="key-takeaways"');
  const faqIdx = result.indexOf('<section class="faq-section"');
  if (takeawaysIdx !== -1) {
    result = result.slice(0, takeawaysIdx) + bottomCta + '\n\n' + result.slice(takeawaysIdx);
  } else if (faqIdx !== -1) {
    result = result.slice(0, faqIdx) + bottomCta + '\n\n' + result.slice(faqIdx);
  } else {
    result += bottomCta;
  }

  // --- Middle CTA: after the middle H2 section's first paragraph ---
  if (h2Positions.length >= 3) {
    const midH2Idx = Math.floor(h2Positions.length / 2);
    const midPos = h2Positions[midH2Idx]!;
    // Find end of first <p> after this H2
    const afterMid = result.slice(midPos);
    const pEnd = afterMid.search(/<\/p>/i);
    if (pEnd !== -1) {
      const insertAt = midPos + pEnd + 4;
      result = result.slice(0, insertAt) + midCta + result.slice(insertAt);
    }
  }

  // --- Top CTA: after the TOC (</nav>) or before the first H2 ---
  const tocEnd = result.indexOf('</nav>');
  if (tocEnd !== -1) {
    const insertAt = tocEnd + 6;
    result = result.slice(0, insertAt) + topCta + result.slice(insertAt);
  } else if (h2Positions.length > 0) {
    result = result.slice(0, h2Positions[0]) + topCta + result.slice(h2Positions[0]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// HTML Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize spacing and structure of blog HTML.
 * - Wrap orphaned text blocks in <p> tags
 * - Ensure blank lines between block elements
 * - Remove excessive whitespace
 */
export function normalizeHtmlSpacing(html: string): string {
  let result = html;

  // Wrap orphaned text (text between block elements not inside any tag) in <p>
  // Match text that follows a closing block tag and precedes an opening block tag
  result = result.replace(
    /(<\/(?:p|h[1-6]|ul|ol|blockquote|section|figure|nav|div|aside)>)\s*\n+([A-Za-z][^\n<]{20,})\s*\n/gi,
    '$1\n\n<p>$2</p>\n',
  );

  // Collapse multiple blank lines to exactly two newlines
  result = result.replace(/\n{3,}/g, '\n\n');

  // Ensure blank line after closing block elements
  result = result.replace(
    /(<\/(?:p|h[1-6]|ul|ol|blockquote|section|figure|nav|div|aside)>)\s*(?=<(?:p|h[1-6]|ul|ol|blockquote|section|figure|nav|div|aside)[\s>])/gi,
    '$1\n\n',
  );

  // Ensure blank line after </li> sequences (end of a list)
  result = result.replace(
    /(<\/(?:ul|ol)>)\s*(?=<(?:p|h[1-6])[\s>])/gi,
    '$1\n\n',
  );

  // Ensure blank line before H2/H3 headings for visual breathing room
  result = result.replace(
    /(?<!\n\n)(<h[23][^>]*>)/gi,
    '\n\n$1',
  );

  // Trim leading/trailing whitespace
  result = result.trim();

  return result;
}

// ---------------------------------------------------------------------------
// Readability Score (Flesch Reading Ease)
// ---------------------------------------------------------------------------

/**
 * Calculate Flesch Reading Ease score from HTML.
 * Returns a score 0-100 where higher = easier to read.
 * Target: 60-70 (8th–9th grade level) for general audience blog content.
 */
export function calculateReadabilityScore(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return 0;

  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount === 0) return 0;

  // Count sentences (., !, ?)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(sentences.length, 1);

  // Approximate syllable count
  let syllableCount = 0;
  for (const word of words) {
    syllableCount += countSyllables(word);
  }

  const avgSentenceLen = wordCount / sentenceCount;
  const avgSyllables = syllableCount / wordCount;

  const score = 206.835 - 1.015 * avgSentenceLen - 84.6 * avgSyllables;
  return Math.round(Math.max(0, Math.min(100, score)));
}

function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length <= 2) return 1;

  // Count vowel groups
  const vowelGroups = clean.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;

  // Subtract silent e
  if (clean.endsWith('e') && count > 1) count--;

  // Handle -le at end
  if (clean.endsWith('le') && clean.length > 2 && !/[aeiouy]/.test(clean[clean.length - 3]!)) {
    count++;
  }

  return Math.max(1, count);
}

// ---------------------------------------------------------------------------
// Reading Time
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Duplicate Key Takeaways Removal
// ---------------------------------------------------------------------------

/**
 * If the AI generated a "Key Takeaways" section in the body that overlaps
 * with the assembler-generated one, remove the AI's version.
 * The assembler always appends its own key-takeaways section at the end.
 */
export function deduplicateKeyTakeaways(html: string): string {
  // Count <h2> headings containing "Key Takeaway"
  const takeawayH2s = html.match(/<h2[^>]*>[^<]*Key Takeaway[^<]*<\/h2>/gi);
  if (!takeawayH2s || takeawayH2s.length <= 1) return html;

  // Remove the first occurrence (AI-generated one in the body);
  // keep the last one (the assembler-generated section)
  const firstIdx = html.search(/<h2[^>]*>[^<]*Key Takeaway[^<]*<\/h2>/i);
  if (firstIdx === -1) return html;

  // Find the next H2 or section after this Key Takeaways
  const afterFirst = html.slice(firstIdx);
  const nextH2 = afterFirst.slice(4).search(/<h2[\s>]/i);
  const nextSection = afterFirst.slice(4).search(/<section[\s>]/i);

  let endIdx: number;
  if (nextH2 !== -1 && nextSection !== -1) {
    endIdx = firstIdx + 4 + Math.min(nextH2, nextSection);
  } else if (nextH2 !== -1) {
    endIdx = firstIdx + 4 + nextH2;
  } else if (nextSection !== -1) {
    endIdx = firstIdx + 4 + nextSection;
  } else {
    // Can't determine boundary - leave as-is
    return html;
  }

  return html.slice(0, firstIdx) + html.slice(endIdx);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function capitalize(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}
