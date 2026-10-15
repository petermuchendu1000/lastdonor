/**
 * Campaign slug resolution: "no such campaign" is not "the database is down".
 *
 * WHY THIS EXISTS - production audit 2026-10-15.
 *
 * `/campaigns/<unknown-slug>` answered in 15.2s with a bare, unstyled
 * `500: Internal Server Error`: no header, no footer, no navigation, no way
 * back. Every mistyped link, every stale bookmark, every crawler holding an old
 * URL and every wrong-case path (`/campaigns/ALICIA-REEVES`) landed there.
 *
 * Two separate faults produced that page, and this module exists to separate
 * them:
 *
 * 1. `src/app/campaigns/[slug]/page.tsx` ran its single `campaigns` lookup from
 *    `generateMetadata` as well as the page body. `generateMetadata` resolves
 *    *before* the HTML shell is flushed, so a rejection there aborts the
 *    document before `app/error.tsx` or `app/global-error.tsx` can exist in the
 *    tree. Next then falls back to its own plain-text 500. That is exactly the
 *    chrome-less page the audit saw, and it is also the proof that the throw
 *    came from metadata and not from the page body, which would have rendered
 *    the styled boundary instead.
 *
 * 2. Nothing in `src/` handled `QueryTimeoutError` (`code =
 *    'DB_QUERY_TIMEOUT'`, `src/db/query-timeout.ts`). A lookup that exhausted
 *    the 15s client-side query bound therefore propagated as an unhandled
 *    rejection rather than resolving to "no rows", so the `notFound()` branch
 *    in the page was never reached.
 *
 * WHAT IT MUST NOT DO. A thrown lookup must never become a 404. "This campaign
 * does not exist" is a factual claim published to donors and to crawlers; a
 * wedged pool (docs/37) would otherwise de-index live appeals and tell donors
 * that someone's fundraiser is gone. A resolved empty result is the only
 * evidence that a slug does not exist.
 *
 * WHAT IT ADDS. A second, tighter deadline around the one query that gates the
 * whole page, so a stalled pool fails in seconds instead of 15. It does not
 * touch and does not weaken the global bound in `src/db/query-timeout.ts`,
 * which stays as the backstop for every other query; this is strictly narrower
 * than that bound and is clamped to it.
 */
import { IS_PRODUCTION_BUILD } from '@/db/build-phase';
import { resolveQueryTimeoutMs } from '@/db/query-timeout';

/** Page-level budget for the slug lookup, well inside the global query bound. */
const DEFAULT_LOOKUP_BUDGET_MS = 4_000;

/** Below this, an ordinary cold connection would be reported as an outage. */
const MIN_LOOKUP_BUDGET_MS = 500;

export type CampaignLookup<T> =
  /** The slug resolved to a row. */
  | { status: 'found'; campaign: T }
  /** The query answered and returned no rows. The only basis for a 404. */
  | { status: 'missing' }
  /** The query did not answer. Never a 404. */
  | { status: 'unavailable'; cause: unknown };

/** The page-level deadline elapsed before the lookup answered. */
export class CampaignLookupTimeoutError extends Error {
  readonly code = 'CAMPAIGN_LOOKUP_TIMEOUT';
  constructor(ms: number) {
    super(
      `Campaign slug lookup exceeded ${ms}ms. This is the page-level deadline, ` +
        `not the global query bound; see src/lib/campaign-lookup.ts and docs/43.`,
    );
    this.name = 'CampaignLookupTimeoutError';
  }
}

/**
 * Thrown by the campaign page when the lookup did not answer, so the request
 * ends as a 5xx rendered by `app/error.tsx` rather than as a 404.
 */
export class CampaignUnavailableError extends Error {
  readonly code = 'CAMPAIGN_LOOKUP_UNAVAILABLE';
  constructor(slug: string, cause: unknown) {
    super(
      `The campaign lookup for "${slug}" did not answer, so it is unknown ` +
        `whether this campaign exists. Reported as a server error rather than ` +
        `a 404 on purpose; see src/lib/campaign-lookup.ts and docs/43.`,
      { cause },
    );
    this.name = 'CampaignUnavailableError';
  }
}

/**
 * The lookup budget for this process.
 *
 * During `next build` the tighter budget is deliberately NOT applied: a
 * prerender runs many pages through a 5-connection pool at once, where a
 * several-second queue wait is normal and is not an outage. The global query
 * bound still applies there, and `withBuildPhaseFailSoft` already turns a build
 * -time query failure into zero rows.
 */
export function resolveLookupBudgetMs(
  raw: string | undefined = process.env.CAMPAIGN_LOOKUP_TIMEOUT_MS,
  queryBudgetMs: number = resolveQueryTimeoutMs(),
  isProductionBuild: boolean = IS_PRODUCTION_BUILD,
): number {
  if (isProductionBuild) return queryBudgetMs;

  const fallback = Math.min(DEFAULT_LOOKUP_BUDGET_MS, queryBudgetMs);
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (
    !Number.isFinite(parsed) ||
    parsed < MIN_LOOKUP_BUDGET_MS ||
    parsed > queryBudgetMs
  ) {
    console.error(
      `[campaign] CAMPAIGN_LOOKUP_TIMEOUT_MS="${raw}" is not a number in ` +
        `${MIN_LOOKUP_BUDGET_MS}..${queryBudgetMs} (the global query bound); ` +
        `using ${fallback}ms.`,
    );
    return fallback;
  }
  return parsed;
}

/**
 * Run a slug lookup and classify the outcome.
 *
 * `load` must resolve to the row, or to `null`/`undefined` when the query
 * answered and matched nothing. Anything thrown - a `QueryTimeoutError`, a
 * connection error, the deadline below - is reported as `unavailable`, because
 * none of them is evidence that the campaign does not exist.
 */
export async function lookupCampaign<T>(
  load: () => PromiseLike<T | null | undefined>,
  budgetMs: number = resolveLookupBudgetMs(),
): Promise<CampaignLookup<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const campaign = await Promise.race([
      Promise.resolve(load()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new CampaignLookupTimeoutError(budgetMs)),
          budgetMs,
        );
      }),
    ]);
    return campaign == null
      ? { status: 'missing' }
      : { status: 'found', campaign };
  } catch (cause) {
    return { status: 'unavailable', cause };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
