'use client';

import { useState, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatRelativeTime } from '@/lib/utils/dates';
import { ListCount } from '@/components/admin/ListCount';
import {
  ArrowTopRightOnSquareIcon,
  PlusCircleIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  NewspaperIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';

/* ─── Types ─── */

interface NewsItemData {
  id: string;
  title: string;
  url: string;
  source: string;
  summary: string | null;
  category: string | null;
  relevanceScore: number | null;
  campaignCreated: boolean;
  publishedAt: string | null;
  fetchedAt: string;
}

interface NewsFeedMonitorProps {
  items: NewsItemData[];
  sources: string[];
  categories: string[];
  counts: { total: number; withCampaign: number; pending: number };
}

/* ─── Constants ─── */

const PAGE_SIZE = 25;

type SortField = 'fetchedAt' | 'relevanceScore' | 'source' | 'title';
type SortDir = 'asc' | 'desc';

/* ─── Relevance bar ─── */

function RelevanceIndicator({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">-</span>;
  const pct = Math.min(score, 100);
  const color =
    pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{score}</span>
    </div>
  );
}

/* ─── Component ─── */

export function NewsFeedMonitor({ items, sources, categories, counts }: NewsFeedMonitorProps) {
  /* Filters */
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'created'>('all');

  /* Sorting */
  const [sortField, setSortField] = useState<SortField>('fetchedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  /* Pagination */
  const [page, setPage] = useState(1);

  /* Expanded rows */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /* Create-campaign state */
  const [createdItems, setCreatedItems] = useState<Set<string>>(new Set());
  const [publishingItems, setPublishingItems] = useState<Set<string>>(new Set());

  /*
   * A volume guard refused the last create (HTTP 429 / RATE_LIMITED).
   *
   * Kept out of the error path on purpose: the daily campaign limit,
   * `simulation.max_concurrent` and the phase-out floor are settings working
   * as configured, not failures. The server's message carries the limit, the
   * current count and when it lifts, so it is shown verbatim in an
   * explanatory banner instead of a red "failed to create campaign" toast.
   */
  const [volumeLimit, setVolumeLimit] = useState<string | null>(null);

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (statusFilter === 'pending' && (item.campaignCreated || createdItems.has(item.id))) return false;
      if (statusFilter === 'created' && !item.campaignCreated && !createdItems.has(item.id)) return false;
      if (q && !item.title.toLowerCase().includes(q) && !item.source.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, sourceFilter, categoryFilter, statusFilter, createdItems]);

  /* ── Sorting ── */
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'fetchedAt':
          cmp = a.fetchedAt.localeCompare(b.fetchedAt);
          break;
        case 'relevanceScore':
          cmp = (a.relevanceScore ?? 0) - (b.relevanceScore ?? 0);
          break;
        case 'source':
          cmp = a.source.localeCompare(b.source);
          break;
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortField, sortDir]);

  /* ── Pagination ── */
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* Reset page on filter change */
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  /* ── Sorting toggle ── */
  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'relevanceScore' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUpIcon className="ml-1 inline h-3 w-3" />
      : <ChevronDownIcon className="ml-1 inline h-3 w-3" />;
  }

  /* ── Expand toggle ── */
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  /* ── Create campaign action ── */
  const handleCreate = useCallback(async (itemId: string) => {
    setPublishingItems((prev) => new Set(prev).add(itemId));

    try {
      const res = await fetch(`/api/v1/admin/news-feed/${itemId}/create-campaign`, {
        method: 'POST',
      });

      const body = await res.json();

      if (res.status === 429 || body.error?.code === 'RATE_LIMITED') {
        const message = body.error?.message
          ?? 'A campaign volume limit is in effect, so no new campaign was created.';
        setVolumeLimit(message);
        toast.info(message);
        return;
      }

      if (!res.ok || !body.ok) {
        toast.error(body.error?.message ?? 'Failed to create campaign');
        return;
      }

      setVolumeLimit(null);
      setCreatedItems((prev) => new Set(prev).add(itemId));
      toast.success(`Campaign created: ${body.data.campaignTitle}`, {
        action: {
          label: 'View',
          onClick: () => {
            window.open(`/campaigns/${body.data.campaignSlug}`, '_blank');
          },
        },
      });
    } catch {
      toast.error('Network error - could not reach the server');
    } finally {
      setPublishingItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }, []);

  const hasActiveFilters = sourceFilter !== 'all' || categoryFilter !== 'all' || statusFilter !== 'all' || search !== '';

  return (
    <div className="space-y-4">

      {/* ── Volume limit notice (HTTP 429, not an error) ── */}
      {volumeLimit && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">No campaign created - a volume limit is in effect</p>
            <p className="text-amber-700 dark:text-amber-300">{volumeLimit}</p>
            <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
              Nothing failed and no AI generation was spent. The news item is unchanged and
              can be published once the limit lifts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVolumeLimit(null)}
            className="ml-auto shrink-0 rounded p-0.5 text-amber-700 transition-colors duration-100 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
            aria-label="Dismiss volume limit notice"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Status tiles ── */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'all' as const, label: 'All items', count: counts.total },
          { key: 'pending' as const, label: 'Pending', count: counts.pending },
          { key: 'created' as const, label: 'Campaign created', count: counts.withCampaign },
        ].map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={() => updateFilter(setStatusFilter)(tile.key)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-100 ${
              statusFilter === tile.key
                ? 'border-primary/40 bg-primary/5 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <span className="block text-lg font-semibold tabular-nums leading-none">{tile.count}</span>
            <span className="mt-0.5 block text-xs">{tile.label}</span>
          </button>
        ))}
      </div>

      {/* ── Toolbar: search + filters ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search title or source…"
            value={search}
            onChange={(e) => updateFilter(setSearch)(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Source filter */}
        <Select value={sourceFilter} onValueChange={updateFilter(setSourceFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Category filter */}
        <Select value={categoryFilter} onValueChange={updateFilter(setCategoryFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c.replace(/-/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setSearch('');
              setSourceFilter('all');
              setCategoryFilter('all');
              setStatusFilter('all');
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}

        {/* Result count */}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Data table ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <NewspaperIcon className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No news items match your filters</p>
          {hasActiveFilters && (
            <Button
              variant="link"
              size="sm"
              className="mt-1 text-xs"
              onClick={() => {
                setSearch('');
                setSourceFilter('all');
                setCategoryFilter('all');
                setStatusFilter('all');
                setPage(1);
              }}
            >
              Clear all filters
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {/* Expand toggle column */}
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 text-left">
                  <button type="button" onClick={() => toggleSort('title')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Title<SortIcon field="title" />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <button type="button" onClick={() => toggleSort('source')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Source<SortIcon field="source" />
                  </button>
                </th>
                <th className="hidden px-3 py-2 text-left md:table-cell">
                  <span className="font-semibold text-muted-foreground">Category</span>
                </th>
                <th className="hidden px-3 py-2 text-left lg:table-cell">
                  <button type="button" onClick={() => toggleSort('relevanceScore')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Relevance<SortIcon field="relevanceScore" />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="font-semibold text-muted-foreground">Status</span>
                </th>
                <th className="hidden px-3 py-2 text-left sm:table-cell">
                  <button type="button" onClick={() => toggleSort('fetchedAt')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Fetched<SortIcon field="fetchedAt" />
                  </button>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="font-semibold text-muted-foreground">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.map((item) => {
                const isCampaign = item.campaignCreated || createdItems.has(item.id);
                const isPublishing = publishingItems.has(item.id);
                const isExpanded = expanded.has(item.id);

                return (
                  <>
                    <tr key={item.id} className="transition-colors duration-100 hover:bg-muted/30">
                      {/* Expand chevron */}
                      <td className="px-2 py-3 text-center">
                        {item.summary ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(item.id)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                          >
                            {isExpanded
                              ? <ChevronUpIcon className="h-4 w-4" />
                              : <ChevronDownIcon className="h-4 w-4" />}
                          </button>
                        ) : null}
                      </td>

                      {/* Title */}
                      <td className="max-w-xs px-3 py-3">
                        <span className="line-clamp-1 font-medium text-foreground">{item.title}</span>
                      </td>

                      {/* Source */}
                      <td className="px-3 py-3">
                        <Badge variant="outline" className="text-xs">{item.source}</Badge>
                      </td>

                      {/* Category */}
                      <td className="hidden px-3 py-3 md:table-cell">
                        {item.category ? (
                          <Badge variant="secondary" className="text-xs">
                            {item.category.replace(/-/g, ' ')}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>

                      {/* Relevance */}
                      <td className="hidden px-3 py-3 lg:table-cell">
                        <RelevanceIndicator score={item.relevanceScore} />
                      </td>

                      {/* Status */}
                      <td className="px-3 py-3">
                        {isCampaign ? (
                          <Badge variant="default" className="text-xs">
                            <CheckCircleIcon className="mr-1 h-3 w-3" />
                            Created
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Pending</span>
                        )}
                      </td>

                      {/* Fetched */}
                      <td className="hidden px-3 py-3 sm:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {item.publishedAt
                            ? formatRelativeTime(item.publishedAt)
                            : formatRelativeTime(item.fetchedAt)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-muted/50"
                          >
                            <ArrowTopRightOnSquareIcon className="mr-1 h-3.5 w-3.5" />
                            Source
                          </a>
                          {!isCampaign && (
                            <Button
                              size="sm"
                              disabled={isPublishing}
                              onClick={() => handleCreate(item.id)}
                              className="h-7 px-2 text-xs"
                            >
                              {isPublishing ? (
                                <>
                                  <svg className="mr-1 h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Creating…
                                </>
                              ) : (
                                <>
                                  <PlusCircleIcon className="mr-1 h-3.5 w-3.5" />
                                  Create
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded summary row */}
                    {isExpanded && item.summary && (
                      <tr key={`${item.id}-exp`} className="bg-muted/20">
                        <td />
                        <td colSpan={7} className="px-3 pb-3 pt-1">
                          <p className="text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Count and pagination (docs/88 F16) ── */}
      {(sorted.length > 0 || counts.total > items.length) && (
        <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
          <ListCount
            from={sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
            to={Math.min(safePage * PAGE_SIZE, sorted.length)}
            shown={sorted.length}
            loaded={items.length}
            total={counts.total}
            noun="news items"
          />
          {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="px-2 text-xs tabular-nums text-muted-foreground">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
