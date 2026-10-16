'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { BellIcon } from '@heroicons/react/24/outline';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ArchiveBoxIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
  TrashIcon,
  DocumentPlusIcon,
} from '@heroicons/react/24/outline';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { playNotificationSound } from '@/lib/notification-sound';

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

// ─── Type → Icon mapping ────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  donation_refunded:        { icon: ArrowPathIcon,        color: 'text-amber-500' },
  donation_refund_reversed: { icon: ArrowUturnLeftIcon,   color: 'text-emerald-500' },
  campaign_completed:       { icon: CheckCircleIcon,      color: 'text-emerald-500' },
  campaign_archived:        { icon: ArchiveBoxIcon,       color: 'text-muted-foreground' },
  campaign_status_changed:  { icon: ExclamationCircleIcon, color: 'text-amber-500' },
  role_changed:             { icon: ShieldCheckIcon,      color: 'text-blue-500' },
  account_deleted:          { icon: TrashIcon,            color: 'text-destructive' },
  campaign_submitted:       { icon: DocumentPlusIcon,     color: 'text-blue-500' },
};

const DEFAULT_TYPE_CONFIG = { icon: InformationCircleIcon, color: 'text-muted-foreground' };

// ─── Timestamp ──────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

// ─── Module-level singleton store ───────────────────────────────────────────
// Ensures only ONE polling loop runs even if multiple <NotificationBell />
// instances are mounted (e.g. desktop + mobile nav).

interface NotifState {
  notifications: Notification[];
  unreadCount: number;
}

let _state: NotifState = { notifications: [], unreadCount: 0 };
const _listeners = new Set<() => void>();
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _subscriberCount = 0;
let _prevUnread = -1; // -1 sentinel: don't chime on first load
let _lastFetchTs = 0;

function _emit() {
  _listeners.forEach((l) => l());
}

function _setState(next: NotifState) {
  _state = next;
  _emit();
}

async function _fetchNotifications() {
  try {
    const res = await fetch('/api/v1/notifications?limit=30');
    if (!res.ok) return;
    const json = await res.json();
    if (json.ok) {
      const newCount = json.data.unreadCount as number;
      if (newCount > _prevUnread && _prevUnread !== -1) {
        playNotificationSound();
      }
      _prevUnread = newCount;
      _lastFetchTs = Date.now();
      _setState({
        notifications: json.data.notifications,
        unreadCount: newCount,
      });
    }
  } catch {
    // Silently fail
  }
}

function _startPolling() {
  if (_intervalId) return;
  _fetchNotifications();
  _intervalId = setInterval(_fetchNotifications, 60_000);
}

function _stopPolling() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

function _subscribe(listener: () => void) {
  _listeners.add(listener);
  _subscriberCount++;
  if (_subscriberCount === 1) _startPolling();
  return () => {
    _listeners.delete(listener);
    _subscriberCount--;
    if (_subscriberCount === 0) _stopPolling();
  };
}

function _getSnapshot() {
  return _state;
}

function _refreshIfStale() {
  if (Date.now() - _lastFetchTs > 10_000) {
    _fetchNotifications();
  }
}

function _markAsRead(id: string) {
  _setState({
    ..._state,
    notifications: _state.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    ),
    unreadCount: Math.max(0, _state.unreadCount - 1),
  });
  _prevUnread = Math.max(0, _state.unreadCount);
  fetch('/api/v1/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  }).catch(() => {});
}

function _markAllRead() {
  _setState({
    ..._state,
    notifications: _state.notifications.map((n) => ({ ...n, read: true })),
    unreadCount: 0,
  });
  _prevUnread = 0;
  fetch('/api/v1/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markAllRead: true }),
  }).catch(() => {});
}

function _clearAll() {
  _setState({ notifications: [], unreadCount: 0 });
  _prevUnread = 0;
  fetch('/api/v1/notifications', { method: 'DELETE' }).catch(() => {});
}

// ─── Shared read for the avatar badge ───────────────────────────────────────

/**
 * Unread count, for surfaces that show the badge without owning the bell.
 *
 * The navbar no longer renders a bell: the count sits on the avatar and the
 * list moved into the account menu, which gives a 36px tap target back on a
 * phone (docs/68). `UserNav` reads the count through this hook, so there is
 * still exactly one poller and one piece of state.
 *
 * Subscribing is what starts the poller (`_subscribe` ref-counts it), so a
 * surface that only wants the number gets live data without mounting the
 * bell.
 */
export function useUnreadNotificationCount(): number {
  const { status } = useSession();
  const { unreadCount } = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);

  // Mirrors the bell's own effect exactly: `_subscribe` already starts the
  // poller on the first subscriber and stops it on the last, so this only
  // has to stop it when the session goes away. Calling `_startPolling` here
  // as well would be redundant, and returning `_stopPolling` from the
  // cleanup would fight the ref-count when both this hook and the bell are
  // mounted.
  useEffect(() => {
    if (status !== 'authenticated') {
      _stopPolling();
    }
  }, [status]);

  return unreadCount;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NotificationBell() {
  const { status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Subscribe to the shared notification store (singleton polling)
  const { notifications, unreadCount } = useSyncExternalStore(
    _subscribe,
    _getSnapshot,
    _getSnapshot,
  );

  // Start/stop polling based on auth status
  useEffect(() => {
    if (status !== 'authenticated') {
      _stopPolling();
    }
  }, [status]);

  // Refresh on popover open if stale
  useEffect(() => {
    if (open) _refreshIfStale();
  }, [open]);

  const handleNotificationClick = (n: Notification) => {
    if (!n.read) _markAsRead(n.id);
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  };

  if (status !== 'authenticated') return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BellIcon className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-96 p-0 shadow-lg">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-bold text-foreground">Notifications</h3>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={_markAllRead}
                className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                Mark all as read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={_clearAll}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* ── Notification list ──────────────────────────────────── */}
        <div className="max-h-[420px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <BellIcon className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">No notifications yet</p>
              <p className="mt-1 text-xs">We&apos;ll let you know when something happens</p>
            </div>
          ) : (
            notifications.map((n) => {
              const { icon: Icon, color: iconColor } = TYPE_CONFIG[n.type] ?? DEFAULT_TYPE_CONFIG;

              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleNotificationClick(n)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/50 last:border-b-0',
                    !n.read && 'bg-primary/[0.03]',
                  )}
                >
                  {/* Icon */}
                  <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted', iconColor)}>
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      'text-sm leading-snug',
                      !n.read ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                    )}>
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                      {n.message}
                    </p>
                    <span className="mt-1 block text-[11px] text-muted-foreground/60">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>

                  {/* Unread dot */}
                  {!n.read && (
                    <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
