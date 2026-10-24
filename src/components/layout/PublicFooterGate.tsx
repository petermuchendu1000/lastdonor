'use client';

import { usePathname } from 'next/navigation';

import { showsPublicFooter } from '@/lib/public-chrome';

/**
 * Renders the public footer everywhere except the admin tool.
 *
 * A CLIENT component wrapping a SERVER one. The `<Footer />` passed in is
 * still rendered on the server and handed here as `children`; this only
 * decides whether to place it. That keeps `Footer.tsx` a server component -
 * it reads `SOCIAL_LINKS` and renders two server children - and keeps the root
 * layout free of the dynamic APIs that would de-optimise every route
 * (see `src/lib/public-chrome.ts`).
 *
 * `usePathname` resolves during server rendering, so the footer is absent from
 * the HTML itself rather than removed after hydration. That is asserted
 * against a real browser with JAVASCRIPT DISABLED, because a check that runs
 * after hydration cannot tell the two apart.
 *
 * ⛔ The NAVBAR is deliberately NOT gated. The admin sidebar has no sign-out
 * (checked: no signout/logout anywhere in `AdminSidebar.tsx` or the admin
 * layout), so the navbar is an administrator's only way out of the tool.
 * Hiding it would trade a cosmetic win for a stranded user.
 */
export function PublicFooterGate({ children }: { children: React.ReactNode }) {
  return showsPublicFooter(usePathname()) ? <>{children}</> : null;
}
