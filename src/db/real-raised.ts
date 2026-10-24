/**
 * The SUM of a campaign's REAL, un-refunded donations, in minor units.
 *
 * One expression, used by every money-in route and by the integration test
 * that proves it, so there is nothing to drift. It was inlined in three route
 * files first; a test that greps three copies tests the copies, not the SQL.
 *
 * WHY THIS EXISTS AT ALL, rather than reading `campaigns.raised_amount`:
 *
 * `raised_amount` is a BLENDED figure. The simulation engine increments the
 * same column for donations written with `source = 'seed'`, which are
 * fabricated and carry no money. It is the right number for a progress bar
 * and the wrong number for any decision about real funds - which is why the
 * lump-sum release in
 * `src/app/api/v1/admin/campaigns/[campaignId]/verification/route.ts`
 * computes its own figure this same way instead of releasing `raised_amount`.
 * Releasing the blended column once meant a campaign showing $40,000, of
 * which $38,000 was seeded, released $40,000 of real platform money.
 *
 * The pre-verification cap has the mirror-image hazard: measured against the
 * blended column, fabricated seed money would consume a real campaign's
 * headroom and lock out donors trying to give actual money.
 *
 * ⚠ THE TRAP, measured 2026-10-24 against Postgres 16.15.
 *
 * Interpolating a Column into a `sql` template renders it **UNQUALIFIED**.
 * The obvious way to write this:
 *
 *     sql`... FROM ${donations} WHERE ${donations.campaignId} = ${campaigns.id}`
 *
 * generates `WHERE "campaign_id" = "id"`. Inside the subquery, `donations` is
 * the only table in scope, so BOTH names resolve to it: the predicate becomes
 * `donations.campaign_id = donations.id`, which is never true. The query is
 * valid SQL, raises no error, and returns `0` for every campaign - so the cap
 * silently never fires and every campaign looks like it has full headroom.
 *
 * `alias()` does not fix it either (it renders `FROM "rd"` while still
 * emitting unqualified column names, so the subquery fails with
 * `relation "rd" does not exist`).
 *
 * So the identifiers are qualified explicitly, and DERIVED from the schema
 * objects via `getTableName` and `column.name` rather than written as string
 * literals, so a table or column rename cannot leave this file behind.
 *
 * None of this is visible to a unit test or to a grep over the route files.
 * It was caught only by `src/db/real-raised.integration.test.ts` running the
 * expression against a real database, which is why that file exists.
 *
 * Written as a correlated scalar subquery so it can sit inside a SELECT a
 * route already issues - no extra round trip, and nothing added to the
 * 3-concurrent-query budget that `src/db/pool-fanout.ratchet.test.ts` holds
 * every entry point to.
 *
 * `COALESCE(..., 0)` because SUM over no rows is NULL, not 0, and a NULL
 * headroom would compare false against every cap and disable it just as
 * silently as the bug above.
 */

import { sql, getTableName } from 'drizzle-orm';
import type { AnyColumn, Table } from 'drizzle-orm';
import { campaigns, donations } from './schema';

/** `"donations"` - a table identifier, taken from the schema object. */
const t = (table: Table) => sql.identifier(getTableName(table));
/** `"campaign_id"` - a column identifier, taken from the column object. */
const c = (column: AnyColumn) => sql.identifier(column.name);

export const realRaisedMinorSql = sql<number>`COALESCE((
  SELECT SUM(${t(donations)}.${c(donations.amount)})
  FROM ${t(donations)}
  WHERE ${t(donations)}.${c(donations.campaignId)} = ${t(campaigns)}.${c(campaigns.id)}
    AND ${t(donations)}.${c(donations.source)} = 'real'
    AND ${t(donations)}.${c(donations.refunded)} = false
), 0)::int`;
