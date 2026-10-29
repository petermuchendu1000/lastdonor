import { describe, expect, it } from 'vitest';
import { paginationModel, parsePageParam, type PaginationItem } from './pagination';

/**
 * Offset pagination arithmetic.
 *
 * ## The defect this encodes (docs/145)
 *
 * `/campaigns` applied no offset at all, so `?page=1`, `?page=2` and
 * `?page=99` returned the same twelve rows - [VERIFIED live against
 * production, with `sort=newest` vs `sort=most_funded` differing by 4 slugs as
 * the control proving the probe could detect a change].
 *
 * These are properties of the arithmetic, not a snapshot of today's 14
 * campaigns, so they stay true as the platform grows.
 */

const SIZE = 12;
const model = (total: number, requestedPage: number) =>
  paginationModel({ total, pageSize: SIZE, requestedPage });

const pageNumbers = (items: PaginationItem[]) =>
  items.filter((i): i is Extract<PaginationItem, { kind: 'page' }> => i.kind === 'page').map((i) => i.page);

describe('rule 1: the reported symptom - a page maps to a distinct slice', () => {
  it('page 1 starts at 0 and page 2 starts at a full page in', () => {
    expect(model(14, 1).offset).toBe(0);
    expect(model(14, 2).offset).toBe(SIZE);
  });

  it('every page maps to a DIFFERENT offset', () => {
    // The defect was that they all mapped to the same one.
    const offsets = [1, 2, 3, 4, 5].map((p) => model(500, p).offset);
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(offsets).toEqual([0, 12, 24, 36, 48]);
  });

  it('consecutive offsets differ by exactly one page, so no row is skipped or repeated', () => {
    for (let p = 1; p < 20; p++) {
      expect(model(500, p + 1).offset - model(500, p).offset).toBe(SIZE);
    }
  });
});

describe('rule 2: boundaries', () => {
  it('an empty listing is ONE page, not zero', () => {
    // Zero pages would make `page` 0 and render a strip for a visitor who is
    // looking at a real, if empty, listing.
    const m = model(0, 1);
    expect(m.totalPages).toBe(1);
    expect(m.page).toBe(1);
    expect(m.offset).toBe(0);
    expect(m.beyondEnd).toBe(false);
  });

  it('a listing that exactly fills one page does not invent a second', () => {
    expect(model(SIZE, 1).totalPages).toBe(1);
    expect(model(SIZE, 1).nextPage).toBeNull();
  });

  it('one row past a full page adds exactly one page', () => {
    expect(model(SIZE + 1, 1).totalPages).toBe(2);
    expect(model(SIZE * 2, 1).totalPages).toBe(2);
    expect(model(SIZE * 2 + 1, 1).totalPages).toBe(3);
  });

  it('the first page has no previous and the last has no next', () => {
    const first = model(100, 1);
    const last = model(100, first.totalPages);
    expect(first.prevPage).toBeNull();
    expect(first.nextPage).toBe(2);
    expect(last.nextPage).toBeNull();
    expect(last.prevPage).toBe(first.totalPages - 1);
  });
});

describe('rule 3: INVARIANT - nextPage agrees with the overfetch', () => {
  /*
    The page learns "is there another page" twice and independently: from the
    `PAGE_SIZE + 1` overfetch on the rows query, and from this model's count.
    If those two ever disagree the listing contradicts its own control strip.
  */
  it('nextPage is non-null exactly when a 13th row would exist', () => {
    for (let total = 0; total <= 40; total++) {
      for (let page = 1; page <= 5; page++) {
        const m = model(total, page);
        const rowsBefore = (page - 1) * SIZE;
        const overfetchWouldSeeMore = total > rowsBefore + SIZE;
        expect(m.nextPage !== null, `total=${total} page=${page}`).toBe(overfetchWouldSeeMore);
      }
    }
  });
});

describe('rule 4: past the end is honest, never clamped', () => {
  it('keeps the requested page and reports it as beyond the end', () => {
    const m = model(14, 99);
    expect(m.page).toBe(99);
    expect(m.totalPages).toBe(2);
    expect(m.beyondEnd).toBe(true);
  });

  it('serves an offset that really is past the data, so the listing is empty', () => {
    // Not clamped to page 2's offset. Clamping would show page 2's rows under
    // the URL ?page=99, and generateMetadata cannot detect that without a
    // fourth concurrent query (docs/87).
    const m = model(14, 99);
    expect(m.offset).toBe(98 * SIZE);
    expect(m.offset).toBeGreaterThan(14);
  });

  it('points "previous" at the last REAL page, not page-1', () => {
    // From ?page=99 of a 2-page listing, page 98 is one dead URL pointing at
    // another.
    expect(model(14, 99).prevPage).toBe(2);
    expect(model(14, 99).nextPage).toBeNull();
  });

  it('never marks a strip entry current when the request is past the end', () => {
    const m = model(14, 99);
    expect(m.items.every((i) => i.kind === 'ellipsis' || !i.isCurrent)).toBe(true);
    expect(pageNumbers(m.items)).toEqual([1, 2]);
  });
});

describe('rule 5: parsePageParam refuses junk without erroring', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['0', 1],
    ['-3', 1],
    ['abc', 1],
    ['2.5', 1],
    ['2abc', 1],
    [' 3 ', 3],
    ['1', 1],
    ['7', 7],
  ])('%s -> page %i', (raw, expected) => {
    expect(parsePageParam(raw as string | undefined)).toBe(expected);
  });

  it('reads the first value when Next hands over a repeated param', () => {
    // ?page=2&page=5 arrives as an array.
    expect(parsePageParam(['2', '5'])).toBe(2);
    expect(parsePageParam([])).toBe(1);
  });

  it('refuses a number too large to be a safe integer', () => {
    expect(parsePageParam('999999999999999999999')).toBe(1);
  });

  it('does not accept scientific or hex notation', () => {
    expect(parsePageParam('1e9')).toBe(1);
    expect(parsePageParam('0x10')).toBe(1);
  });
});

describe('rule 6: the number strip', () => {
  it('shows every page when the sequence is short', () => {
    expect(pageNumbers(model(SIZE * 5, 1).items)).toEqual([1, 2, 3, 4, 5]);
    expect(model(SIZE * 5, 1).items.some((i) => i.kind === 'ellipsis')).toBe(false);
  });

  it('abbreviates a long sequence around the current page', () => {
    const m = model(SIZE * 50, 25);
    expect(pageNumbers(m.items)).toEqual([1, 24, 25, 26, 50]);
    expect(m.items.filter((i) => i.kind === 'ellipsis')).toHaveLength(2);
  });

  it('never emits a page outside 1..totalPages', () => {
    for (const [total, page] of [[SIZE * 50, 1], [SIZE * 50, 50], [SIZE * 50, 2], [14, 99]] as const) {
      const m = model(total, page);
      for (const p of pageNumbers(m.items)) {
        expect(p).toBeGreaterThanOrEqual(1);
        expect(p).toBeLessThanOrEqual(m.totalPages);
      }
    }
  });

  it('marks exactly one entry current when the page is in range', () => {
    const m = model(SIZE * 50, 25);
    expect(m.items.filter((i) => i.kind === 'page' && i.isCurrent)).toHaveLength(1);
  });

  it('always includes the first and last page, so both ends stay one click away', () => {
    const m = model(SIZE * 50, 25);
    const nums = pageNumbers(m.items);
    expect(nums[0]).toBe(1);
    expect(nums[nums.length - 1]).toBe(50);
  });

  it('puts an ellipsis only where a real gap exists', () => {
    const m = model(SIZE * 50, 2);
    // 1,2,3 are contiguous, so no ellipsis before them.
    expect(pageNumbers(m.items)).toEqual([1, 2, 3, 50]);
    const gaps = m.items.filter((i): i is Extract<PaginationItem, { kind: 'ellipsis' }> => i.kind === 'ellipsis');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.after).toBe(3);
  });
});

describe('rule 7: degenerate inputs cannot produce a broken model', () => {
  it('survives a non-integer or negative page size and total', () => {
    const m = paginationModel({ total: -5, pageSize: 0, requestedPage: 1 });
    expect(m.pageSize).toBeGreaterThanOrEqual(1);
    expect(m.totalPages).toBe(1);
    expect(m.offset).toBe(0);
  });

  it('never returns a negative offset', () => {
    for (const p of [1, 0, -4]) {
      expect(paginationModel({ total: 100, pageSize: SIZE, requestedPage: p }).offset)
        .toBeGreaterThanOrEqual(0);
    }
  });
});
