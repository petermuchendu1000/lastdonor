/**
 * The email shell.
 *
 * Covers the two things that are easy to break invisibly: the inbox preview
 * line, which nobody sees while developing because it is hidden in the
 * markup, and the Outlook button, which renders as plain text the moment the
 * VML goes missing.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  derivePreheader,
  emailButton,
  renderEmail,
  escapeHtml,
} from './email-shell';

describe('derivePreheader', () => {
  it('skips the heading, which the reader can already see', () => {
    const out = derivePreheader('<h2>You Just Made a Real Difference</h2><p>Hi Ada,</p><p>Your gift reached the Thompsons today.</p>');
    expect(out).not.toContain('Real Difference');
    expect(out).toContain('Your gift reached the Thompsons');
  });

  it('skips the greeting, because the reader knows their own name', () => {
    expect(derivePreheader('<p>Hi Ada,</p><p>The roof is on.</p>')).toBe('The roof is on.');
  });

  it('handles a greeting with no name', () => {
    expect(derivePreheader('<p>Hello,</p><p>Your refund is on its way.</p>')).toBe('Your refund is on its way.');
  });

  it('truncates on a word boundary rather than mid-word', () => {
    const long = `<p>${'alpha bravo '.repeat(30)}</p>`;
    const out = derivePreheader(long);
    expect(out.length).toBeLessThanOrEqual(114);
    expect(out.endsWith('...')).toBe(true);
    expect(out).not.toMatch(/alph\.\.\.$/);
  });

  it('decodes the entities the templates actually emit', () => {
    expect(derivePreheader('<p>Tom &amp; Ada&#39;s fund</p>')).toBe("Tom & Ada's fund");
  });

  it('returns something usable for a body that is only a heading', () => {
    expect(derivePreheader('<h1>Refund issued</h1>')).toBe('');
  });
});

describe('emailButton survives Outlook', () => {
  const html = emailButton('https://lastdonor.org/x', 'Share This Campaign');

  it('ships a VML fallback, which is the only thing Word renders', () => {
    expect(html).toContain('v:roundrect');
    expect(html).toContain('<!--[if mso]>');
  });

  it('hides the HTML button from Word so it is not drawn twice', () => {
    expect(html).toContain('<!--[if !mso]><!-- -->');
  });

  it('carries the href in both branches', () => {
    const hrefs = html.match(/https:\/\/lastdonor\.org\/x/g) ?? [];
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts a brand hex directly, as email-adaptive passes one', () => {
    expect(emailButton('https://x.test', 'Go', '#0F766E')).toContain('#0F766E');
  });
});

describe('renderEmail document', () => {
  const html = renderEmail({ body: '<p>Hi Ada,</p><p>The roof is on.</p>' });

  it('is a real document, not a bare div', () => {
    expect(html).toMatch(/^<!DOCTYPE html/);
    expect(html).toContain('<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"');
    expect(html).toContain('name="viewport"');
  });

  it('declares dark mode support', () => {
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('lays out in tables, because Word has no flex or grid', () => {
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });

  it('uses no SVG, which Gmail strips', () => {
    expect(html.toLowerCase()).not.toContain('<svg');
  });

  it('uses no web font, which Gmail also strips', () => {
    expect(html).not.toContain('@font-face');
  });

  it('emits the hidden preview line', () => {
    expect(html).toContain('The roof is on.');
    expect(html).toContain('mso-hide:all');
  });

  it('respects reduced motion', () => {
    expect(html).toContain('prefers-reduced-motion');
  });

  it('omits the postal address when none is configured', () => {
    const before = process.env.MAILING_POSTAL_ADDRESS;
    delete process.env.MAILING_POSTAL_ADDRESS;
    const out = renderEmail({ body: '<p>x</p>', commercial: true });
    expect(out).not.toContain('Main St');
    if (before) process.env.MAILING_POSTAL_ADDRESS = before;
  });

  it('includes the postal address for commercial mail when it is set', () => {
    process.env.MAILING_POSTAL_ADDRESS = '9 Example Way, Nairobi';
    expect(renderEmail({ body: '<p>x</p>', commercial: true })).toContain('9 Example Way, Nairobi');
    // Transactional mail does not carry it.
    expect(renderEmail({ body: '<p>x</p>' })).not.toContain('9 Example Way, Nairobi');
    delete process.env.MAILING_POSTAL_ADDRESS;
  });
});

describe('escaping', () => {
  it('neutralises injected markup', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
