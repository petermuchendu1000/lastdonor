'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { formatDate } from '@/lib/utils/dates';
import { ListCount } from '@/components/admin/ListCount';
import { toast } from 'sonner';
import {
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  MagnifyingGlassIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  EyeIcon,
  EyeSlashIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';

/* ─── Types ─── */

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  category: string;
  authorName: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
}

interface BlogPostsListProps {
  initialPosts: BlogPost[];
  counts: { total: number; published: number; draft: number };
  /*
    Whether the viewer may DELETE a post. An editor belongs on this screen -
    `blog` GET/POST and `blog/[id]` GET/PATCH all admit `['admin','editor']`,
    so they may write and publish - but `DELETE /api/v1/admin/blog/[id]` is
    `requireRole(['admin'])` (`blog/[id]/route.ts:178`). [VERIFIED by pressing
    it as an editor: 403, the post survived; as an admin: 200, the post was
    deleted.] `docs/134`.
  */
  isAdmin: boolean;
}

/* ─── Constants ─── */

const CATEGORY_LABELS: Record<string, string> = {
  campaign_story: 'Campaign Story',
  impact_report: 'Impact Report',
  news: 'News',
};

const PAGE_SIZE = 20;
type SortField = 'title' | 'category' | 'authorName' | 'createdAt';
type SortDir = 'asc' | 'desc';

/* ─── Component ─── */

export function BlogPostsList({ initialPosts, counts, isAdmin }: BlogPostsListProps) {
  /* Filters */
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');

  /* Sorting */
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  /* Pagination */
  const [page, setPage] = useState(1);

  /* Delete dialog */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* Publish toggling */
  const [togglingPublish, setTogglingPublish] = useState<string | null>(null);

  /* Posts state */
  const [posts, setPosts] = useState<BlogPost[]>(initialPosts);

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return posts.filter((post) => {
      if (categoryFilter !== 'all' && post.category !== categoryFilter) return false;
      if (statusFilter === 'published' && !post.published) return false;
      if (statusFilter === 'draft' && post.published) return false;
      if (q && !post.title.toLowerCase().includes(q) && !post.authorName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [posts, search, categoryFilter, statusFilter]);

  /* ── Sorting ── */
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'category':
          cmp = a.category.localeCompare(b.category);
          break;
        case 'authorName':
          cmp = a.authorName.localeCompare(b.authorName);
          break;
        case 'createdAt': {
          const dateA = a.publishedAt ?? a.createdAt;
          const dateB = b.publishedAt ?? b.createdAt;
          cmp = dateA.localeCompare(dateB);
          break;
        }
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
      setSortDir(field === 'createdAt' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUpIcon className="ml-1 inline h-3 w-3" />
      : <ChevronDownIcon className="ml-1 inline h-3 w-3" />;
  }

  /* ── Delete handler ── */
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/admin/blog/${deleteTarget.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        setPosts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        toast.success('Post deleted');
        setDeleteTarget(null);
      } else {
        toast.error(json.error?.message || 'Delete failed');
      }
    } catch {
      toast.error('Failed to delete post');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget]);

  /* ── Publish toggle handler ── */
  const handleTogglePublish = useCallback(async (post: BlogPost) => {
    setTogglingPublish(post.id);
    try {
      const res = await fetch(`/api/v1/admin/blog/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: !post.published }),
      });
      const json = await res.json();
      if (json.ok) {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === post.id
              ? { ...p, published: json.data.published, publishedAt: json.data.publishedAt }
              : p,
          ),
        );
        toast.success(json.data.published ? 'Post published' : 'Post unpublished');
      } else {
        toast.error(json.error?.message || 'Failed to update');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setTogglingPublish(null);
    }
  }, []);

  const hasActiveFilters = search !== '' || categoryFilter !== 'all' || statusFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setCategoryFilter('all');
    setStatusFilter('all');
    setPage(1);
  }

  return (
    <div className="space-y-4">

      {/* ── Status tiles ── */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'all' as const, label: 'All posts', count: counts.total },
          { key: 'published' as const, label: 'Published', count: counts.published },
          { key: 'draft' as const, label: 'Drafts', count: counts.draft },
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
            placeholder="Search title or author…"
            value={search}
            onChange={(e) => updateFilter(setSearch)(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Category filter */}
        <Select value={categoryFilter} onValueChange={updateFilter(setCategoryFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Filter posts by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="campaign_story">Campaign Story</SelectItem>
            <SelectItem value="impact_report">Impact Report</SelectItem>
            <SelectItem value="news">News</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            Clear filters
          </Button>
        )}

        {/* Result count + New Post */}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        <Link href="/admin/blog/new">
          <Button size="sm" className="h-8 text-xs">
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            New Post
          </Button>
        </Link>
      </div>

      {/* ── Data table ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <DocumentTextIcon className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No blog posts match your filters</p>
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
                  <button type="button" onClick={() => toggleSort('category')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Category<SortIcon field="category" />
                  </button>
                </th>
                <th className="hidden px-3 py-2 text-left md:table-cell">
                  <button type="button" onClick={() => toggleSort('authorName')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Author<SortIcon field="authorName" />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="font-semibold text-muted-foreground">Status</span>
                </th>
                <th className="hidden px-3 py-2 text-left lg:table-cell">
                  <button type="button" onClick={() => toggleSort('createdAt')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Date<SortIcon field="createdAt" />
                  </button>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.map((post) => (
                <tr key={post.id} className="transition-colors duration-100 hover:bg-muted/30">
                  <td className="max-w-xs px-3 py-3">
                    <Link href={`/admin/blog/${post.id}/edit`} className="line-clamp-1 font-medium text-foreground underline-offset-4 hover:underline">
                      {post.title}
                    </Link>
                  </td>
                  <td className="hidden px-3 py-3 sm:table-cell">
                    <Badge variant="outline" className="text-xs">{CATEGORY_LABELS[post.category] ?? post.category}</Badge>
                  </td>
                  <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">{post.authorName}</td>
                  <td className="px-3 py-3">
                    <Badge variant={post.published ? 'default' : 'secondary'} className="text-xs">
                      {post.published ? 'Published' : 'Draft'}
                    </Badge>
                  </td>
                  <td className="hidden px-3 py-3 lg:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {post.publishedAt ? formatDate(post.publishedAt) : formatDate(post.createdAt)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={togglingPublish === post.id}
                        onClick={() => handleTogglePublish(post)}
                        aria-label={post.published ? `Unpublish ${post.title}` : `Publish ${post.title}`}
                        title={post.published ? 'Unpublish' : 'Publish'}
                      >
                        {post.published
                          ? <EyeSlashIcon className="h-3.5 w-3.5" />
                          : <EyeIcon className="h-3.5 w-3.5" />}
                      </Button>
                      {post.published && (
                        <a
                          href={`/blog/${post.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-muted/50 hover:text-foreground"
                          title="View on site"
                        >
                          <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <Link
                        href={`/admin/blog/${post.id}/edit`}
                        className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-muted/50"
                      >
                        <PencilSquareIcon className="mr-1 h-3.5 w-3.5" />
                        Edit
                      </Link>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget({ id: post.id, title: post.title })}
                          aria-label={`Delete ${post.title}`}
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Count and pagination (docs/88 F16) ── */}
      {(sorted.length > 0 || counts.total > posts.length) && (
        <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
          <ListCount
            from={sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
            to={Math.min(safePage * PAGE_SIZE, sorted.length)}
            shown={sorted.length}
            loaded={posts.length}
            total={counts.total}
            noun="posts"
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

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete blog post</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.title}&rdquo;? This action cannot be undone.
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
    </div>
  );
}
