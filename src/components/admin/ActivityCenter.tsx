'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/utils/dates';
import {
  BellAlertIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ShieldExclamationIcon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';

interface ActivityEntry {
  id: string;
  timestamp: string;
  eventType: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  severity: string;
  actorName: string | null;
  actorEmail: string | null;
}

interface AlertEntry {
  id: string;
  timestamp: string;
  eventType: string;
  severity: string;
  details: Record<string, unknown>;
  targetType: string | null;
  targetId: string | null;
}

interface ActivityCenterProps {
  activity: ActivityEntry[];
  summary: Record<string, number>;
  alerts: AlertEntry[];
}

const SEVERITY_STYLES: Record<string, { dot: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  info: { dot: 'bg-primary', variant: 'secondary' },
  warning: { dot: 'bg-amber-500', variant: 'outline' },
  error: { dot: 'bg-destructive', variant: 'destructive' },
  critical: { dot: 'bg-destructive', variant: 'destructive' },
};

const CATEGORY_EVENTS: Record<string, string[]> = {
  donations: ['donation.recorded', 'donation.failed', 'donation.refunded'],
  campaigns: ['campaign.phase_transition', 'campaign.completed', 'campaign.auto_published', 'campaign.auto_drafted', 'campaign.created'],
  users: ['user.login', 'user.deleted', 'user.role_changed'],
  system: ['cron.send_newsletter', 'cron.simulate_donations', 'cron.publish_campaigns', 'cron.fetch_news', 'cron.ingest_news', 'cron.reconcile', 'admin.seed_purge', 'admin.seed_messages_generated', 'audit_log.viewed'],
};

function getEventCategory(eventType: string): string {
  for (const [cat, events] of Object.entries(CATEGORY_EVENTS)) {
    if (events.includes(eventType)) return cat;
  }
  return 'other';
}

function formatEventType(eventType: string): string {
  return eventType
    .replace(/\./g, ' → ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function getEventDescription(entry: ActivityEntry | AlertEntry): string {
  const details = entry.details;
  switch (entry.eventType) {
    case 'donation.recorded':
      return `$${((details.amount as number) / 100 || 0).toFixed(2)} donation received`;
    case 'donation.failed':
      return `Donation payment failed`;
    case 'donation.refunded':
      return `Donation refunded`;
    case 'campaign.completed':
      return `Campaign reached its goal`;
    case 'campaign.phase_transition':
      return `Campaign moved to ${(details.toPhase as string)?.replace(/_/g, ' ') ?? 'new phase'}`;
    case 'campaign.auto_drafted':
    case 'campaign.auto_published':
      return `Campaign auto-published`;
    case 'user.role_changed':
      return `Role changed: ${details.previousRole ?? '?'} → ${details.newRole ?? '?'}`;
    case 'user.deleted':
      return `User account deleted`;
    case 'reconcile.discrepancy':
      return `Financial discrepancy detected`;
    default:
      return formatEventType(entry.eventType);
  }
}

const PAGE_SIZE = 25;

export function ActivityCenter({ activity, summary, alerts }: ActivityCenterProps) {
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let result = activity;

    if (categoryFilter) {
      const eventTypes = CATEGORY_EVENTS[categoryFilter] ?? [];
      result = result.filter((a) => eventTypes.includes(a.eventType));
    }

    if (severityFilter) {
      result = result.filter((a) => a.severity === severityFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((a) =>
        getEventDescription(a).toLowerCase().includes(q) ||
        a.eventType.toLowerCase().includes(q) ||
        (a.actorName?.toLowerCase().includes(q) ?? false) ||
        (a.actorEmail?.toLowerCase().includes(q) ?? false)
      );
    }

    return result;
  }, [activity, categoryFilter, severityFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const totalEvents = (summary.info ?? 0) + (summary.warning ?? 0) + (summary.error ?? 0) + (summary.critical ?? 0);

  function updateFilter(setter: (v: string | null) => void, value: string | null) {
    setter(value);
    setPage(0);
  }

  return (
    <div className="space-y-6">
      {/* 24h Summary Tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-lg border px-4 py-3">
          <p className="text-2xl font-semibold tabular-nums">{totalEvents}</p>
          <p className="text-xs text-muted-foreground">Last 24h</p>
        </div>
        {(['info', 'warning', 'error', 'critical'] as const).map((sev) => {
          const isActive = severityFilter === sev;
          return (
            <button
              key={sev}
              onClick={() => updateFilter(setSeverityFilter, isActive ? null : sev)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                isActive ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/30'
              }`}
            >
              <p className="text-2xl font-semibold tabular-nums">{summary[sev] ?? 0}</p>
              <p className="text-xs font-medium capitalize text-muted-foreground">{sev}</p>
            </button>
          );
        })}
      </div>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BellAlertIcon className="h-4 w-4 text-muted-foreground" />
            Recent Alerts
          </h2>
          <div className="mt-4 space-y-2">
            {alerts.map((a) => {
              const styles = SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.info;
              return (
                <div
                  key={a.id}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  {a.severity === 'critical' ? (
                    <ShieldExclamationIcon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  ) : a.severity === 'error' ? (
                    <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  ) : (
                    <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{getEventDescription(a)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(a.timestamp)}
                      {a.targetType && ` · ${a.targetType}`}
                    </p>
                  </div>
                  <Badge variant={styles.variant} className="shrink-0 text-[10px]">
                    {a.severity}
                  </Badge>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Toolbar: Search + Category Filters */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events, actors…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search activity"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => updateFilter(setCategoryFilter, null)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              !categoryFilter ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted'
            }`}
          >
            All
          </button>
          {Object.keys(CATEGORY_EVENTS).map((cat) => (
            <button
              key={cat}
              onClick={() => updateFilter(setCategoryFilter, categoryFilter === cat ? null : cat)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                categoryFilter === cat ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="overflow-hidden rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <p className="text-xs font-medium text-muted-foreground">
            Activity Feed ({filtered.length} events)
          </p>
        </div>
        <div className="divide-y">
          {pageItems.map((entry) => {
            const cat = getEventCategory(entry.eventType);
            const styles = SEVERITY_STYLES[entry.severity] ?? SEVERITY_STYLES.info;
            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 px-4 py-3"
              >
                <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${styles.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">
                      {getEventDescription(entry)}
                    </p>
                    <Badge variant="outline" className="text-[10px]">
                      {cat}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(entry.timestamp)}
                    {entry.actorName && ` · by ${entry.actorName}`}
                    {entry.actorRole && ` (${entry.actorRole})`}
                  </p>
                </div>
                <Badge variant={styles.variant} className="shrink-0 text-[10px]">
                  {entry.severity}
                </Badge>
              </div>
            );
          })}
          {pageItems.length === 0 && (
            <div className="py-16 text-center">
              <SignalIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">
                No activity matching your filters.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Page {safePage + 1} of {totalPages} ({filtered.length} events)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeftIcon className="mr-1 h-4 w-4" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <ChevronRightIcon className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
