import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

/*
  Caching for the whole /admin subtree is decided here, once (docs/88 F14).

  `force-dynamic` on a layout applies to every segment beneath it and
  sets `revalidate` to 0, so a page's own `revalidate` cannot take
  effect. Sixteen admin pages carried one anyway (fifteen at 60s, one
  at 0) and every one of them was dead. Measured against production as
  a signed-in admin: no `x-nextjs-cache` header on any of them and
  `cache-control: private, no-cache, no-store, max-age=0,
  must-revalidate`, identical to /admin/campaigns, which never had the
  directive at all. Four of the sixteen (blog, blog/topics, monitoring,
  news-feed) do not even call `auth()` in the page, so this line is the
  only thing keeping them dynamic.

  Do not add `revalidate` to an admin page. These are authenticated
  operator views of money, identity documents and a review queue; they
  must read the database on every request. A ratchet test enforces it.
*/
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user?.role;

  if (!session?.user || (role !== 'editor' && role !== 'admin')) {
    redirect('/login?callbackUrl=/admin');
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* CDS Left Panel - fixed-width side navigation */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-background lg:block">
        <AdminSidebar role={role ?? ''} />
      </aside>

      {/* CDS Content Area - fluid main region */}
      <main className="min-w-0 flex-1">
        {/* Breadcrumb bar - persistent top context strip */}
        <div className="border-b border-border bg-background px-6 py-3">
          <Breadcrumbs />
        </div>

        {/* Page content - CDS spacing: 32px padding (spacing-07) */}
        <div className="px-6 py-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
