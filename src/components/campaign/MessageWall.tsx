'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { formatRelativeTime } from '@/lib/utils/dates';
import { cn } from '@/lib/utils';
import { useMessageWallRegister } from './MessageWallContext';
import { usePollingList } from '@/hooks/usePollingList';

export interface MessageItem {
  id: string;
  donorName: string;
  donorLocation: string | null;
  message: string;
  isAnonymous: boolean;
  createdAt: string;
}

interface MessageWallProps {
  campaignSlug: string;
  initialMessages: MessageItem[];
  className?: string;
}

const POLL_INTERVAL_MS = 30_000;
const PAGE_SIZE = 20;
const MESSAGE_TRUNCATE_LENGTH = 200;

const getMessageId = (m: MessageItem) => m.id;

export function MessageWall({
  campaignSlug,
  initialMessages,
  className,
}: MessageWallProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const buildUrl = useCallback(
    ({ cursor }: { cursor?: number }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor != null) params.set('cursor', String(cursor));
      return `/api/v1/campaigns/${encodeURIComponent(campaignSlug)}/messages?${params}`;
    },
    [campaignSlug],
  );

  const { items: messages, loading, hasMore, loadMore, addOptimistic } = usePollingList(
    initialMessages,
    {
      buildUrl,
      pollIntervalMs: POLL_INTERVAL_MS,
      getId: getMessageId,
      // The campaign page is ISR-cached (revalidate = 60) and no write path can
      // invalidate that cache on every instance, so `initialMessages` may be
      // from a render taken before the reader's own message existed. Without
      // this the first fetch is 30s away and a donor who reloads is told "No
      // messages yet", concludes their message to a seriously ill person was
      // lost, and posts again or gives up. See docs/43.
      syncOnMount: true,
    },
  );

  // Register optimistic add with context so MessageForm can call it
  const registerWall = useMessageWallRegister();
  useEffect(() => {
    registerWall?.(addOptimistic);
  }, [registerWall, addOptimistic]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={cn('space-y-4', className)}>
      <h3 className="font-display text-lg font-semibold text-card-foreground">
        Messages of Support
      </h3>

      <div aria-live="polite" aria-atomic="false" className="space-y-3">
        {messages.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No messages yet. Be the first to leave a message of support!
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              const isLong = msg.message.length > MESSAGE_TRUNCATE_LENGTH;
              const expanded = expandedIds.has(msg.id);
              const displayText = isLong && !expanded
                ? msg.message.slice(0, MESSAGE_TRUNCATE_LENGTH) + '…'
                : msg.message;

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {msg.isAnonymous ? '?' : msg.donorName.charAt(0).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-card-foreground">
                        {msg.isAnonymous ? 'Anonymous' : msg.donorName}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(msg.createdAt)}
                      </span>
                    </div>

                    {!msg.isAnonymous && msg.donorLocation && (
                      <p className="text-xs text-muted-foreground">{msg.donorLocation}</p>
                    )}

                    <p className="mt-1 text-sm text-muted-foreground">
                      {displayText}
                    </p>

                    {isLong && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(msg.id)}
                        className="mt-1 text-xs font-medium text-muted-foreground underline hover:text-foreground"
                      >
                        {expanded ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="w-full rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more messages'}
        </button>
      )}
    </div>
  );
}
