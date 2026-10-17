/**
 * The "Showing 1-25 of N" line under an admin list (docs/88 F16).
 *
 * ── What it is fixing ────────────────────────────────────────────────
 *
 * `/admin/users` fetches with `.limit(200)` and also computes a true
 * `count(*)`, which it passed to `UsersList` as `totalUsers`. The filter
 * tile used that true number; the footer used `sorted.length`, the
 * length of the capped fetch. Measured in production with 238 users:
 * the footer said "of 200" while the database held 238. One screen,
 * two totals, 38 people invisible.
 *
 * `/admin/donations` has the identical shape: a `.limit(200)` fetch, a
 * true `stats.totalCount`, and the same footer expression.
 *
 * ── Why it does not simply print the true total ──────────────────────
 *
 * Swapping `sorted.length` for the true total would make the two
 * numbers agree and would be a *different* lie: paging to the end would
 * stop at 200 rows while the footer promised 238. The honest statement
 * is both numbers plus the fact that the list is cut short, which is
 * the same choice docs/45 made for filters - report the limitation
 * rather than silently present a narrower answer as the whole one.
 *
 * The truncation note also warns about something no single number can:
 * search and the filter tiles run in the browser over the fetched rows,
 * so on a truncated list they search 200 rows, not 238. A tile reading
 * "admin 3" can therefore select 2 rows without either figure being
 * wrong.
 *
 * Proper server-side pagination would remove the cap entirely. That is
 * a larger change and is NOT what this does; this stops the screen
 * lying while the cap exists.
 */

interface ListCountProps {
  /** 1-based index of the first row on this page. */
  from: number;
  /** 1-based index of the last row on this page. */
  to: number;
  /** Rows after search and filters: what `from`/`to` index into. */
  shown: number;
  /** Rows actually fetched and filterable in the browser (the capped set). */
  loaded: number;
  /** True `count(*)` from the database, before the fetch cap. */
  total: number;
  /** What the rows are, lower case and plural: "users", "donations". */
  noun: string;
}

export function ListCount({ from, to, shown, loaded, total, noun }: ListCountProps) {
  const truncated = total > loaded;

  return (
    <div className="text-xs text-muted-foreground">
      <p>
        Showing {from.toLocaleString()}&ndash;{to.toLocaleString()} of{' '}
        {shown.toLocaleString()}
      </p>
      {truncated && (
        <p className="mt-1 text-brand-amber">
          Loaded the newest {loaded.toLocaleString()} of {total.toLocaleString()}{' '}
          {noun}. Search and filters apply to those {loaded.toLocaleString()} only.
        </p>
      )}
    </div>
  );
}
