import { describe, it, expect } from 'vitest';
import {
  validateStory,
  cleanStoryHtml,
} from '@/lib/ai/prompts/story-validation';
import type { StoryPattern } from '@/lib/ai/prompts/story-structures';

// â”€â”€ Helper: build valid story HTML for a given pattern â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildValidStory(
  pattern: StoryPattern,
  wordCountApprox: number = 150,
): string {
  const sectionIdsByPattern: Record<StoryPattern, string[]> = {
    'chronological': ['before', 'the-event', 'aftermath', 'whats-needed', 'looking-ahead'],
    'character-first': ['who-they-are', 'their-world', 'what-changed', 'the-need', 'your-part'],
    'in-medias-res': ['the-moment', 'step-back', 'the-toll', 'the-road-ahead', 'stand-with'],
    'community-voice': ['the-community', 'what-hit', 'one-story', 'rallying', 'join-them'],
    'quiet-dignity': ['the-facts', 'who-they-are', 'what-they-face', 'a-simple-ask'],
    'impact-forward': ['the-vision', 'the-backstory', 'the-gap-between', 'making-it-real', 'be-part'],
  };

  const sectionIds = sectionIdsByPattern[pattern];
  const wordsPerSection = Math.ceil(wordCountApprox / sectionIds.length);

  // Generate filler words (unique enough to avoid issues)
  const makeWords = (count: number, idx: number) => {
    const words = [];
    for (let i = 0; i < count; i++) {
      words.push(`word${idx}x${i}`);
    }
    return words.join(' ');
  };

  const sections = sectionIds.map((id, idx) => {
    const content = idx === 1
      ? `<p>As reported by <a href="https://example.com/article" target="_blank" rel="noopener noreferrer">Local News</a>. ${makeWords(wordsPerSection - 10, idx)}</p>`
      : `<p><strong>John Doe</strong> ${makeWords(wordsPerSection - 3, idx)}</p>`;
    return `<section data-section="${id}">\n  ${content}\n</section>`;
  });

  return sections.join('\n\n');
}

// â”€â”€ cleanStoryHtml â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('cleanStoryHtml', () => {
  it('strips code fences', () => {
    const input = '```html\n<section data-section="test"><p>hello</p></section>\n```';
    expect(cleanStoryHtml(input)).toBe('<section data-section="test"><p>hello</p></section>');
  });

  it('strips text before first <section>', () => {
    const input = 'Here is the story:\n\n<section data-section="test"><p>hello</p></section>';
    expect(cleanStoryHtml(input)).toBe('<section data-section="test"><p>hello</p></section>');
  });

  it('strips text after last </section>', () => {
    const input = '<section data-section="test"><p>hello</p></section>\n\nI hope this helps!';
    expect(cleanStoryHtml(input)).toBe('<section data-section="test"><p>hello</p></section>');
  });

  it('handles clean input unchanged', () => {
    const input = '<section data-section="a"><p>content</p></section>';
    expect(cleanStoryHtml(input)).toBe(input);
  });

  it('handles multiple sections', () => {
    const input = '<section data-section="a"><p>first</p></section>\n<section data-section="b"><p>second</p></section>';
    expect(cleanStoryHtml(input)).toBe(input);
  });
});

// â”€â”€ validateStory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('validateStory', () => {
  const defaultWordRange = { min: 100, max: 250 };

  it('accepts a valid well-formed story', () => {
    // Build comfortably above MIN_ABSOLUTE_WORDS (150): the helper's filler
    // accounting means a requested 150 lands at ~141 actual words.
    const html = buildValidStory('chronological', 200);
    const result = validateStory(html, 'chronological', defaultWordRange);
    expect(result.wordCount).toBeGreaterThanOrEqual(150);
    expect(result.issues).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('accepts all patterns with correct sections', () => {
    const patterns: StoryPattern[] = [
      'chronological', 'character-first', 'in-medias-res',
      'community-voice', 'quiet-dignity', 'impact-forward',
    ];

    for (const pattern of patterns) {
      const html = buildValidStory(pattern, 150);
      const result = validateStory(html, pattern, defaultWordRange);
      expect(result.valid).toBe(true);
    }
  });

  it('reports missing sections', () => {
    // chronological expects: before, the-event, aftermath, whats-needed, looking-ahead
    const html = `
      <section data-section="before"><p>Before content here is some text</p></section>
      <section data-section="the-event"><p>As reported by <a href="https://example.com">News</a> event content</p></section>
    `;
    const result = validateStory(html, 'chronological', { min: 10, max: 500 });
    expect(result.valid).toBe(false);
    const missingSections = result.issues.filter((i) => i.type === 'missing_section');
    expect(missingSections.length).toBe(3); // aftermath, whats-needed, looking-ahead
  });

  it('reports empty sections', () => {
    const html = buildValidStory('chronological', 150)
      .replace(/<section data-section="before">[\s\S]*?<\/section>/, '<section data-section="before"></section>');
    const result = validateStory(html, 'chronological', defaultWordRange);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === 'empty_section')).toBe(true);
  });

  it('detects markdown link leak', () => {
    const html = buildValidStory('chronological', 150)
      .replace(
        '<a href="https://example.com/article" target="_blank" rel="noopener noreferrer">Local News</a>',
        '[Local News](https://example.com/article)',
      );
    const result = validateStory(html, 'chronological', defaultWordRange);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === 'markdown_leak')).toBe(true);
  });

  it('detects markdown bold leak', () => {
    const html = buildValidStory('character-first', 150)
      .replace('<strong>John Doe</strong>', '**John Doe**');
    const result = validateStory(html, 'character-first', defaultWordRange);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === 'markdown_leak')).toBe(true);
  });

  it('reports missing source link', () => {
    // Build story without any <a> tags
    const sections = ['before', 'the-event', 'aftermath', 'whats-needed', 'looking-ahead']
      .map((id, i) => `<section data-section="${id}"><p>${'word '.repeat(25)} section${i}</p></section>`)
      .join('\n');
    const result = validateStory(sections, 'chronological', { min: 50, max: 300 });
    expect(result.issues.some((i) => i.type === 'missing_source_link')).toBe(true);
  });

  it('reports word count too low', () => {
    const html = buildValidStory('chronological', 20); // ~20 words total
    const result = validateStory(html, 'chronological', { min: 100, max: 200 });
    expect(result.issues.some((i) => i.type === 'word_count_low')).toBe(true);
  });

  it('reports word count too high', () => {
    const html = buildValidStory('chronological', 500); // ~500 words
    const result = validateStory(html, 'chronological', { min: 75, max: 120 });
    expect(result.issues.some((i) => i.type === 'word_count_high')).toBe(true);
  });

  it('allows tolerance band on word count (90% min, 120% max)', () => {
    // Target 300-400 words, so effectiveMin = max(MIN_ABSOLUTE_WORDS, 300*0.9)
    // = 270. A ~284-word story is under the target min but inside the band.
    const sections = ['before', 'the-event', 'aftermath', 'whats-needed', 'looking-ahead'];
    const sectionHtml = sections.map((id, idx) => {
      const words = Array.from({ length: 56 }, (_, i) => `word${idx}w${i}`).join(' ');
      const content = idx === 1
        ? `<p>As reported by <a href="https://example.com">News</a> ${words}</p>`
        : `<p>${words}</p>`;
      return `<section data-section="${id}">${content}</section>`;
    }).join('\n');

    const result = validateStory(sectionHtml, 'chronological', { min: 300, max: 400 });
    expect(result.wordCount).toBeGreaterThanOrEqual(270);
    expect(result.wordCount).toBeLessThan(300);
    expect(result.issues.filter((i) => i.type === 'word_count_low')).toHaveLength(0);
  });

  it('counts words correctly (strips HTML tags)', () => {
    const html = '<section data-section="the-facts"><p><strong>John</strong> <em>Doe</em> hello world</p></section>';
    const result = validateStory(html, 'quiet-dignity', { min: 1, max: 500 });
    expect(result.wordCount).toBe(4); // John Doe hello world
  });

  it('missing_source_link is a soft fail (story still valid)', () => {
    // Build story with all sections but no <a> tag
    const sections = ['before', 'the-event', 'aftermath', 'whats-needed', 'looking-ahead']
      .map((id, i) => `<section data-section="${id}"><p>${'word '.repeat(30)} section${i}</p></section>`)
      .join('\n');
    const result = validateStory(sections, 'chronological', { min: 50, max: 300 });
    // missing_source_link is not a hard fail
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.type === 'missing_source_link')).toBe(true);
  });
});
