import Link from 'next/link';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { PARAM_LABELS, type UnappliedParam } from './browse-params';

interface FilterNoticeProps {
  /** Params that carried a value the listing could not apply. */
  unapplied: UnappliedParam[];
  /** `status=completed|archived`: a real status served by another page. */
  completedRequested: boolean;
  /** Whether anything is still narrowing the list. */
  filtersActive: boolean;
}

/**
 * Tells the visitor that part of their URL was not applied.
 *
 * An unrecognized filter value used to be dropped in silence, so a stale or
 * guessed link rendered the full listing under the normal header: the page
 * read as though all of those campaigns matched the filter. See
 * `docs/45-BROWSE-FILTER-HONESTY-ADR.md`.
 */
export function FilterNotice({ unapplied, completedRequested, filtersActive }: FilterNoticeProps) {
  if (unapplied.length === 0 && !completedRequested) return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-start dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        {unapplied.map((param) => (
          <p key={`${param.key}:${param.value}`}>
            <span className="font-semibold">
              {PARAM_LABELS[param.key]} &ldquo;{param.value}&rdquo;
            </span>{' '}
            is not one we recognize, so it was not applied. The list below is not filtered by{' '}
            {PARAM_LABELS[param.key]}.
          </p>
        ))}

        {completedRequested && (
          <p>
            This page lists campaigns that are still raising money.{' '}
            <Link
              href="/completed-campaigns"
              className="font-semibold underline underline-offset-2 hover:no-underline"
            >
              See completed campaigns
            </Link>
            .
          </p>
        )}

        {filtersActive && (
          <p>
            <Link
              href="/campaigns"
              className="font-semibold underline underline-offset-2 hover:no-underline"
            >
              Clear filters
            </Link>{' '}
            to start over.
          </p>
        )}
      </div>
    </div>
  );
}
