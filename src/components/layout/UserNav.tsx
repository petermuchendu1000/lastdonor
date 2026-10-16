'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUnreadNotificationCount } from '@/components/NotificationBell';
import {
  Squares2X2Icon,
  SparklesIcon,
  BellIcon,
  ArrowRightStartOnRectangleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

function getInitials(name: string | null | undefined): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatBalance(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export function UserNav() {
  const { data: session, status } = useSession();
  const unread = useUnreadNotificationCount();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<{ availableBalance: number; hasCampaigns: boolean } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null);

  function handleMouseEnter() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function handleMouseLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  // Fetch available balance for campaign creators
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    fetch('/api/v1/user/balance')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setBalance(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  if (status === 'loading') {
    return (
      <div className="h-9 w-9 animate-pulse rounded-full bg-white/10" />
    );
  }

  if (!session?.user) return null;

  const { name, email, image, role } = session.user;

  return (
    <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex items-center gap-2 rounded-full outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={
            unread > 0
              ? `User menu, ${unread} unread ${unread === 1 ? 'notification' : 'notifications'}`
              : 'User menu'
          }
        >
          <Avatar className="h-9 w-9 border-2 border-border transition-colors hover:border-primary dark:border-white/20 dark:hover:border-[#14B8A6]">
            <AvatarImage src={image ?? undefined} alt={name ?? 'User avatar'} />
            <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
          {/*
            The count rides the avatar instead of a separate bell button,
            which gives a 36px tap target back in the navbar. Capped at 9+
            so the badge stays a circle; the exact number is in the menu.
            `aria-hidden` because the button's own label already announces
            it, and announcing it twice is worse than not at all.
          */}
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-accent-foreground ring-2 ring-background"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" sideOffset={8} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium leading-none">{name ?? 'Donor'}</p>
            <p className="text-xs leading-none text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        {/* Available Funds - Fiverr-style, shown only for campaign creators */}
        {balance?.hasCampaigns && (
          <>
            <DropdownMenuSeparator />
            <Link
              href="/dashboard/payout-settings"
              className="flex items-center justify-between px-2 py-2.5 transition-colors hover:bg-muted/60 rounded-sm"
              onClick={() => setOpen(false)}
            >
              <span className="text-xs font-medium text-muted-foreground">Available funds</span>
              <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {formatBalance(balance.availableBalance)}
              </span>
            </Link>
          </>
        )}
        <DropdownMenuSeparator />
        {(role === 'admin' || role === 'editor') && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href="/admin">
                  <ShieldCheckIcon className="mr-2 h-4 w-4" />
                  Admin Panel
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/dashboard">
              <Squares2X2Icon className="mr-2 h-4 w-4" />
              Dashboard
            </Link>
          </DropdownMenuItem>
          {/*
            "Your impact" sits in the GLOBAL account menu, not only in the
            dashboard sidebar, because that is where someone who has just
            shared a campaign actually is: on the campaign page. Reaching it
            through /dashboard first would mean the one moment a sharer most
            wants to check their link is the one moment the page is hardest to
            find. GoFundMe places it the same way, in the top-right menu
            (help-centre article 24972788571803). See docs/58.
          */}
          <DropdownMenuItem asChild>
            <Link href="/dashboard/impact">
              <SparklesIcon className="mr-2 h-4 w-4" />
              Your impact
            </Link>
          </DropdownMenuItem>
          {/*
            The notification list used to be a bell in the navbar. It is here
            now, with the exact count: the badge on the avatar says "there is
            something", this says how much. See docs/68.
          */}
          <DropdownMenuItem asChild>
            <Link href="/notifications">
              <BellIcon className="mr-2 h-4 w-4" />
              Notifications
              {unread > 0 && (
                <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold leading-none text-accent-foreground">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: '/' })}
          className="text-destructive focus:text-destructive"
        >
          <ArrowRightStartOnRectangleIcon className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  );
}
