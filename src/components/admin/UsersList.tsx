'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatMoney } from '@/lib/money/format';
import type { CurrencyTotal } from '@/lib/admin/donation-totals.server';
import { formatDate } from '@/lib/utils/dates';
import { ListCount } from '@/components/admin/ListCount';
import { toast } from 'sonner';
import {
  MagnifyingGlassIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

/* ─── Types ─── */

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role: 'donor' | 'editor' | 'admin';
  /**
   * What this person has given, PER CURRENCY.
   *
   * ⛔ Was `users.total_donated`, a single integer with no currency dimension
   * (`payment-service.ts:307` adds every donation's raw amount to it whatever
   * rail it came over). For a donor across two currencies it is a number in
   * neither, and this column printed it with a dollar sign (`docs/92`).
   */
  donationTotals: CurrencyTotal[];
  campaignsSupported: number;
  lastDonorCount: number;
  createdAt: string;
  avatarUrl: string | null;
}

interface UsersListProps {
  initialUsers: UserRow[];
  roleBreakdown: Record<string, number>;
  totalUsers: number;
}

/* ─── Constants ─── */

const PAGE_SIZE = 25;
type SortField = 'name' | 'role' | 'totalDonated' | 'campaignsSupported' | 'createdAt';
type SortDir = 'asc' | 'desc';

const ROLE_KEYS = ['all', 'admin', 'editor', 'donor'] as const;

const ROLE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  admin: 'destructive',
  editor: 'default',
  donor: 'outline',
};

function getInitials(name: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ─── Component ─── */

export function UsersList({ initialUsers, roleBreakdown, totalUsers }: UsersListProps) {
  const [users, setUsers] = useState(initialUsers);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  /* Dialog state */
  const [roleTarget, setRoleTarget] = useState<{ user: UserRow; newRole: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /* ── Role change ── */
  const handleRoleChange = useCallback(async () => {
    if (!roleTarget) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${roleTarget.user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleTarget.newRole }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body?.error?.code === 'VALIDATION_ERROR' ? (body?.error?.message ?? 'Failed to change role') : 'Failed to change role');
        return;
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === roleTarget.user.id ? { ...u, role: roleTarget.newRole as UserRow['role'] } : u)),
      );
      toast.success(`Role changed to ${roleTarget.newRole}`);
      setRoleTarget(null);
    } finally {
      setActionLoading(false);
    }
  }, [roleTarget]);

  /* ── Delete user ── */
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${deleteTarget.id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body?.error?.code === 'VALIDATION_ERROR' ? (body?.error?.message ?? 'Failed to delete user') : 'Failed to delete user');
        return;
      }
      /*
        ⛔ The row SURVIVES now, so it must not be removed from the list.

        Account removal anonymises in place (`docs/124`): the `users` row is
        kept carrying an opaque id so the 31 `NO ACTION` foreign keys that
        point at it stay valid. Filtering it out told the administrator it was
        gone and then it reappeared as "Deleted User" on the next load. Same
        class as `docs/122` §2 - the admin UI asserting an outcome the route
        did not report.
      */
      setUsers((prev) =>
        prev.map((u) =>
          u.id === deleteTarget.id
            ? { ...u, name: 'Deleted User', email: `deleted-${u.id}@lastdonor.org` }
            : u,
        ),
      );
      toast.success(
        typeof body?.data?.reason === 'string'
          ? body.data.reason
          : 'Personal identifiers removed.',
      );
      setDeleteTarget(null);
    } finally {
      setActionLoading(false);
    }
  }, [deleteTarget]);

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (q && !u.email.toLowerCase().includes(q) && !(u.name && u.name.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [users, search, roleFilter]);

  /* ── Sorting ── */
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = (a.name ?? '').localeCompare(b.name ?? ''); break;
        case 'role': cmp = a.role.localeCompare(b.role); break;
        /*
          ⛔ Sorted by the NUMBER of donations, not the amount. Amounts in
          different currencies are not orderable without an exchange rate,
          and `docs/102` forbids a rate deciding anything but display - so
          this column orders by the one figure that is comparable.
        */
        case 'totalDonated':
          cmp = a.donationTotals.reduce((n, t) => n + t.donationCount, 0)
              - b.donationTotals.reduce((n, t) => n + t.donationCount, 0);
          break;
        case 'campaignsSupported': cmp = a.campaignsSupported - b.campaignsSupported; break;
        case 'createdAt': cmp = a.createdAt.localeCompare(b.createdAt); break;
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

  /* ── Sort toggle ── */
  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'totalDonated' || field === 'campaignsSupported' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUpIcon className="ml-1 inline h-3 w-3" />
      : <ChevronDownIcon className="ml-1 inline h-3 w-3" />;
  }

  const hasActiveFilters = search !== '' || roleFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setRoleFilter('all');
    setPage(1);
  }

  return (
    <div className="space-y-4">

      {/* ── Role tiles ── */}
      <div className="flex flex-wrap gap-2">
        {ROLE_KEYS.map((key) => {
          const isActive = roleFilter === key;
          const value = key === 'all' ? totalUsers : roleBreakdown[key] ?? 0;
          const label = key === 'all' ? 'All users' : `${key.charAt(0).toUpperCase() + key.slice(1)}s`;
          return (
            <button
              key={key}
              type="button"
              onClick={() => updateFilter(setRoleFilter)(key)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-100 ${
                isActive
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <span className="block text-lg font-semibold tabular-nums leading-none">{value}</span>
              <span className="mt-0.5 block text-xs">{label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <div className="relative min-w-[200px] flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => updateFilter(setSearch)(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search users"
          />
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            Clear filters
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Data table ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <UserGroupIcon className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No users match your filters</p>
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
                  <button type="button" onClick={() => toggleSort('name')} className="font-semibold text-muted-foreground hover:text-foreground">
                    User<SortIcon field="name" />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <button type="button" onClick={() => toggleSort('role')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Role<SortIcon field="role" />
                  </button>
                </th>
                <th className="hidden px-3 py-2 text-right md:table-cell">
                  <button type="button" onClick={() => toggleSort('totalDonated')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Total Donated<SortIcon field="totalDonated" />
                  </button>
                </th>
                <th className="hidden px-3 py-2 text-right md:table-cell">
                  <button type="button" onClick={() => toggleSort('campaignsSupported')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Campaigns<SortIcon field="campaignsSupported" />
                  </button>
                </th>
                <th className="hidden px-3 py-2 text-right lg:table-cell">
                  <span className="font-semibold text-muted-foreground">LDZ Wins</span>
                </th>
                <th className="hidden px-3 py-2 text-left lg:table-cell">
                  <button type="button" onClick={() => toggleSort('createdAt')} className="font-semibold text-muted-foreground hover:text-foreground">
                    Joined<SortIcon field="createdAt" />
                  </button>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.map((u) => (
                <tr key={u.id} className="transition-colors duration-100 hover:bg-muted/30">
                  <td className="px-3 py-3">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="flex items-center gap-3 hover:opacity-80"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name ?? 'User'} />
                        <AvatarFallback className="bg-muted text-xs font-semibold">
                          {getInitials(u.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {u.name ?? 'Unnamed'}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={ROLE_VARIANT[u.role] ?? 'secondary'}>
                      {u.role}
                    </Badge>
                  </td>
                  <td className="hidden px-3 py-3 text-right font-mono tabular-nums md:table-cell">
                    {u.donationTotals.length === 0
                      ? '-'
                      : u.donationTotals.map((t) => (
                          <span key={t.currency} className="block">
                            {formatMoney(t.totalMinor, t.currency, 'exact')}
                          </span>
                        ))}
                  </td>
                  <td className="hidden px-3 py-3 text-right tabular-nums md:table-cell">{u.campaignsSupported}</td>
                  <td className="hidden px-3 py-3 text-right tabular-nums lg:table-cell">{u.lastDonorCount}</td>
                  <td className="hidden px-3 py-3 lg:table-cell">
                    <span className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          aria-label={`Actions for ${u.name ?? u.email}`}
                        >
                          <EllipsisVerticalIcon className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/users/${u.id}`}>View Details</Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Change Role</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {(['donor', 'editor', 'admin'] as const)
                              .filter((r) => r !== u.role)
                              .map((r) => (
                                <DropdownMenuItem
                                  key={r}
                                  onClick={() => setRoleTarget({ user: u, newRole: r })}
                                >
                                  {r.charAt(0).toUpperCase() + r.slice(1)}
                                </DropdownMenuItem>
                              ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleteTarget(u)}
                        >
                          Delete User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Count and pagination (docs/88 F16).

        The count renders whenever there is anything to say, not only
        when there is more than one page: with 238 users and a role
        filter selecting 3 of the loaded 200, there is one page and the
        reader still needs to know the other 38 were never fetched.
      */}
      {(sorted.length > 0 || totalUsers > users.length) && (
        <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
          <ListCount
            from={sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
            to={Math.min(safePage * PAGE_SIZE, sorted.length)}
            shown={sorted.length}
            loaded={users.length}
            total={totalUsers}
            noun="users"
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

      {/* ── Role change confirmation ── */}
      <Dialog open={!!roleTarget} onOpenChange={() => { setRoleTarget(null); setActionError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change User Role</DialogTitle>
            <DialogDescription>
              Change {roleTarget?.user.name ?? roleTarget?.user.email}&apos;s role from{' '}
              <strong>{roleTarget?.user.role}</strong> to{' '}
              <strong>{roleTarget?.newRole}</strong>?
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRoleTarget(null); setActionError(null); }} disabled={actionLoading}>
              Cancel
            </Button>
            <Button onClick={handleRoleChange} disabled={actionLoading}>
              {actionLoading ? 'Updating…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => { setDeleteTarget(null); setActionError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this person&rsquo;s details</DialogTitle>
            <DialogDescription>
              {/*
                One outcome, so one sentence. This used to branch on donation
                history and promise a hard delete ("This action cannot be
                undone") when there was none - and neither branch of the route
                worked: the anonymise one wrote null into two NOT NULL columns
                and threw, the delete one hit a foreign key. `docs/124`.
              */}
              Remove {deleteTarget?.name ?? deleteTarget?.email}? Their name, email
              address and phone number are deleted. The account row and the
              financial records that reference it are kept, with the person
              removed from them. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setActionError(null); }} disabled={actionLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={actionLoading}>
              {actionLoading ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


