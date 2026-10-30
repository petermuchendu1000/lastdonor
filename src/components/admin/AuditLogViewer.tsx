'use client';

import { useState, Fragment } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { formatRelativeTime } from '@/lib/utils/dates';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  severity: string;
  details: Record<string, unknown> | null;
}

interface AuditLogViewerProps {
  entries: AuditLogEntry[];
  eventTypes: string[];
  hasMore: boolean;
  cursor: string | null;
}

const SEVERITY_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warning: 'outline',
  error: 'destructive',
  critical: 'destructive',
};

export function AuditLogViewer({
  entries: initialEntries,
  eventTypes,
  hasMore: initialHasMore,
  cursor: initialCursor,
}: AuditLogViewerProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ cursor, limit: '50' });
      if (eventFilter !== 'all') params.set('eventType', eventFilter);
      const res = await fetch(`/api/v1/admin/audit-log?${params}`);
      if (!res.ok) {
        toast.error('Failed to load more entries');
        return;
      }
      const body = await res.json();
      setEntries((prev) => [...prev, ...body.data]);
      setHasMore(body.meta?.hasMore ?? false);
      setCursor(body.meta?.cursor ?? null);
    } catch {
      toast.error('Network error loading audit log');
    } finally {
      setLoading(false);
    }
  }

  const filtered = (() => {
    let result = eventFilter === 'all'
      ? entries
      : entries.filter((e) => e.eventType === eventFilter);

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) =>
        e.eventType.toLowerCase().includes(q) ||
        (e.actorId?.toLowerCase().includes(q) ?? false) ||
        (e.targetId?.toLowerCase().includes(q) ?? false) ||
        (e.targetType?.toLowerCase().includes(q) ?? false)
      );
    }

    return result;
  })();

  return (
    <div className="space-y-4">
      {/* CDS Toolbar */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events, actors, targets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search audit log"
          />
        </div>
        <Select value={eventFilter} onValueChange={setEventFilter}>
          <SelectTrigger className="w-56 bg-background">
            <SelectValue placeholder="Filter by event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {eventTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{filtered.length} entries</p>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <ClipboardDocumentListIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No audit log entries found.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Time</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Event</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">Actor</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground md:table-cell">Target</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((entry) => {
                  const expanded = expandedIds.has(entry.id);
                  return (
                    <Fragment key={entry.id}>
                      <tr
                        className="cursor-pointer hover:bg-muted/30"
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleExpanded(entry.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(entry.id); } }}
                      >
                        <td className="px-2 py-2.5">
                          {entry.details ? (
                            expanded ? (
                              <ChevronDownIcon className="h-4 w-4" />
                            ) : (
                              <ChevronRightIcon className="h-4 w-4" />
                            )
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                          {formatRelativeTime(entry.timestamp)}
                        </td>
                        <td className="px-4 py-2.5">
                          <code className="text-xs">{entry.eventType}</code>
                        </td>
                        <td className="hidden px-4 py-2.5 sm:table-cell">
                          {entry.actorId ? (
                            <span className="text-sm">
                              {entry.actorId.slice(0, 8)}…
                              {entry.actorRole && (
                                <Badge variant="outline" className="ml-1">{entry.actorRole}</Badge>
                              )}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">system</span>
                          )}
                        </td>
                        <td className="hidden px-4 py-2.5 md:table-cell">
                          {entry.targetType && entry.targetId
                            ? `${entry.targetType}:${entry.targetId.slice(0, 8)}…`
                            : '-'}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={SEVERITY_VARIANT[entry.severity] ?? 'secondary'}>{entry.severity}</Badge>
                        </td>
                      </tr>
                      {expanded && entry.details && (
                        <tr>
                          <td colSpan={6} className="bg-muted/50 px-4 py-2">
                            <pre className="max-h-48 relative overflow-auto whitespace-pre-wrap text-xs">
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load More'}
          </Button>
        </div>
      )}
    </div>
  );
}
