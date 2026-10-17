/**
 * Admin period boundaries (docs/88 F15).
 *
 * The defect: every boundary was `new Date(y, m, d)` - the server's
 * zone, which on Fly is UTC - while the label said plainly "Today". A
 * Nairobi admin's day rolled at 03:00 local, a New York admin's at 19:00
 * the previous evening.
 *
 * The expected instants below are stated as explicit UTC strings rather
 * than recomputed with the same helper under test, so the test fails if
 * the helper's arithmetic drifts.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  startOfReportingDay,
  startOfReportingMonth,
  startOfReportingYear,
  startOfReportingMonthsAgo,
  REPORTING_TIMEZONE,
} from './reporting-timezone';

/** 2026-10-17 01:30 UTC. In Nairobi that is already 04:30 the same day. */
const EARLY_UTC = new Date('2026-10-17T01:30:00Z');
/** 2026-10-17 23:30 UTC. In New York that is still 19:30 on the 17th. */
const LATE_UTC = new Date('2026-10-17T23:30:00Z');

afterEach(() => vi.unstubAllEnvs());

describe('the default preserves existing behaviour', () => {
  it('is UTC unless configured', () => {
    expect(REPORTING_TIMEZONE).toBe('UTC');
  });

  it('starts the day at midnight UTC', () => {
    expect(startOfReportingDay(EARLY_UTC).toISOString()).toBe('2026-10-17T00:00:00.000Z');
  });
});

/*
  The whole point: the same instant belongs to a different day depending
  on the zone the business reports in.
*/
describe('a configured zone moves the boundary', () => {
  it('Africa/Nairobi (UTC+3) starts the day 3 hours before midnight UTC', () => {
    expect(startOfReportingDay(EARLY_UTC, 'Africa/Nairobi').toISOString()).toBe(
      '2026-10-16T21:00:00.000Z',
    );
  });

  it('America/New_York keeps a late-UTC evening in the same local day', () => {
    // 23:30Z on the 17th is 19:30 on the 17th in New York, so the day
    // started at 04:00Z on the 17th (EDT, UTC-4).
    expect(startOfReportingDay(LATE_UTC, 'America/New_York').toISOString()).toBe(
      '2026-10-17T04:00:00.000Z',
    );
  });

  /*
    The failure the old code produced: an instant that is "today" in UTC
    but yesterday where the operator is sitting, or vice versa.
  */
  it('puts a US evening donation in a different day from UTC', () => {
    const utcDay = startOfReportingDay(LATE_UTC, 'UTC');
    const nyDay = startOfReportingDay(LATE_UTC, 'America/New_York');
    expect(utcDay.toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(nyDay.getTime()).toBeGreaterThan(utcDay.getTime());
  });
});

describe('month, year and the twelve-month window', () => {
  it('starts the month at local midnight on the 1st', () => {
    expect(startOfReportingMonth(EARLY_UTC).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(startOfReportingMonth(EARLY_UTC, 'Africa/Nairobi').toISOString()).toBe(
      '2026-09-30T21:00:00.000Z',
    );
  });

  it('starts the year at local midnight on 1 January', () => {
    expect(startOfReportingYear(EARLY_UTC).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('counts eleven months back for a twelve-month window', () => {
    expect(startOfReportingMonthsAgo(11, EARLY_UTC).toISOString()).toBe(
      '2025-11-01T00:00:00.000Z',
    );
  });

  it('crosses a year boundary correctly', () => {
    const jan = new Date('2026-01-05T12:00:00Z');
    expect(startOfReportingMonthsAgo(1, jan).toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });
});

/*
  A boundary must be an instant at or before `now`, never after it -
  getting the offset sign backwards would silently produce a window that
  excludes today's rows.
*/
describe('a boundary never lands in the future', () => {
  it.each(['UTC', 'Africa/Nairobi', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland'])(
    'holds for %s',
    (zone) => {
      for (const now of [EARLY_UTC, LATE_UTC, new Date('2026-07-04T12:00:00Z')]) {
        expect(startOfReportingDay(now, zone).getTime()).toBeLessThanOrEqual(now.getTime());
        expect(startOfReportingMonth(now, zone).getTime()).toBeLessThanOrEqual(now.getTime());
      }
    },
  );

  it('is never more than 26 hours before now, for a day boundary', () => {
    for (const zone of ['UTC', 'Pacific/Auckland', 'Pacific/Midway']) {
      const delta = LATE_UTC.getTime() - startOfReportingDay(LATE_UTC, zone).getTime();
      expect(delta).toBeLessThan(26 * 60 * 60 * 1000);
    }
  });
});
