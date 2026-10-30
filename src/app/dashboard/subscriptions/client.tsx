'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BellSlashIcon } from '@heroicons/react/24/outline';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Subscription {
  id: string;
  campaignSlug: string;
  campaignTitle: string;
  campaignStatus: string;
  /*
    Resolved on the server from `status` + `published_at` (`docs/131`). Both
    links below are gated on it: a campaign you subscribed to can stop having
    a public page after you subscribed (`docs/118` §2.5), and an ungated link
    then hands you a 404.
  */
  campaignHref: string | null;
  campaignHeroImageUrl: string;
  campaignRaisedFormatted: string;
  campaignGoalFormatted: string;
  subscribedAt: string;
}

interface SubscriptionsClientProps {
  email: string;
  initialSubscriptions: Subscription[];
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  last_donor_zone: { label: 'Last Donor Zone', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
  completed: { label: 'Completed', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400' },
  paused: { label: 'Paused', className: 'bg-gray-50 text-gray-600 dark:bg-gray-900 dark:text-gray-400' },
  suspended: { label: 'Under Review', className: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400' },
  cancelled: { label: 'Removed', className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400' },
};

export function SubscriptionsClient({ email, initialSubscriptions }: SubscriptionsClientProps) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [unsubscribing, setUnsubscribing] = useState<string | null>(null);

  const handleUnsubscribe = useCallback(async (slug: string) => {
    setUnsubscribing(slug);
    try {
      const res = await fetch(`/api/v1/campaigns/${slug}/subscribe`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (json.ok) {
        setSubscriptions((prev) => prev.filter((s) => s.campaignSlug !== slug));
      }
    } catch {
      // silently fail
    } finally {
      setUnsubscribing(null);
    }
  }, [email]);

  if (subscriptions.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-center">
        <p className="text-base font-semibold text-foreground">No subscriptions yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscribe to campaigns to get notified about progress updates, impact reports, and more.
        </p>
        <Link
          href="/campaigns"
          className="mt-5 rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Browse Campaigns
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {subscriptions.map((sub) => {
        const status = STATUS_LABELS[sub.campaignStatus] ?? { label: sub.campaignStatus, className: '' };
        const isLoading = unsubscribing === sub.campaignSlug;

        return (
          <div
            key={sub.id}
            className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/30"
          >
            {sub.campaignHref ? (
              <Link href={sub.campaignHref} className="shrink-0">
                <Image
                  src={sub.campaignHeroImageUrl}
                  alt={sub.campaignTitle}
                  width={80}
                  height={52}
                  className="h-[52px] w-[80px] rounded-lg object-cover"
                />
              </Link>
            ) : (
              <Image
                src={sub.campaignHeroImageUrl}
                alt={sub.campaignTitle}
                width={80}
                height={52}
                className="h-[52px] w-[80px] shrink-0 rounded-lg object-cover"
              />
            )}

            <div className="min-w-0 flex-1">
              {sub.campaignHref ? (
                <Link
                  href={sub.campaignHref}
                  className="block truncate text-sm font-semibold text-foreground hover:text-primary"
                >
                  {sub.campaignTitle}
                </Link>
              ) : (
                <p className="block truncate text-sm font-semibold text-foreground">
                  {sub.campaignTitle}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn('border-0 text-[11px]', status.className)}>
                  {status.label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {sub.campaignRaisedFormatted} of {sub.campaignGoalFormatted}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleUnsubscribe(sub.campaignSlug)}
              disabled={isLoading}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive',
                isLoading && 'pointer-events-none opacity-50',
              )}
            >
              <BellSlashIcon className="h-3.5 w-3.5" />
              {isLoading ? 'Removing...' : 'Unsubscribe'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
