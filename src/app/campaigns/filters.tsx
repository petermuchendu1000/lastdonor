'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import {
  MagnifyingGlassIcon,
  AdjustmentsHorizontalIcon,
  ChevronDownIcon,
  XMarkIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';
import { CAMPAIGN_CATEGORIES } from '@/lib/categories';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import type { CampaignCategory } from '@/types';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const SORT_OPTIONS = [
  { value: 'most_funded', label: 'Most Funded' },
  { value: 'newest', label: 'Newest' },
  { value: 'least_funded', label: 'Least Funded' },
  { value: 'closing_soon', label: 'Closing Soon' },
] as const;

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface CampaignFiltersProps {
  activeCategory: CampaignCategory | null;
  activeSort: string;
  activeCloseToTarget: boolean;
  searchQuery: string;
  activeLocation: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function CampaignFilters({
  activeCategory,
  activeSort,
  activeCloseToTarget,
  searchQuery,
  activeLocation,
}: CampaignFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local state for search input (debounced push)
  const [localQuery, setLocalQuery] = useState(searchQuery);

  // Local state for location input
  const [localLocation, setLocalLocation] = useState(activeLocation);

  // Sheet open state
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── URL param updater ──
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      startTransition(() => {
        router.push(`/campaigns?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition],
  );

  // ── Search submit handler ──
  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const normalized = localQuery.trim().toLowerCase();
      updateParams({ q: normalized || null });
    },
    [localQuery, updateParams],
  );

  // ── Clear everything ──
  const clearAll = useCallback(() => {
    setLocalQuery('');
    setLocalLocation('');
    startTransition(() => {
      router.push('/campaigns');
    });
  }, [router, startTransition]);

  // Active filter count for the "Filters" badge
  const activeFilterCount =
    (activeCategory ? 1 : 0) +
    (activeSort !== 'most_funded' ? 1 : 0) +
    (activeCloseToTarget ? 1 : 0) +
    (activeLocation ? 1 : 0);

  /**
   * Anything at all narrowing or reordering the list, including the search
   * term. The Reset button used to live only inside the Filters drawer, so a
   * zero-result URL had no visible exit but the browser Back button.
   */
  const hasAnyFilter = activeFilterCount > 0 || Boolean(searchQuery);

  // ── Helper: category display label ──
  const categoryLabel = activeCategory
    ? CAMPAIGN_CATEGORIES.find((c) => c.value === activeCategory)?.label
    : null;

  // ── Helper: sort display label ──
  const sortLabel = SORT_OPTIONS.find((o) => o.value === activeSort)?.label ?? 'Most Funded';

  return (
    <div data-pending={isPending ? '' : undefined} className="space-y-4">
      {/* ── Search bar ── */}
      <form onSubmit={handleSearchSubmit} className="mx-auto max-w-2xl">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Search campaigns by name, person, or location"
            className="w-full rounded-full border border-border bg-muted/50 py-3 pl-12 pr-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </form>

      {/* ── Filter pill bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Filters button → opens Sheet */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
                activeFilterCount > 0
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-foreground hover:bg-muted',
              )}
            >
              <AdjustmentsHorizontalIcon className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background text-xs font-bold text-foreground">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </SheetTrigger>

          {/* ── Filters Sheet (side panel) ── */}
          <SheetContent side="left" className="flex w-[85vw] flex-col sm:w-[420px]">
            <SheetHeader>
              <SheetTitle className="text-xl font-bold">Filters</SheetTitle>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-6">
              {/* Category section */}
              <div className="pb-8">
                <h3 className="text-base font-bold text-foreground">Category</h3>
                <p className="mt-1 text-sm text-muted-foreground">Choose one</p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {CAMPAIGN_CATEGORIES.map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => {
                        updateParams({
                          category: activeCategory === cat.value ? null : cat.value,
                        });
                      }}
                      className={cn(
                        'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                        activeCategory === cat.value
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-foreground hover:bg-muted',
                      )}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Close to target section */}
              <div className="py-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-foreground">Close to target</h3>
                    <p className="mt-1 text-sm text-muted-foreground">90% or more funded</p>
                  </div>
                  <Switch
                    checked={activeCloseToTarget}
                    onCheckedChange={(checked) => {
                      updateParams({ close_to_target: checked ? '1' : null });
                    }}
                  />
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Location section */}
              <div className="py-8">
                <h3 className="text-base font-bold text-foreground">Location</h3>
                <p className="mt-1 text-sm text-muted-foreground">City, state, or region</p>
                <form
                  className="mt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const normalized = localLocation.trim();
                    updateParams({ location: normalized || null });
                  }}
                >
                  <div className="relative">
                    <MapPinIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={localLocation}
                      onChange={(e) => setLocalLocation(e.target.value)}
                      placeholder="e.g. Texas, San Diego"
                      className="w-full rounded-full border border-border bg-muted/40 py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  {activeLocation && (
                    <button
                      type="button"
                      onClick={() => {
                        setLocalLocation('');
                        updateParams({ location: null });
                      }}
                      className="mt-3 text-sm font-medium text-primary hover:text-primary/80"
                    >
                      Clear location
                    </button>
                  )}
                </form>
              </div>

              <div className="border-t border-border" />

              {/* Sort section */}
              <div className="py-8">
                <h3 className="text-base font-bold text-foreground">Sort by</h3>
                <div className="mt-4 space-y-1">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateParams({ sort: opt.value === 'most_funded' ? null : opt.value })}
                      className={cn(
                        'block w-full rounded-lg px-3 py-3 text-left text-sm transition-colors',
                        activeSort === opt.value
                          ? 'font-bold text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sheet footer */}
            <SheetFooter className="flex-row gap-3 border-t border-border px-6 py-5">
              <button
                type="button"
                onClick={clearAll}
                className="flex-1 rounded-full border border-border px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Reset
              </button>
              <SheetClose asChild>
                <button
                  type="button"
                  className="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  See results
                </button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/*
          Category, Location and Close to target are ALSO rows inside the
          Filters sheet, so on a phone they were the same control twice. The
          comment here already said "(desktop)"; it simply was not true, and
          the five pills wrapped to a second line.

          Hidden below `sm`, where the Filters button (which carries the
          active count) is the single entry point. Sort stays visible at
          every width: it is a different axis from filtering and its label
          doubles as the current state. See docs/71.
        */}
        <span className="hidden sm:contents">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
                activeCategory
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-foreground hover:bg-muted',
              )}
            >
              {categoryLabel ?? 'Category'}
              <ChevronDownIcon className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-4">
            <p className="mb-3 text-sm text-muted-foreground">Choose one</p>
            <div className="flex flex-wrap gap-2">
              {CAMPAIGN_CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => {
                    updateParams({
                      category: activeCategory === cat.value ? null : cat.value,
                    });
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    activeCategory === cat.value
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-foreground hover:bg-muted',
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            {activeCategory && (
              <button
                type="button"
                onClick={() => updateParams({ category: null })}
                className="mt-3 text-sm text-primary hover:text-primary/80"
              >
                Clear Selection
              </button>
            )}
          </PopoverContent>
        </Popover>

        {/* Location pill → Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
                activeLocation
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-foreground hover:bg-muted',
              )}
            >
              <MapPinIcon className="h-3.5 w-3.5" />
              {activeLocation || 'Location'}
              <ChevronDownIcon className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const normalized = localLocation.trim();
                updateParams({ location: normalized || null });
              }}
            >
              <p className="mb-2 text-sm text-muted-foreground">City, state, or region</p>
              <div className="relative">
                <MapPinIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={localLocation}
                  onChange={(e) => setLocalLocation(e.target.value)}
                  placeholder="e.g. Texas, San Diego"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                {activeLocation ? (
                  <button
                    type="button"
                    onClick={() => {
                      setLocalLocation('');
                      updateParams({ location: null });
                    }}
                    className="text-sm text-primary hover:text-primary/80"
                  >
                    Clear
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Apply
                </button>
              </div>
            </form>
          </PopoverContent>
        </Popover>

        </span>
        {/* Sort pill. Visible at every width, see the note above. */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
                activeSort !== 'most_funded'
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-foreground hover:bg-muted',
              )}
            >
              {sortLabel}
              <ChevronDownIcon className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-2">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateParams({ sort: opt.value === 'most_funded' ? null : opt.value })}
                className={cn(
                  'block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  activeSort === opt.value
                    ? 'font-bold text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Close to target: in the sheet on a phone, see the note above. */}
        <button
          type="button"
          onClick={() => updateParams({ close_to_target: activeCloseToTarget ? null : '1' })}
          className={cn(
            'hidden items-center gap-1 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors sm:inline-flex',
            activeCloseToTarget
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-foreground hover:bg-muted',
          )}
        >
          Close to target
        </button>

        {/* Clear filters - visible on the bar itself, not only in the drawer */}
        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-muted"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            Clear filters
          </button>
        )}

        {/* Loading indicator */}
        {isPending && (
          <div className="flex items-center pl-1" aria-label="Loading results">
            <svg className="h-4 w-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {/* Active filter chips - clearable */}
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setLocalQuery('');
              updateParams({ q: null });
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-sm text-foreground"
          >
            &ldquo;{searchQuery}&rdquo;
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        )}
        {activeLocation && (
          <button
            type="button"
            onClick={() => {
              setLocalLocation('');
              updateParams({ location: null });
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-sm text-foreground"
          >
            <MapPinIcon className="h-3.5 w-3.5" />
            {activeLocation}
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
