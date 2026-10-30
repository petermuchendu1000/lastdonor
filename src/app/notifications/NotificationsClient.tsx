'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  BellIcon,
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ArchiveBoxIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
  TrashIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  XCircleIcon,
  CurrencyDollarIcon,
  ChatBubbleLeftIcon,
  FlagIcon,
  GiftIcon,
  DocumentCheckIcon,
  BanknotesIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  NoSymbolIcon,
  XMarkIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

// ─── Type → Icon + Semantic Color ───────────────────────────────────────────

type Severity = 'success' | 'warning' | 'info';

const TYPE_META: Record<string, { icon: React.ElementType; severity: Severity }> = {
  donation_refunded:          { icon: ArrowPathIcon,          severity: 'warning' },
  donation_refund_reversed:   { icon: ArrowUturnLeftIcon,     severity: 'success' },
  campaign_completed:         { icon: CheckCircleIcon,        severity: 'success' },
  campaign_archived:          { icon: ArchiveBoxIcon,         severity: 'info' },
  campaign_status_changed:    { icon: ExclamationCircleIcon,  severity: 'warning' },
  role_changed:               { icon: ShieldCheckIcon,        severity: 'info' },
  account_deleted:            { icon: TrashIcon,              severity: 'warning' },
  new_message:                { icon: ChatBubbleLeftIcon,     severity: 'info' },
  message_flagged:            { icon: FlagIcon,               severity: 'warning' },
  campaign_donation_received: { icon: GiftIcon,               severity: 'success' },
  campaign_milestone:         { icon: CheckCircleIcon,        severity: 'success' },  // Donor count milestones
  campaign_message_received:  { icon: EnvelopeIcon,           severity: 'info' },
  withdrawal_processed:       { icon: BanknotesIcon,          severity: 'success' },
  campaign_submitted:         { icon: DocumentCheckIcon,      severity: 'info' },
  campaign_paused:            { icon: PauseCircleIcon,        severity: 'warning' },
  campaign_resumed:           { icon: PlayCircleIcon,         severity: 'success' },
  campaign_suspended:         { icon: NoSymbolIcon,           severity: 'warning' },
  campaign_cancelled:         { icon: XMarkIcon,              severity: 'warning' },
  info_request:               { icon: ExclamationCircleIcon,  severity: 'warning' },
  info_request_reminder:      { icon: ClockIcon,              severity: 'warning' },
  milestone_approved:         { icon: CheckCircleIcon,        severity: 'success' },  // Legacy: renders historical notifications
  milestone_rejected:         { icon: XCircleIcon,            severity: 'warning' },  // Legacy: renders historical notifications
  fund_released:              { icon: CurrencyDollarIcon,     severity: 'success' },  // Legacy: renders historical notifications
  verification_approved:      { icon: ShieldCheckIcon,        severity: 'success' },
  verification_rejected:      { icon: XCircleIcon,            severity: 'warning' },
  bulk_refund_processed:      { icon: ArrowPathIcon,          severity: 'info' },
};

const SEVERITY_CLASSES: Record<Severity, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info:    'text-blue-600 dark:text-blue-400',
};

function getMeta(type: string) {
  return TYPE_META[type] ?? { icon: InformationCircleIcon, severity: 'info' as Severity };
}

// ─── Timestamp Formatting ───────────────────────────────────────────────────

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const ts = date.getTime();
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  if (ts >= todayStart) return `Today ${time}`;
  if (ts >= yesterdayStart) return `Yesterday ${time}`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${time}`;
}

// ─── Page Size Options ──────────────────────────────────────────────────────

const PAGE_SIZES = [10, 20, 50, 100];

// ─── Component ──────────────────────────────────────────────────────────────

export function NotificationsClient({
  notifications: initial,
  totalCount: _totalCount,
  unreadCount: initialUnread,
}: {
  notifications: Notification[];
  totalCount: number;
  unreadCount: number;
}) {
  const [items, setItems] = useState(initial);
  const [unreadCount, setUnreadCount] = useState(initialUnread);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);

  // ── Derived data ────────────────────────────────────────────────────────

  const filtered = useMemo(
    () => (unreadOnly ? items.filter((n) => !n.read) : items),
    [items, unreadOnly],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const rangeStart = safePage * pageSize + 1;
  const rangeEnd = Math.min((safePage + 1) * pageSize, filtered.length);

  // ── Actions ─────────────────────────────────────────────────────────────

  async function markAsRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch('/api/v1/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => toast.error('Failed to mark as read'));
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await fetch('/api/v1/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    }).catch(() => toast.error('Failed to mark all as read'));
  }

  function handlePageSizeChange(value: string) {
    setPageSize(Number(value));
    setPage(0);
  }

  function handleToggleUnread(checked: boolean) {
    setUnreadOnly(checked);
    setPage(0);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="mt-6">
      {/* ── Card ───────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-background shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: page size */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Show</span>
            <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="h-8 w-[70px]" aria-label="Show entries per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>entries</span>
          </div>

          {/* Right: toggle + mark all */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Only Show Unread</span>
              <Switch
                checked={unreadOnly}
                onCheckedChange={handleToggleUnread}
                aria-label="Only show unread notifications"
              />
            </label>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                Mark All as Read
              </button>
            )}
          </div>
        </div>

        {/* ── List ───────────────────────────────────────────────────── */}
        {pageItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <BellIcon className="h-7 w-7 text-muted-foreground/50" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              {unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            </p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              {unreadOnly
                ? 'You\u2019re all caught up!'
                : 'When there\u2019s activity on your campaigns or account, you\u2019ll see it here.'}
            </p>
            {!unreadOnly && (
              <Link
                href="/"
                className="mt-5 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Browse campaigns
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pageItems.map((n) => {
              const meta = getMeta(n.type);
              const Icon = meta.icon;

              return (
                <div
                  key={n.id}
                  className={cn(
                    'grid items-center gap-x-4 px-4 py-3.5 transition-colors sm:grid-cols-[40px_minmax(140px,1fr)_1fr_120px_100px]',
                    'grid-cols-[32px_1fr]',
                    !n.read && 'bg-primary/[0.02]',
                  )}
                >
                  {/* Icon */}
                  <div className="flex items-center justify-center sm:row-span-1">
                    <Icon
                      className={cn('h-6 w-6', SEVERITY_CLASSES[meta.severity])}
                      aria-hidden="true"
                    />
                  </div>

                  {/* Title */}
                  <p
                    className={cn(
                      'text-sm sm:col-span-1',
                      !n.read ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                    )}
                  >
                    {n.link ? (
                      <Link href={n.link} className="hover:underline" onClick={() => { if (!n.read) markAsRead(n.id); }}>
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </p>

                  {/* Message - hidden on mobile, shown below icon row */}
                  <p className="col-span-2 mt-1 text-sm text-muted-foreground line-clamp-2 sm:col-span-1 sm:mt-0">
                    {n.message}
                  </p>

                  {/* Timestamp */}
                  <span className="col-span-2 mt-1 text-xs text-muted-foreground/70 sm:col-span-1 sm:mt-0 sm:text-right">
                    {formatTimestamp(n.createdAt)}
                  </span>

                  {/* Action */}
                  <div className="col-span-2 mt-1 sm:col-span-1 sm:mt-0 sm:text-right">
                    {!n.read ? (
                      <button
                        type="button"
                        onClick={() => markAsRead(n.id)}
                        className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                      >
                        Mark as Read
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">Read</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Pagination footer ──────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Showing {rangeStart}–{rangeEnd} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Previous page"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span className="min-w-[4rem] text-center text-xs text-muted-foreground">
                Page {safePage + 1} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Next page"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
