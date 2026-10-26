'use client';

import { usePathname } from 'next/navigation';

import { showsPublicNavbar } from '@/lib/public-chrome';

/**
 * Renders the public navbar everywhere except the organiser dashboard.
 *
 * Same shape as `PublicFooterGate`, and for the same reason: a CLIENT
 * component placing a SERVER one, so the root layout stays free of the
 * dynamic APIs that would opt every route out of static rendering.
 *
 * ⛔ `/admin` still gets the navbar. `AdminSidebar.tsx` has no sign-out, so
 * there it is an administrator's only way out - see `public-chrome.ts`.
 */
export function PublicNavbarGate({ children }: { children: React.ReactNode }) {
  return showsPublicNavbar(usePathname()) ? <>{children}</> : null;
}
