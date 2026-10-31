import { and, gte, ilike, or, sql, eq, type SQL } from 'drizzle-orm';
import { campaigns } from '@/db/schema';
import { listedCampaignFilter } from '@/db/public-campaigns';
import { campaignSearchCondition } from '@/lib/campaign-search';
import type { CampaignCategory } from '@/types';

/**
 * What `/campaigns` is currently showing, as one predicate.
 *
 * ── WHY THIS IS A MODULE ──────────────────────────────────────────────────
 *
 * It was inline in `campaigns/(index)/page.tsx` and read by that page's rows
 * query and its filtered-count query. `generateMetadata` needs the same
 * total, to answer one question it could not answer before: *is the requested
 * page beyond the end?* An out-of-range page was served `index, follow` with
 * a self-referencing canonical, so `/campaigns?page=99` was an indexable
 * empty page — and with 8 live campaigns against a page size of 12, so was
 * `?page=2`. See `docs/166`.
 *
 * ⛔ The predicate had to move rather than be duplicated. A second
 * filter-building block in `generateMetadata` is two ideas of *"what
 * matches"*, which is the defect class `docs/146`, `docs/147`, `docs/164` and
 * `docs/165` are all instances of. One definition, read by every query that
 * needs it.
 *
 * ⚠️ And it is in `src/db/` so the integration suite can EXECUTE it. Same
 * move and same reason as `docs/107` (`report-periods.ts`), `docs/126`
 * (`auth-lockout.ts`) and `docs/130` (`release-amount.ts`): a page component's
 * query is reachable by no test, and `docs/107` §7 says so outright.
 */
export interface BrowseFilter {
  category: CampaignCategory | null;
  searchQuery: string;
  location: string;
  closeToTarget: boolean;
}

/**
 * ⛔ Starts from `listedCampaignFilter()`, never the raw status pair: this is
 * a LISTING, so the platform's own general fund is excluded (`docs/147`).
 */
export function browseConditions(filter: BrowseFilter): SQL {
  const parts: SQL[] = [listedCampaignFilter()];

  if (filter.category) {
    parts.push(eq(campaigns.category, filter.category));
  }

  // One shared predicate (title, name, location, hometown, story prose,
  // category) so this page and the API cannot drift. See `docs/45`.
  const keyword = campaignSearchCondition(filter.searchQuery);
  if (keyword) parts.push(keyword);

  if (filter.location) {
    const pattern = `%${filter.location}%`;
    parts.push(
      or(
        ilike(campaigns.location, pattern),
        ilike(campaigns.subjectHometown, pattern),
      )!,
    );
  }

  if (filter.closeToTarget) {
    parts.push(
      gte(
        sql`(${campaigns.raisedAmount}::float / NULLIF(${campaigns.goalAmount}, 0))`,
        0.9,
      ),
    );
  }

  return and(...parts)!;
}
