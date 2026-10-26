'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardMobileNav } from './DashboardMobileNav';

const STORAGE_KEY = 'sidebar-collapsed';

export function DashboardShell({
  hasCampaigns,
  children,
}: {
  hasCampaigns: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') setCollapsed(true);
    } catch {
      // localStorage unavailable (SSR, incognito, etc.)
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 overflow-hidden border-r border-border bg-muted/40 transition-[width] duration-200 ease-in-out lg:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <DashboardSidebar
          hasCampaigns={hasCampaigns}
          collapsed={collapsed}
          onToggle={toggle}
        />
      </aside>

      {/* Main content area */}
      <main className="min-w-0 flex-1 bg-muted/30">
        {/*
          ⚠️ STICKY, SLIM, AND TOKENISED. This was a full-height white bar
          holding nothing but a second hamburger, stacked directly under the
          site header - two bars and two hamburgers before any content. With
          the page heading below it, 335px of an 844px phone (40% of the
          fold) was chrome before the first campaign appeared, which is the
          `docs/71` finding repeating on another screen.

          It also used hardcoded hex (#E5E7EB, #F9FAFB) rather than tokens,
          so it did not follow the theme at all.
        */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-1.5 backdrop-blur lg:hidden">
          <DashboardMobileNav hasCampaigns={hasCampaigns} />
        </div>

        {/* Page content */}
        <div className="mx-auto max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
