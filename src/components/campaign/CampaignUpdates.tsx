'use client';

import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface CampaignUpdate {
  id: string;
  title: string;
  bodyHtml: string;
  imageUrl: string | null;
  createdAt: string;
}

interface CampaignUpdatesProps {
  updates: CampaignUpdate[];
  className?: string;
}

const INITIAL_VISIBLE = 3;

export function CampaignUpdates({ updates, className }: CampaignUpdatesProps) {
  const [showAll, setShowAll] = useState(false);

  if (updates.length === 0) return null;

  const visibleUpdates = showAll ? updates : updates.slice(0, INITIAL_VISIBLE);
  const hasMore = updates.length > INITIAL_VISIBLE;

  return (
    <div className={cn('space-y-4', className)}>
      <h3 className="font-display text-lg font-semibold text-card-foreground">
        Campaign Updates
      </h3>

      {/* Timeline */}
      <div className="relative space-y-6 pl-6">
        {/* Vertical line */}
        <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" aria-hidden="true" />

        {visibleUpdates.map((update) => (
          <div key={update.id} className="relative">
            <div
              className="absolute -left-6 top-1.5 h-[10px] w-[10px] rounded-full border-2 border-foreground/25 bg-background"
              aria-hidden="true"
            />

            <div>
              <div className="flex items-baseline gap-2">
                <h4 className="text-sm font-semibold text-card-foreground">
                  {update.title}
                </h4>
                <RelativeTime
                  date={update.createdAt}
                  className="text-xs text-muted-foreground"
                />
              </div>

              <div
                className="mt-1 text-sm text-muted-foreground prose-sm"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(update.bodyHtml) }}
              />

              {update.imageUrl && (
                <div className="mt-2 overflow-hidden rounded-md">
                  <Image
                    src={update.imageUrl}
                    alt={`Update: ${update.title}`}
                    width={400}
                    height={225}
                    className="object-cover"
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Show more/less toggle */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-foreground/70"
        >
          {showAll ? (
            <>
              Show less <ChevronUpIcon className="h-4 w-4" />
            </>
          ) : (
            <>
              Show all {updates.length} updates <ChevronDownIcon className="h-4 w-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
