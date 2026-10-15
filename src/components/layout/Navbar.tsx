'use client';

import { useState, lazy, Suspense, type ComponentPropsWithoutRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuthState } from '@/lib/auth-state';
import {
  Bars3Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { UserNav } from '@/components/layout/UserNav';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// Lazy-load NotificationBell (not needed for initial render, reduces main bundle)
const NotificationBell = lazy(() =>
  import('@/components/NotificationBell').then((m) => ({ default: m.NotificationBell }))
);

/* ------------------------------------------------------------------ */
/*  Navigation data - all links derive from here, nothing hardcoded   */
/* ------------------------------------------------------------------ */

/** Pages surfaced in the "About" dropdown - trust & information. */
const ABOUT_ITEMS = [
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'About LastDonor', href: '/about' },
  { label: 'Transparency', href: '/transparency' },
  { label: 'Editorial Standards', href: '/editorial-standards' },
  { label: 'Blog', href: '/blog' },
  { label: 'Last Donor Wall', href: '/last-donor-wall' },
] as const;

/* ------------------------------------------------------------------ */
/*  Shared style constants                                            */
/* ------------------------------------------------------------------ */

/*
 * py-2.5 gives a 40px control. Measured 2026-10-15: these were 36px against
 * GoFundMe's 40px, the smallest hit area in either header. See docs/48.
 */
const NAV_LINK = 'rounded-md px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-muted hover:text-foreground';
const NAV_LINK_ACTIVE = 'text-primary';
const NAV_LINK_IDLE = 'text-muted-foreground';
const DROPDOWN_TRIGGER =
  'flex items-center gap-1 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-muted hover:text-foreground focus:outline-none';

/* ------------------------------------------------------------------ */
/*  Sign-in link (context-preserving)                                 */
/* ------------------------------------------------------------------ */

/**
 * Build a /login href that sends the user back where they were. A bare
 * href="/login" drops their context and lands them on /dashboard after
 * signing in. The login page sanitises `callbackUrl` against its own origin.
 */
function loginHref(target: string): string {
  if (!target || target === '/' || target.startsWith('/login')) return '/login';
  return `/login?callbackUrl=${encodeURIComponent(target)}`;
}

/**
 * Sign-in link carrying the current pathname AND query string.
 *
 * Reads `useSearchParams`, so every call site wraps it in a Suspense boundary:
 * the navbar lives in the root layout, and without a boundary Next cannot
 * statically prerender any page that embeds it.
 */
function SignInLink({ className, ...rest }: ComponentPropsWithoutRef<'a'>) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const target = `${pathname}${search ? `?${search}` : ''}`;

  return (
    <Link {...rest} href={loginHref(target)} className={className}>
      Sign in
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function Navbar() {
  const pathname = usePathname();
  /*
   * Three states, not two. `unknown` means the session read did not come back
   * with a definite answer (429, 5xx, offline, or still in flight) and MUST
   * render neither the signed-in header nor a "Sign in" link: rendering the
   * anonymous header on an inconclusive read is what told logged-in users they
   * were logged out. See docs/44 and `src/lib/auth-state.ts`.
   */
  const { state: authState } = useAuthState();
  const isAuthed = authState === 'authenticated';
  const isAnonymous = authState === 'anonymous';
  const [mobileView, setMobileView] = useState<'root' | 'campaigns' | 'about'>('root');

  const isCampaignsActive =
    pathname === '/campaigns' || pathname.startsWith('/campaigns/');
  const isAboutActive = ABOUT_ITEMS.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
  );

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card shadow-sm dark:bg-[#0F1A19] dark:border-white/10 dark:shadow-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">

        {/* ============ LEFT ZONE: brand + actions ============ */}
        <div className="flex items-center gap-1">
          {/* Logo */}
          <Link
            href="/"
            className="mr-4 flex items-center gap-1 text-xl font-display font-bold tracking-tight text-foreground"
          >
            Last
            <span className="text-primary">Donor</span>
            <span className="text-accent">.</span>
          </Link>

          {/* Desktop nav - visible md+ */}
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main navigation">
            {/* Search - navigates to campaigns page */}
            <Link
              href="/campaigns"
              className={cn(
                DROPDOWN_TRIGGER,
                pathname === '/campaigns' ? NAV_LINK_ACTIVE : NAV_LINK_IDLE,
              )}
            >
              <MagnifyingGlassIcon className="h-4 w-4" />
              Search
            </Link>

            {/* Fundraise - supply-side action, top-level visibility */}
            <Link
              href="/share-your-story"
              className={cn(
                NAV_LINK,
                pathname === '/share-your-story' ? NAV_LINK_ACTIVE : NAV_LINK_IDLE,
              )}
            >
              Fundraise
            </Link>

            {/* Campaigns dropdown - category discovery */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  DROPDOWN_TRIGGER,
                  isCampaignsActive ? NAV_LINK_ACTIVE : NAV_LINK_IDLE,
                )}
              >
                Campaigns
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[420px] p-0">
                <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                  <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Discover campaigns to support</span>
                </div>

                {/* Quick links */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 px-3 py-3">
                  <DropdownMenuItem asChild>
                    <Link href="/campaigns" className="text-sm font-semibold">
                      Browse All Categories
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/completed-campaigns" className="text-sm font-semibold">
                      Completed Campaigns
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/share-your-story" className="text-sm font-semibold">
                      Start a Campaign
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/cancelled-campaigns" className="text-sm font-semibold">
                      Rejected Campaigns
                    </Link>
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* About dropdown - trust & informational pages */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  DROPDOWN_TRIGGER,
                  isAboutActive ? NAV_LINK_ACTIVE : NAV_LINK_IDLE,
                )}
              >
                About
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[420px] p-0">
                <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                  <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                  <span className="text-sm text-muted-foreground">How it works, trust & more</span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 px-3 py-3">
                  {ABOUT_ITEMS.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link
                        href={item.href}
                        className={cn(
                          'text-sm',
                          pathname === item.href && 'text-primary font-semibold',
                        )}
                      >
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>

        {/* ============ RIGHT ZONE: trust + conversion ============ */}
        <div className="hidden items-center gap-1 md:flex">
          {/* Auth - Sign in (text link, low visual weight) */}
          {authState === 'unknown' ? (
            <div
              className="h-9 w-9 rounded-full bg-muted"
              aria-hidden="true"
              data-testid="auth-indeterminate"
            />
          ) : isAuthed ? (
            <>
              <Suspense fallback={<div className="h-9 w-9" />}>
                <NotificationBell />
              </Suspense>
              <UserNav />
            </>
          ) : (
            <Suspense
              fallback={
                <Link href="/login" className={cn(NAV_LINK, NAV_LINK_IDLE)}>
                  Sign in
                </Link>
              }
            >
              <SignInLink
                className={cn(
                  NAV_LINK,
                  pathname === '/login' ? NAV_LINK_ACTIVE : NAV_LINK_IDLE,
                )}
              />
            </Suspense>
          )}

          {/* Donate CTA - isolated far-right, recency effect */}
          <Link
            href="/donate"
            className="ml-1 rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-foreground shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-accent/85 hover:shadow-md hover:shadow-accent/20 active:scale-[0.97]"
          >
            Donate
          </Link>
        </div>

        {/* ============ MOBILE: search + avatar + hamburger ============ */}
        <div className="flex items-center gap-1 md:hidden">
          {/*
            Search is a top-level action on desktop, so hiding it behind the
            hamburger on mobile made the primary discovery task cost two taps
            on the device most people browse from. Measured 2026-10-15: the
            mobile header carried the logo and the hamburger and nothing else,
            while GoFundMe keeps a persistent 40x40 search control. See
            docs/48.
          */}
          <Link
            href="/campaigns"
            aria-label="Search campaigns"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MagnifyingGlassIcon className="h-6 w-6" />
          </Link>

          {isAuthed && (
            <>
              <Suspense fallback={<div className="h-9 w-9" />}>
                <NotificationBell />
              </Suspense>
              <UserNav />
            </>
          )}
          <Sheet onOpenChange={(open) => { if (!open) setMobileView('root'); }}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open menu"
                /* 44x44: the hamburger was 36x36, the smallest control in
                   either product's header. */
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Bars3Icon className="h-6 w-6" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="flex w-80 flex-col gap-0 p-0">

              {/* ──────────── ROOT VIEW ──────────── */}
              {mobileView === 'root' && (
                <>
                  <SheetHeader className="border-b border-border px-6 py-4">
                    <SheetTitle className="flex items-center gap-1 text-lg font-display">
                      Last<span className="text-primary">Donor</span>
                      <span className="text-accent">.</span>
                    </SheetTitle>
                  </SheetHeader>

                  <nav className="flex flex-1 flex-col" aria-label="Mobile navigation">
                    {/* Navigation rows - large tap targets, title + subtitle */}
                    <div className="flex flex-col">
                      {/* Campaigns → sub-view */}
                      <button
                        type="button"
                        onClick={() => setMobileView('campaigns')}
                        className="flex items-center justify-between border-b border-border px-6 py-5 text-left transition-colors hover:bg-muted"
                      >
                        <div>
                          <span className="block text-lg font-semibold text-foreground">Campaigns</span>
                          <span className="block text-sm text-muted-foreground">Discover campaigns to support</span>
                        </div>
                        <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                      </button>

                      {/* Share Your Story → direct link */}
                      <SheetClose asChild>
                        <Link
                          href="/share-your-story"
                          className="flex items-center justify-between border-b border-border px-6 py-5 transition-colors hover:bg-muted"
                        >
                          <div>
                            <span className="block text-lg font-semibold text-foreground">Share Your Story</span>
                            <span className="block text-sm text-muted-foreground">Nominate someone in need</span>
                          </div>
                          <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        </Link>
                      </SheetClose>

                      {/* About → sub-view */}
                      <button
                        type="button"
                        onClick={() => setMobileView('about')}
                        className="flex items-center justify-between border-b border-border px-6 py-5 text-left transition-colors hover:bg-muted"
                      >
                        <div>
                          <span className="block text-lg font-semibold text-foreground">About</span>
                          <span className="block text-sm text-muted-foreground">How it works, trust & more</span>
                        </div>
                        <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                      </button>

                      {/* Search → direct link */}
                      <SheetClose asChild>
                        <Link
                          href="/campaigns"
                          className="flex items-center justify-between border-b border-border px-6 py-5 transition-colors hover:bg-muted"
                        >
                          <div>
                            <span className="block text-lg font-semibold text-foreground">Search</span>
                            <span className="block text-sm text-muted-foreground">Find campaigns & stories</span>
                          </div>
                          <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        </Link>
                      </SheetClose>
                    </div>

                    {/* Bottom actions - pinned to bottom */}
                    <div className="mt-auto space-y-3 px-6 pb-6 pt-6">
                      <SheetClose asChild>
                        <Link
                          href="/donate"
                          className="block w-full rounded-full bg-accent py-3.5 text-center text-sm font-bold text-accent-foreground shadow-sm transition-all hover:bg-accent/85 hover:shadow-md active:scale-[0.97]"
                        >
                          Donate
                        </Link>
                      </SheetClose>

                      {isAnonymous && (
                        <Suspense fallback={null}>
                          <SheetClose asChild>
                            <SignInLink className="block w-full rounded-full border border-border py-3.5 text-center text-sm font-semibold text-foreground transition-colors hover:bg-muted" />
                          </SheetClose>
                        </Suspense>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-muted-foreground">Appearance</span>
                        <DarkModeToggle />
                      </div>
                    </div>
                  </nav>
                </>
              )}

              {/* ──────────── CAMPAIGNS SUB-VIEW ──────────── */}
              {mobileView === 'campaigns' && (
                <>
                  <div className="flex items-center gap-3 border-b border-border px-4 py-4">
                    <button
                      type="button"
                      onClick={() => setMobileView('root')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Back to menu"
                    >
                      <ChevronLeftIcon className="h-5 w-5" />
                    </button>
                    <span className="text-lg font-semibold text-foreground">Campaigns</span>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {/* Sub-view quick links */}
                    <SheetClose asChild>
                      <Link
                        href="/campaigns"
                        className="flex items-center justify-between border-t border-border px-6 py-4 transition-colors hover:bg-muted"
                      >
                        <div>
                          <span className="block text-base font-semibold text-foreground">Browse All Categories</span>
                          <span className="block text-sm text-muted-foreground">See all active campaigns</span>
                        </div>
                        <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                      </Link>
                    </SheetClose>

                    <SheetClose asChild>
                      <Link
                        href="/completed-campaigns"
                        className="flex items-center justify-between border-t border-border px-6 py-4 transition-colors hover:bg-muted"
                      >
                        <div>
                          <span className="block text-base font-semibold text-foreground">Completed Campaigns</span>
                          <span className="block text-sm text-muted-foreground">Campaigns that reached their goals</span>
                        </div>
                        <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                      </Link>
                    </SheetClose>

                    <SheetClose asChild>
                      <Link
                        href="/share-your-story"
                        className="flex items-center justify-between border-t border-border px-6 py-4 transition-colors hover:bg-muted"
                      >
                        <div>
                          <span className="block text-base font-semibold text-foreground">Start a Campaign</span>
                          <span className="block text-sm text-muted-foreground">Nominate someone who needs help</span>
                        </div>
                        <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                      </Link>
                    </SheetClose>

                    <SheetClose asChild>
                      <Link
                        href="/cancelled-campaigns"
                        className="flex items-center justify-between border-t border-border px-6 py-4 transition-colors hover:bg-muted"
                      >
                        <div>
                          <span className="block text-base font-semibold text-foreground">Rejected Campaigns</span>
                          <span className="block text-sm text-muted-foreground">Why some campaigns were removed</span>
                        </div>
                        <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                      </Link>
                    </SheetClose>
                  </div>
                </>
              )}

              {/* ──────────── ABOUT SUB-VIEW ──────────── */}
              {mobileView === 'about' && (
                <>
                  <div className="flex items-center gap-3 border-b border-border px-4 py-4">
                    <button
                      type="button"
                      onClick={() => setMobileView('root')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Back to menu"
                    >
                      <ChevronLeftIcon className="h-5 w-5" />
                    </button>
                    <span className="text-lg font-semibold text-foreground">About</span>
                  </div>

                  <nav className="flex-1 overflow-y-auto" aria-label="About pages">
                    {ABOUT_ITEMS.map((item, i) => (
                      <SheetClose asChild key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            'flex items-center justify-between px-6 py-4 text-base font-medium transition-colors hover:bg-muted',
                            pathname === item.href ? 'text-primary' : 'text-foreground',
                            i > 0 && 'border-t border-border',
                          )}
                        >
                          {item.label}
                          <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        </Link>
                      </SheetClose>
                    ))}
                  </nav>
                </>
              )}

            </SheetContent>
          </Sheet>
        </div>
      </div>

    </header>
  );
}
