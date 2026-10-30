'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ListCount } from '@/components/admin/ListCount';
import {
  MagnifyingGlassIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  QueueListIcon,
  BoltIcon,
  SparklesIcon,
  XCircleIcon,
  TrashIcon,
  ArrowPathIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';

/* ─── Types ─── */

interface Topic {
  id: string;
  title: string;
  slug: string;
  primaryKeyword: string;
  causeCategory: string | null;
  priorityScore: number;
  seasonalBoost: number;
  status: string;
  newsHook: string | null;
  createdAt: string;
  generatedPostId: string | null;
}

interface TopicQueueListProps {
  topics: Topic[];
  counts: Record<string, number>;
  /*
    Whether the viewer may DELETE a topic. An editor belongs here - `topics`
    GET/POST and `topics/[id]` PATCH admit `['admin','editor']`, so they may
    add, boost, generate, reject and restore - but
    `DELETE /api/v1/admin/blog/topics/[id]` is `requireRole(['admin'])`
    (`topics/[id]/route.ts:125`). [VERIFIED by pressing it as an editor: 403,
    the topic survived; as an admin: 200, deleted.] `docs/134`.
  */
  isAdmin: boolean;
}

/* ─── Constants ─── */

const PAGE_SIZE = 25;
type SortField = 'title' | 'priorityScore' | 'status' | 'createdAt';
type SortDir = 'asc' | 'desc';

const STATUS_KEYS = ['all', 'pending', 'generating', 'generated', 'published', 'rejected', 'stale'] as const;

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'outline',
  generating: 'secondary',
  generated: 'default',
  published: 'default',
  rejected: 'destructive',
  stale: 'secondary',
};

/* Allowed actions per status */
const STATUS_ACTIONS: Record<string, string[]> = {
  pending: ['generate', 'boost', 'reject', 'delete'],
  stale: ['generate', 'boost', 'reject', 'delete'],
  generating: [],
  generated: ['delete'],
  published: ['delete'],
  rejected: ['restore', 'delete'],
};

/* ─── Component ─── */

export function TopicQueueList({ topics: initialTopics, counts, isAdmin }: TopicQueueListProps) {
  /* State */
  const [topics, setTopics] = useState(initialTopics);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('priorityScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  /* Reject dialog with reason */
  const [rejectTarget, setRejectTarget] = useState<{ id: string; title: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  /* Delete dialog */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* Add topic dialog */
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', primaryKeyword: '', causeCategory: '' });
  const [adding, setAdding] = useState(false);

  /* Derive unique categories from data */
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of topics) {
      if (t.causeCategory) set.add(t.causeCategory);
    }
    return [...set].sort();
  }, [topics]);

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return topics.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && t.causeCategory !== categoryFilter) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.primaryKeyword.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [topics, search, statusFilter, categoryFilter]);

  /* ── Sorting ── */
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'priorityScore':
          cmp = a.priorityScore - b.priorityScore;
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'createdAt':
          cmp = a.createdAt.localeCompare(b.createdAt);
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

  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  /* ── Sorting toggle ── */
  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'priorityScore' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUpIcon className="ml-1 inline h-3 w-3" />
      : <ChevronDownIcon className="ml-1 inline h-3 w-3" />;
  }

  /* ── Inline actions (generate, boost, restore) ── */
  const handleAction = useCallback(async (topicId: string, action: 'generate' | 'boost' | 'restore') => {
    setActionLoading(topicId);
    try {
      const body: Record<string, unknown> = action === 'restore'
        ? { status: 'pending' }
        : { action };

      const res = await fetch(`/api/v1/admin/blog/topics/${topicId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setTopics((prev) =>
          prev.map((t) => (t.id === topicId ? { ...t, ...data.data } : t)),
        );
        const labels: Record<string, string> = {
          generate: 'Generation started',
          boost: 'Priority boosted',
          restore: 'Topic restored to pending',
        };
        toast.success(labels[action]);
      } else {
        const errBody = await res.json().catch(() => null);
        toast.error(errBody?.error?.message || 'Action failed');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setActionLoading(null);
    }
  }, []);

  /* ── Reject with reason ── */
  const handleReject = useCallback(async () => {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/v1/admin/blog/topics/${rejectTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason: rejectReason.trim() || undefined }),
      });

      if (res.ok) {
        const data = await res.json();
        setTopics((prev) =>
          prev.map((t) => (t.id === rejectTarget.id ? { ...t, ...data.data } : t)),
        );
        toast.success('Topic rejected');
        setRejectTarget(null);
        setRejectReason('');
      } else {
        toast.error('Reject failed');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setRejecting(false);
    }
  }, [rejectTarget, rejectReason]);

  /* ── Delete topic ── */
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/admin/blog/topics/${deleteTarget.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        setTopics((prev) => prev.filter((t) => t.id !== deleteTarget.id));
        toast.success('Topic deleted');
        setDeleteTarget(null);
      } else {
        toast.error(json.error?.message || 'Delete failed');
      }
    } catch {
      toast.error('Failed to delete topic');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget]);

  /* ── Add manual topic ── */
  const handleAddTopic = useCallback(async () => {
    if (!addForm.title.trim() || !addForm.primaryKeyword.trim()) {
      toast.error('Title and primary keyword are required');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/v1/admin/blog/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: addForm.title.trim(),
          primaryKeyword: addForm.primaryKeyword.trim(),
          causeCategory: addForm.causeCategory.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setTopics((prev) => [
          {
            ...json.data,
            createdAt: json.data.createdAt,
            generatedPostId: json.data.generatedPostId ?? null,
          },
          ...prev,
        ]);
        toast.success('Topic added');
        setShowAddDialog(false);
        setAddForm({ title: '', primaryKeyword: '', causeCategory: '' });
      } else {
        toast.error(json.error?.message || 'Failed to add topic');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setAdding(false);
    }
  }, [addForm]);

  const hasActiveFilters = search !== '' || statusFilter !== 'all' || categoryFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setPage(1);
  }

  /* Helper: which actions are available for a topic */
  function getActions(topic: Topic) {
    return STATUS_ACTIONS[topic.status] ?? [];
  }

  return (
    <div className="space-y-4">

      {/* ── Status tiles ── */}
      <div className="flex flex-wrap gap-2">
        {STATUS_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => updateFilter(setStatusFilter)(key)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-100 ${
              statusFilter === key
                ? 'border-primary/40 bg-primary/5 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <span className="block text-lg font-semibold tabular-nums leading-none">
              {key === 'all' ? counts.total ?? 0 : counts[key] ?? 0}
            </span>
            <span className="mt-0.5 block text-xs capitalize">{key === 'all' ? 'All topics' : key}</span>
          </button>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <div className="relative min-w-[200px] flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search title or keyword…"
            value={search}
            onChange={(e) => updateFilter(setSearch)(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {categories.length > 0 && (
          <Select value={categoryFilter} onValueChange={updateFilter(setCategoryFilter)}>
            <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Filter topics by category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            Clear filters
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        <Button size="sm" className="h-8 text-xs" onClick={() => setShowAddDialog(true)}>
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          Add Topic
        </Button>
      </div>

      {/* ── Data table ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <QueueListIcon className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No topics match your filters</p>
          {hasActiveFilters && (
            <Button variant="link" size="sm" className="mt-1 text-xs" onClick={clearFilters}>
              Clear all filters
            </Button>
          )}
        </div>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 text-left">
                  <button type="button" onClick={() => toggleSort('title')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Title<SortIcon field="title" />
                  </button>
                </th>
                <th className="hidden px-3 py-2 text-left sm:table-cell">
                  <span className="font-semibold text-muted-foreground">Keyword</span>
                </th>
                <th className="hidden px-3 py-2 text-left md:table-cell">
                  <span className="font-semibold text-muted-foreground">Category</span>
                </th>
                <th className="px-3 py-2 text-left">
                  <button type="button" onClick={() => toggleSort('priorityScore')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Priority<SortIcon field="priorityScore" />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <button type="button" onClick={() => toggleSort('status')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Status<SortIcon field="status" />
                  </button>
                </th>
                <th className="hidden px-3 py-2 text-left lg:table-cell">
                  <button type="button" onClick={() => toggleSort('createdAt')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Added<SortIcon field="createdAt" />
                  </button>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.map((topic) => {
                const actions = getActions(topic);
                const isLoading = actionLoading === topic.id;

                return (
                  <tr key={topic.id} className="transition-colors duration-100 hover:bg-muted/30">
                    {/* Title + news hook */}
                    <td className="max-w-xs px-3 py-3">
                      <span className="line-clamp-1 font-medium text-foreground">{topic.title}</span>
                      {topic.newsHook && (
                        <span className="mt-0.5 block text-xs text-amber-600" title={topic.newsHook}>
                          News hook
                        </span>
                      )}
                    </td>

                    {/* Primary keyword */}
                    <td className="hidden px-3 py-3 sm:table-cell">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{topic.primaryKeyword}</code>
                    </td>

                    {/* Cause category */}
                    <td className="hidden px-3 py-3 md:table-cell">
                      {topic.causeCategory ? (
                        <Badge variant="outline" className="text-xs">{topic.causeCategory}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>

                    {/* Priority score */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold tabular-nums">{topic.priorityScore}</span>
                        {topic.seasonalBoost > 0 && (
                          <span className="text-xs text-amber-600">+{topic.seasonalBoost}</span>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3">
                      <Badge variant={STATUS_VARIANT[topic.status] ?? 'outline'} className="text-xs capitalize">
                        {topic.status}
                      </Badge>
                    </td>

                    {/* Created */}
                    <td className="hidden px-3 py-3 lg:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {new Date(topic.createdAt).toLocaleDateString()}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {actions.includes('generate') && (
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={isLoading}
                            onClick={() => handleAction(topic.id, 'generate')}
                          >
                            <SparklesIcon className="mr-1 h-3.5 w-3.5" />
                            {isLoading ? 'Processing…' : 'Generate'}
                          </Button>
                        )}
                        {actions.includes('boost') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={isLoading}
                            onClick={() => handleAction(topic.id, 'boost')}
                          >
                            <BoltIcon className="mr-1 h-3.5 w-3.5" />
                            Boost
                          </Button>
                        )}
                        {actions.includes('restore') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={isLoading}
                            onClick={() => handleAction(topic.id, 'restore')}
                          >
                            <ArrowPathIcon className="mr-1 h-3.5 w-3.5" />
                            Restore
                          </Button>
                        )}
                        {actions.includes('reject') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            disabled={isLoading}
                            onClick={() => setRejectTarget({ id: topic.id, title: topic.title })}
                            aria-label={`Reject ${topic.title}`}
                          >
                            <XCircleIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {/*
                          The role joins the per-status action test in ONE
                          condition - the same question, asked once.
                          `docs/134`.
                        */}
                        {isAdmin && actions.includes('delete') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            disabled={isLoading}
                            onClick={() => setDeleteTarget({ id: topic.id, title: topic.title })}
                            aria-label={`Delete ${topic.title}`}
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {topic.generatedPostId && (
                          <Link
                            href={`/admin/blog/${topic.generatedPostId}/edit`}
                            className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-muted/50"
                          >
                            View post
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Count and pagination (docs/88 F16) ── */}
      {(sorted.length > 0 || (counts.total ?? 0) > topics.length) && (
        <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
          <ListCount
            from={sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
            to={Math.min(safePage * PAGE_SIZE, sorted.length)}
            shown={sorted.length}
            loaded={topics.length}
            total={counts.total ?? 0}
            noun="topics"
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

      {/* ── Reject confirmation dialog (with reason) ── */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject topic</DialogTitle>
            <DialogDescription>
              Are you sure you want to reject &ldquo;{rejectTarget?.title}&rdquo;? Rejected topics will not be used for generation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              placeholder="Why are you rejecting this topic?"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(''); }} disabled={rejecting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejecting}>
              {rejecting ? 'Rejecting…' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete topic</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete &ldquo;{deleteTarget?.title}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add topic dialog ── */}
      <Dialog open={showAddDialog} onOpenChange={(open) => { if (!open) { setShowAddDialog(false); setAddForm({ title: '', primaryKeyword: '', causeCategory: '' }); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add manual topic</DialogTitle>
            <DialogDescription>
              Create a new blog topic for the content pipeline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="add-title">Title *</Label>
              <Input
                id="add-title"
                placeholder="e.g. How to Support Veterans in Your Community"
                value={addForm.title}
                onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-keyword">Primary keyword *</Label>
              <Input
                id="add-keyword"
                placeholder="e.g. support veterans community"
                value={addForm.primaryKeyword}
                onChange={(e) => setAddForm((f) => ({ ...f, primaryKeyword: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-category">Cause category</Label>
              <Input
                id="add-category"
                placeholder="e.g. veterans, medical, education"
                value={addForm.causeCategory}
                onChange={(e) => setAddForm((f) => ({ ...f, causeCategory: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddDialog(false); setAddForm({ title: '', primaryKeyword: '', causeCategory: '' }); }} disabled={adding}>
              Cancel
            </Button>
            <Button onClick={handleAddTopic} disabled={adding || !addForm.title.trim() || !addForm.primaryKeyword.trim()}>
              {adding ? 'Adding…' : 'Add Topic'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
