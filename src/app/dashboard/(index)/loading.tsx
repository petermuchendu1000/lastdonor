import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumbs */}
      <Skeleton className="h-4 w-48" />

      {/* Header */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-1 h-5 w-36" />
        </div>
        <Skeleton className="h-4 w-40" />
      </div>

      {/* Stats cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between pb-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-4" />
            </div>
            <Skeleton className="mt-2 h-8 w-20" />
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="mt-8">
        <Skeleton className="h-6 w-28" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
              <div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-1 h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Donation history + sidebar */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <Skeleton className="h-6 w-36" />
          <div className="mt-4 rounded-lg border border-border">
            <div className="border-b border-border p-3">
              <div className="flex gap-8">
                {['Campaign', 'Amount', 'Phase', 'Date'].map((h) => (
                  <Skeleton key={h} className="h-4 w-20" />
                ))}
              </div>
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-8 border-b border-border p-3 last:border-0">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-5">
            <Skeleton className="h-4 w-28" />
            <div className="mt-4 flex gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-10 rounded-full" />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-1 h-3 w-48" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="border-b border-border pb-3 last:border-0">
                  <Skeleton className="h-4 w-full" />
                  <div className="mt-1 flex justify-between">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
