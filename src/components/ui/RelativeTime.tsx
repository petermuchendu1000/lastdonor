'use client';

import { useEffect, useState } from 'react';

import { formatDate, formatRelativeTime } from '@/lib/utils/dates';

/**
 * A timestamp that reads as "5m ago" without breaking hydration.
 *
 * ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────
 *
 * [VERIFIED 2026-10-25] `/campaigns/[slug]` threw **React error #418** (text
 * content mismatch) on every load at 390px in a production build, and in no
 * other configuration:
 *
 *   production build, 390px   #418
 *   production build, 1440px  clean
 *   `next dev`, 390px         clean, no warning at all
 *
 * The cause is `formatRelativeTime`, which reads `Date.now()` at render time,
 * rendered inside a page that is **ISR with `revalidate = 60`**. The HTML is
 * produced at one instant and hydrated at another, so the server says
 * "just now" and the client says "5m ago" for the same donation. Dev has no
 * ISR cache, which is why the error is invisible exactly where a developer
 * would look for it. The same page at desktop width did not show it because
 * the donor feed only renders in the mobile column.
 *
 * ── WHY NOT `suppressHydrationWarning` ──────────────────────────────────────
 *
 * That is React's documented escape hatch for timestamps and it would silence
 * the error. It would also leave a cached page stating a relative time
 * measured from when the CACHE ENTRY was built - "just now" on an appeal
 * nobody has donated to for an hour - until hydration corrects it. The
 * figure, not the warning, is the problem.
 *
 * So the server renders the ABSOLUTE date, which is true whenever the cache
 * entry is served, and the relative form appears after mount. The first
 * client render matches the server exactly, so there is no mismatch to
 * suppress and nothing is hidden.
 *
 * ⚠️ Use this anywhere a relative time is rendered on a page that is static
 * or ISR. On a `force-dynamic` page the two renders are moments apart and the
 * mismatch is unlikely rather than certain - the admin screens are left as
 * they are for that reason, and because `src/app/admin/layout.tsx` makes the
 * whole subtree dynamic.
 */

interface RelativeTimeProps {
  /** The instant, as a Date or an ISO string. */
  date: Date | string;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  /*
    Validity is settled ONCE, before anything formats it.

    ⚠️ Found by this component's own test: `formatDate` goes through
    `Intl.DateTimeFormat.format`, which throws `RangeError: Invalid time
    value` on an unparseable input - so the first version, which wrapped only
    `toISOString()` in a try, still took the page down. A server component
    that throws takes the whole campaign page with it, which is the same
    hazard `PendingVerificationBadge` records about `getCurrency` (docs/92).
  */
  const parsed = new Date(date);
  const valid = !Number.isNaN(parsed.getTime());
  const absolute = valid ? formatDate(parsed) : '';

  /*
    `null` until mounted, and the fallback below is the same string the server
    rendered. That is what makes the first client render byte-identical to the
    server's - the effect runs after hydration has already committed.
  */
  const [relative, setRelative] = useState<string | null>(null);
  useEffect(() => {
    if (!valid) return;
    setRelative(formatRelativeTime(parsed));
    // `date` rather than `parsed`: a new Date object every render would make
    // this effect run on every render.
  }, [date, valid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!valid) return null;

  return (
    <time dateTime={parsed.toISOString()} title={absolute} className={className}>
      {relative ?? absolute}
    </time>
  );
}
