import { Skeleton } from '@/components/ui/skeleton';

export default function AdminLoading() {
  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      {/* CDS stat tiles grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-background px-4 py-4">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-24" />
            <Skeleton className="mt-1 h-3 w-20" />
          </div>
        ))}
      </div>

      {/* CDS data table skeleton - Active campaigns */}
      <section>
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-muted/50 px-4 py-2.5">
            <Skeleton className="h-3 w-full max-w-md" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </section>

      {/* CDS data table skeleton - Recent donations */}
      <section>
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-muted/50 px-4 py-2.5">
            <Skeleton className="h-3 w-full max-w-sm" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
