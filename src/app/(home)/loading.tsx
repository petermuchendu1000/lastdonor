export default function HomeLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-brand-teal" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
