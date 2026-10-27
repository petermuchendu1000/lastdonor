'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { cn } from '@/lib/utils';
import {
  HomeIcon,
  PlusCircleIcon,
  BanknotesIcon,
  UserCircleIcon,
  QuestionMarkCircleIcon,
  ArrowTopRightOnSquareIcon,
  ArrowRightStartOnRectangleIcon,
  ChevronRightIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  SparklesIcon,
  MegaphoneIcon,
} from '@heroicons/react/24/outline';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** Shown only when the viewer has a campaign to list. */
  requiresCampaign?: boolean;
};

/*
  ⛔ `/dashboard/campaigns` is in here now, and it is `requiresCampaign` so a
  person with nothing to list is not sent to an empty page.

  It was in NEITHER navigation surface - not this sidebar (which the mobile nav
  also renders), not `UserNav` - so its only persistent doors were a "View all"
  link gated on a CREATOR-ONLY count and a "Create Campaign" button in the
  Finances empty state. After `docs/117` taught that list to include campaigns
  a person merely HELPS with, the people it was fixed for still had no way back
  to it once the one-shot redirect had been used. `docs/119`.
*/
const PRIMARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { href: '/dashboard/campaigns', label: 'My campaigns', icon: MegaphoneIcon, requiresCampaign: true },
  { href: '/dashboard/finances', label: 'Finances', icon: BanknotesIcon },
  // GoFundMe puts "Your impact" in the account menu; ours is primary nav
  // because the loop only works if the sharer can find what it earned them.
  { href: '/dashboard/impact', label: 'Your impact', icon: SparklesIcon },
];

const ACCOUNT_CHILDREN: { href: string; label: string }[] = [
  { href: '/dashboard/settings', label: 'Settings' },
  { href: '/dashboard/subscriptions', label: 'Subscriptions' },
  { href: '/dashboard/notifications', label: 'Notifications' },
];

interface SidebarProps {
  hasCampaigns: boolean;
  collapsed: boolean;
  onToggle?: () => void;
}

export function DashboardSidebar({ hasCampaigns, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const isAccountActive = ACCOUNT_CHILDREN.some(item => isActive(item.href));
  const [accountOpen, setAccountOpen] = useState(isAccountActive);

  // Auto-expand when on an Account child route, collapse when navigating away
  useEffect(() => {
    setAccountOpen(isAccountActive);
  }, [isAccountActive]);

  return (
    <nav
      className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col overflow-y-auto overflow-x-hidden"
      aria-label="Dashboard navigation"
    >
      {/* Header: logo + collapse toggle */}
      <div
        className={cn(
          'flex items-center gap-2 pb-4 pt-5',
          collapsed ? 'justify-center px-2' : 'px-4',
        )}
      >
        {!collapsed && (
          <Link
            href="/"
            className="flex-1 text-lg font-display font-bold tracking-tight text-[#111827]"
          >
            Last&nbsp;<span className="text-[#0F766E]">Donor</span>
            <span className="text-[#D97706]">.</span>
          </Link>
        )}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#9CA3AF] transition-colors hover:bg-[#E5E7EB] hover:text-[#6B7280]"
          >
            {collapsed ? (
              <ChevronDoubleRightIcon className="h-4 w-4" />
            ) : (
              <ChevronDoubleLeftIcon className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Create Campaign */}
      <div className={cn('pb-4', collapsed ? 'px-2' : 'px-3')}>
        <Link
          href="/share-your-story"
          aria-label="Create Campaign"
          title={collapsed ? 'Create Campaign' : undefined}
          className="flex h-9 items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] text-[13px] font-medium text-[#374151] hover:bg-[#E5E7EB]/50 active:scale-[0.98]"
        >
          <PlusCircleIcon className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Create Campaign</span>}
        </Link>
      </div>

      {/* Navigation */}
      <div className={cn('flex-1', collapsed ? 'px-2' : 'px-3')}>
        {/* Primary */}
        <div className="space-y-0.5">
          {/*
            `hasCampaigns` was destructured as `_hasCampaigns` and thrown
            away, while `dashboard/layout.tsx` spent one of its three
            permitted queries (`docs/87`) computing it. It is read now.
          */}
          {PRIMARY_NAV.filter(item => !item.requiresCampaign || hasCampaigns).map(item => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                onClick={active ? (e) => e.preventDefault() : undefined}
                className={cn(
                  'flex h-9 items-center gap-3 rounded-md text-[13px] font-medium',
                  collapsed ? 'justify-center' : 'px-3',
                  active
                    ? 'bg-[#E5E7EB]/70 text-[#111827]'
                    : 'text-[#6B7280] hover:bg-[#E5E7EB]/50 hover:text-[#374151]',
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </div>

        <div className="my-3 h-px bg-[#E5E7EB]" />

        {/* Account group */}
        {collapsed ? (
          /* Collapsed: single icon linking to account settings */
          <Link
            href="/dashboard/settings"
            title="Account"
            aria-current={isAccountActive ? 'page' : undefined}
            onClick={isAccountActive ? (e) => e.preventDefault() : undefined}
            className={cn(
              'flex h-9 items-center justify-center rounded-md text-[13px] font-medium',
              isAccountActive
                ? 'bg-[#E5E7EB]/70 text-[#111827]'
                : 'text-[#6B7280] hover:bg-[#E5E7EB]/50 hover:text-[#374151]',
            )}
          >
            <UserCircleIcon className="h-[18px] w-[18px] shrink-0" />
          </Link>
        ) : (
          /* Expanded: expandable group with sub-items */
          <div>
            <button
              type="button"
              onClick={() => setAccountOpen(prev => !prev)}
              aria-expanded={accountOpen}
              aria-controls="account-subnav"
              className={cn(
                'flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13px] font-medium hover:bg-[#E5E7EB]/50',
                isAccountActive ? 'text-[#111827]' : 'text-[#6B7280] hover:text-[#374151]',
              )}
            >
              <UserCircleIcon className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1 text-left">Account</span>
              <ChevronRightIcon
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-[#9CA3AF] transition-transform duration-150',
                  accountOpen && 'rotate-90',
                )}
              />
            </button>
            {accountOpen && (
              <div
                id="account-subnav"
                role="group"
                aria-label="Account settings"
                className="mt-0.5 ml-9 space-y-0.5 border-l border-[#E5E7EB] pl-1"
              >
                {ACCOUNT_CHILDREN.map(item => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      onClick={active ? (e) => e.preventDefault() : undefined}
                      className={cn(
                        'flex h-8 items-center rounded-md pl-3 pr-2 text-[13px] font-medium',
                        active
                          ? 'bg-[#E5E7EB]/70 text-[#111827]'
                          : 'text-[#6B7280] hover:bg-[#E5E7EB]/50 hover:text-[#374151]',
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sign out */}
      <div className={cn('pb-2', collapsed ? 'px-2' : 'px-3')}>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/' })}
          title={collapsed ? 'Sign out' : undefined}
          className={cn(
            'flex h-9 w-full items-center gap-3 rounded-md text-[13px] font-medium text-[#6B7280] hover:bg-[#E5E7EB]/50 hover:text-[#374151]',
            collapsed ? 'justify-center' : 'px-3',
          )}
        >
          <ArrowRightStartOnRectangleIcon className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && 'Sign out'}
        </button>
      </div>

      {/* Help card - expanded only */}
      {!collapsed && (
        <div className="px-3 pb-4 pt-2">
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-3.5">
            <div className="flex items-center gap-2">
              <QuestionMarkCircleIcon className="h-[18px] w-[18px] text-[#9CA3AF]" />
              <span className="text-[12px] font-semibold text-[#111827]">Need help?</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[#6B7280]">
              Read the FAQ, or email us and a person will reply.
            </p>
            {/* Was href="/help", which has never existed: a signed-in user
                clicking "Help Center" got a 404. Both destinations below are
                real: /donor-faq is a page, support@ is the address published
                in /refund-policy. Do not reinstate a link to a page that is
                not in src/app. */}
            <Link
              href="/donor-faq"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F766E] transition-colors hover:text-[#0D6B63]"
            >
              Read the FAQ
              <ArrowTopRightOnSquareIcon className="h-3 w-3" />
            </Link>
            <a
              href="mailto:support@lastdonor.org"
              className="mt-1 block text-[11px] font-semibold text-[#0F766E] transition-colors hover:text-[#0D6B63]"
            >
              support@lastdonor.org
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
