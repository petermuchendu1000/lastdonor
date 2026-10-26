import 'server-only';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { campaignPayoutDesignations } from '@/db/schema';

/**
 * Reading a campaign's destination, against the database.
 *
 * ── WHY THIS IS NOT INLINE IN THE WITHDRAWAL ROUTE ──────────────────────────
 *
 * It was, and a mutation survived. Deleting `eq(status, 'active')` from the
 * inline query left the whole unit suite green, because the route test's
 * database mock does the filtering itself - the mock cannot see a `where()`
 * argument, so it was answering as though the clause were there whether or
 * not it was.
 *
 * So the query lives here, where an integration test can EXECUTE it against
 * real Postgres - the `docs/107` move, for the `docs/101` reason: a query can
 * be valid, silent and wrong, and only a real database says which.
 *
 * ── WHAT THE MUTATION RUN ACTUALLY FOUND, which was not what was expected ──
 *
 * Against real Postgres, removing the `active` filter STILL did not fail, and
 * neither did reversing the ordering. Both are **equivalent mutants**, and
 * the reason is worth keeping:
 *
 *   The partial unique index permits only ONE active row, and a second row
 *   can only be inserted after the first is revoked. So the active row is
 *   always the NEWEST row. Ordering by `designated_at DESC` therefore finds
 *   the same row the filter would, and each defence makes the other
 *   redundant.
 *
 * ⛔ Removing BOTH together DOES fail (reproduced 3/3). So the pair is
 * load-bearing even though neither half is, and this is deliberate
 * defence-in-depth against the index being dropped or widened in a future
 * migration: the filter states the intent, the ordering fails toward
 * BLOCKING the organiser rather than paying them.
 *
 * ⚠️ Do not delete one because a mutation run calls it redundant. It is
 * redundant only while the other two guards hold.
 */

/** The narrow slice the decision needs. Nothing about money is read. */
export interface ActiveDesignationRow {
  status: string;
  revokedAt: Date | null;
}

/**
 * A client that can `select` — `db` itself, or a transaction handle.
 *
 * The withdrawal route calls this INSIDE its transaction, under the campaign
 * row lock, so a designation created mid-withdrawal still wins the race.
 */
type Selectable = Pick<typeof db, 'select'>;

/**
 * The campaign's live destination, or null.
 *
 * ⚠️ `orderBy(desc(designatedAt))` is belt-and-braces beside the partial
 * unique index that already permits only one active row. The index is the
 * guarantee; the ordering means that if the index is ever dropped or
 * weakened in a migration, this returns the NEWEST destination rather than an
 * arbitrary one — failing toward blocking the organiser, never toward paying
 * them.
 */
export async function activeDesignation(
  client: Selectable,
  campaignId: string,
): Promise<ActiveDesignationRow | null> {
  const [row] = await client
    .select({
      status: campaignPayoutDesignations.status,
      revokedAt: campaignPayoutDesignations.revokedAt,
    })
    .from(campaignPayoutDesignations)
    .where(
      and(
        eq(campaignPayoutDesignations.campaignId, campaignId),
        eq(campaignPayoutDesignations.status, 'active'),
      ),
    )
    .orderBy(desc(campaignPayoutDesignations.designatedAt))
    .limit(1);

  return row ?? null;
}
