import { Skeleton } from '@/components/ui/skeleton';

export default function CampaignsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Heading */}
      <Skeleton className="mb-6 h-8 w-40" />

      {/* Search bar */}
      <div className="mx-auto mb-4 max-w-2xl">
        <Skeleton className="h-12 w-full rounded-full" />
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>

      {/* Campaign grid */}
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="aspect-video w-full rounded-lg" />
            <div className="pt-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="mt-1.5 h-4 w-1/2" />
              <Skeleton className="mt-2 h-2 w-full rounded-full" />
              <Skeleton className="mt-1 h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
