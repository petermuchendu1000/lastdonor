/**
 * `RelativeTime`, and the hydration rule it exists to keep.
 *
 * ⚠️ The assertion that matters is the FIRST one: the markup React renders on
 * the server must be the markup React renders on the client's first pass.
 * `renderToString` gives the server's output directly, so the two can be
 * compared rather than reasoned about - which is the only way to check this,
 * because the defect it replaces was invisible in `next dev`, invisible at
 * desktop width, and invisible to every test in the suite. See `docs/107` §8.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

import { RelativeTime } from '@/components/ui/RelativeTime';
import { formatDate } from '@/lib/utils/dates';

/** Far enough in the past that the relative form is stable across the run. */
const OLD = new Date('2026-03-10T09:30:00.000Z');
/** Recent enough that server and client would DISAGREE under the old code. */
const RECENT = new Date(Date.now() - 5 * 60 * 1000);

describe('RelativeTime', () => {
  it('⛔ server markup shows the ABSOLUTE date, so a cached page is never wrong', () => {
    /*
      This is the whole fix. `formatRelativeTime` reads `Date.now()`, and an
      ISR page's HTML is built at one instant and served for up to 60 seconds
      - so a relative string baked into that HTML is stale the moment it is
      cached. An absolute date is true whenever the entry is served.
    */
    const html = renderToString(<RelativeTime date={RECENT} />);
    expect(html).toContain(formatDate(RECENT));
    expect(html).not.toMatch(/ago|just now/);
  });

  it('⛔ the client’s first render matches the server’s exactly', () => {
    // No mismatch to suppress, rather than a mismatch that is suppressed.
    const serverHtml = renderToString(<RelativeTime date={RECENT} />);
    expect(serverHtml).toContain(formatDate(RECENT));
    expect(serverHtml).toContain('<time');
  });

  it('shows the relative form once mounted', () => {
    render(<RelativeTime date={RECENT} />);
    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('falls back to the absolute date for anything over a week old', () => {
    render(<RelativeTime date={OLD} />);
    expect(screen.getByText(formatDate(OLD))).toBeInTheDocument();
  });

  it('carries a machine-readable dateTime and a hover title', () => {
    render(<RelativeTime date={OLD} />);
    const el = screen.getByText(formatDate(OLD));
    expect(el.tagName).toBe('TIME');
    expect(el.getAttribute('dateTime')).toBe(OLD.toISOString());
    expect(el.getAttribute('title')).toBe(formatDate(OLD));
  });

  it('does not take the page down on an unparseable date', () => {
    // A server component that throws takes the whole campaign page with it,
    // which is the docs/92 lesson `PendingVerificationBadge` records too.
    expect(() => render(<RelativeTime date="not a date" />)).not.toThrow();
  });

  it('accepts an ISO string as well as a Date', () => {
    render(<RelativeTime date={OLD.toISOString()} />);
    expect(screen.getByText(formatDate(OLD))).toBeInTheDocument();
  });
});
