/**
 * The timezone admin figures are reported in (docs/88 F15).
 *
 * Every admin date boundary used to be built with
 * `new Date(y, m, d)`, which is the SERVER's local zone. No `TZ` is set
 * on Fly, so that is UTC, and the figures were labelled plainly "Today"
 * and "This month" with nothing naming the zone.
 *
 * For an operator in Nairobi (UTC+3) "today" rolled over at 03:00 local.
 * For one in New York (UTC-4/5) it rolled at 19:00 or 20:00 the previous
 * evening, so donations taken on a US evening landed in tomorrow's
 * figure. The number was never wrong for UTC; it was wrong for whoever
 * was reading it, and nothing on the screen said so.
 *
 * ── Why one configured zone, not the viewer's ────────────────────────
 *
 * The viewer's zone is not knowable server-side without the client
 * telling us, and these figures are rendered on the server. More
 * importantly, a business reports in ONE zone: if two admins in
 * different countries read "revenue this month" they must see the same
 * number, or the figure cannot be quoted to anyone. So the zone is a
 * deployment decision, parked at one constant, exactly as
 * `SMS_DEFAULT_REGION` is in docs/82.
 *
 * Default UTC, which preserves today's behaviour exactly. Set
 * `REPORTING_TIMEZONE` to an IANA name to change it.
 */

/** IANA zone used for every admin period boundary. */
export const REPORTING_TIMEZONE = process.env.REPORTING_TIMEZONE?.trim() || 'UTC';

/**
 * How far `zone` is ahead of UTC at `instant`, in milliseconds.
 *
 * Derived from `Intl`, so the zone database ships with the runtime and
 * no dependency is added for it.
 */
function offsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const n: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') n[p.type] = Number(p.value);

  // `hour` comes back as 24 at midnight under hour12:false in some runtimes.
  const asIfUtc = Date.UTC(n.year, n.month - 1, n.day, n.hour % 24, n.minute, n.second);
  return asIfUtc - instant.getTime();
}

/** The calendar date in `zone` at `instant`, as [year, month, day]. */
function dateIn(instant: Date, zone: string): [number, number, number] {
  // en-CA formats as YYYY-MM-DD, which needs no parsing by locale.
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(instant)
    .split('-')
    .map(Number);
  return [y, m, d];
}

/**
 * Convert a wall-clock time in `zone` to the UTC instant it names.
 *
 * Two passes: guess that the wall clock is UTC, measure the zone's
 * offset near that guess, then correct. One correction is enough except
 * within the hour a DST transition moves, where the result can be off by
 * that hour. That is accepted: these are reporting boundaries, not
 * billing, and a once-a-year hour at 00:00 local does not change a
 * monthly total.
 */
function instantForWallClock(
  zone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  return new Date(guess - offsetMs(new Date(guess), zone));
}

/** Midnight at the start of `now`'s day, in {@link REPORTING_TIMEZONE}. */
export function startOfReportingDay(now: Date = new Date(), zone = REPORTING_TIMEZONE): Date {
  const [y, m, d] = dateIn(now, zone);
  return instantForWallClock(zone, y, m, d);
}

/** Midnight on the 1st of `now`'s month, in {@link REPORTING_TIMEZONE}. */
export function startOfReportingMonth(now: Date = new Date(), zone = REPORTING_TIMEZONE): Date {
  const [y, m] = dateIn(now, zone);
  return instantForWallClock(zone, y, m, 1);
}

/** Midnight on 1 January of `now`'s year, in {@link REPORTING_TIMEZONE}. */
export function startOfReportingYear(now: Date = new Date(), zone = REPORTING_TIMEZONE): Date {
  const [y] = dateIn(now, zone);
  return instantForWallClock(zone, y, 1, 1);
}

/**
 * Midnight on the 1st of the month `monthsBack` before `now`'s month.
 * `monthsBack = 11` gives a twelve-month window including this one.
 */
export function startOfReportingMonthsAgo(
  monthsBack: number,
  now: Date = new Date(),
  zone = REPORTING_TIMEZONE,
): Date {
  const [y, m] = dateIn(now, zone);
  const shifted = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return instantForWallClock(zone, shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1);
}

/**
 * What to show beside a period figure so the reader knows which day
 * "today" means. Returns the zone name, e.g. `UTC` or `Africa/Nairobi`.
 */
export function reportingTimezoneLabel(zone = REPORTING_TIMEZONE): string {
  return zone;
}
