'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { isSoundEnabled, setSoundEnabled } from '@/lib/notification-sound';
import {
  ChartBarIcon,
  PlusCircleIcon,
  NewspaperIcon,
  ClipboardDocumentListIcon,
  FolderOpenIcon,
  SignalIcon,
  Cog6ToothIcon,
  CurrencyDollarIcon,
  UserGroupIcon,
  BellAlertIcon,
  BellIcon,
  ChartPieIcon,
  HeartIcon,
  PencilSquareIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  ChevronDownIcon,
  AdjustmentsHorizontalIcon,
  ShieldCheckIcon,
  BanknotesIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  EnvelopeIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

type NavGroup = {
  label: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  adminOnly?: boolean;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard', icon: ChartBarIcon },
    ],
  },
  {
    label: 'Content',
    collapsible: true,
    items: [
      { href: '/admin/campaigns', label: 'Campaigns', icon: FolderOpenIcon },
      { href: '/admin/campaigns/new', label: 'New Campaign', icon: PlusCircleIcon },
      { href: '/admin/news-feed', label: 'News Feed', icon: NewspaperIcon },
      { href: '/admin/blog', label: 'Blog', icon: PencilSquareIcon },
      { href: '/admin/blog/topics', label: 'Blog Topics', icon: ClipboardDocumentListIcon },
    ],
  },
  {
    label: 'Finance & Users',
    collapsible: true,
    items: [
      { href: '/admin/donations', label: 'Donations', icon: CurrencyDollarIcon },
      { href: '/admin/donors', label: 'Donors', icon: HeartIcon },
      { href: '/admin/users', label: 'Users', icon: UserGroupIcon },
    ],
  },
  {
    label: 'Trust & Verification',
    collapsible: true,
    adminOnly: true,
    items: [
      { href: '/admin/verification', label: 'Verification Queue', icon: ShieldCheckIcon },
      { href: '/admin/screening', label: 'Document Screening', icon: ClipboardDocumentListIcon },
      { href: '/admin/institutions', label: 'Trusted Orgs', icon: UserGroupIcon },
      { href: '/admin/payouts', label: 'Payouts', icon: BanknotesIcon },
      // `docs/113` §11 screen D1. Read-only: no rail exists to send with.
      { href: '/admin/payout-queue', label: 'Institutional Payouts', icon: BanknotesIcon },
      { href: '/admin/governance', label: 'Governance', icon: ExclamationTriangleIcon },
      { href: '/admin/info-requests', label: 'Info Requests', icon: InformationCircleIcon },
      { href: '/admin/communications', label: 'Communications', icon: EnvelopeIcon },
      { href: '/admin/refunds', label: 'Refund Batches', icon: ArrowPathIcon },
    ],
  },
  {
    label: 'Operations',
    collapsible: true,
    adminOnly: true,
    items: [
      { href: '/admin/reports', label: 'Reports', icon: ChartPieIcon },
      { href: '/admin/monitoring', label: 'Monitoring', icon: SignalIcon },
      { href: '/admin/notifications', label: 'Notifications', icon: BellIcon },
      { href: '/admin/activity', label: 'Activity', icon: BellAlertIcon },
      { href: '/admin/audit-log', label: 'Audit Log', icon: ClipboardDocumentListIcon },
    ],
  },
  {
    label: 'Simulation',
    collapsible: true,
    adminOnly: true,
    items: [
      { href: '/admin/simulation', label: 'Controls', icon: AdjustmentsHorizontalIcon },
      { href: '/admin/simulation/fund-pool', label: 'Fund Pool', icon: CurrencyDollarIcon },
      { href: '/admin/simulation/analytics', label: 'Analytics', icon: ChartPieIcon },
    ],
  },
  {
    label: 'Configuration',
    adminOnly: true,
    items: [
      { href: '/admin/settings', label: 'Settings', icon: Cog6ToothIcon },
    ],
  },
];

export function AdminSidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const isAdmin = role === 'admin';
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    setSoundOn(isSoundEnabled());
  }, []);

  // Initialize expanded state from defaultOpen
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of NAV_GROUPS) {
      if (group.collapsible) {
        initial[group.label] = group.defaultOpen ?? false;
      }
    }
    return initial;
  });

  const toggleGroup = (label: string) => {
    setExpanded((prev) => {
      const isOpening = !prev[label];
      if (!isOpening) return { ...prev, [label]: false };
      // Accordion: close all others, open this one
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(prev)) next[key] = false;
      next[label] = true;
      return next;
    });
  };

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  };

  return (
    <nav className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col justify-between" aria-label="Admin navigation">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-4">
      {NAV_GROUPS.map((group, groupIdx) => {
        if (group.adminOnly && !isAdmin) return null;

        const isCollapsible = group.collapsible;
        const isOpen = isCollapsible ? expanded[group.label] : true;
        const filteredGroupIdx = groupIdx;

        return (
          <div key={group.label}>
            {/* CDS divider - 1px border between groups */}
            {filteredGroupIdx > 0 && (
              <div className="my-2 border-t border-border" />
            )}

            {/* CDS section header - 11px semibold, uppercase tracking, 16px horizontal padding */}
            {isCollapsible ? (
              <button
                onClick={() => toggleGroup(group.label)}
                className="flex w-full items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={isOpen}
              >
                {group.label}
                <ChevronDownIcon
                  className={cn(
                    'h-3 w-3 transition-transform duration-150',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>
            ) : (
              <p className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            )}

            {/* CDS nav items - 32px row height, 4px left active indicator */}
            <div
              className={cn(
                'overflow-hidden transition-all duration-150',
                isCollapsible && !isOpen && 'max-h-0 opacity-0',
                isCollapsible && isOpen && 'max-h-[28rem] opacity-100',
                !isCollapsible && 'max-h-[28rem]',
              )}
            >
              <div className="mt-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex h-8 items-center gap-3 px-4 text-sm transition-colors duration-100',
                        active
                          ? 'bg-primary/8 font-medium text-foreground before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground/50')} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      </div>

      {/* Sound toggle - CDS utility footer */}
      <div className="border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={() => {
            const next = !soundOn;
            setSoundOn(next);
            setSoundEnabled(next);
          }}
          className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors duration-100 hover:bg-muted/60 hover:text-foreground"
          aria-label={soundOn ? 'Mute notification sounds' : 'Unmute notification sounds'}
        >
          {soundOn ? (
            <SpeakerWaveIcon className="h-4 w-4 shrink-0" />
          ) : (
            <SpeakerXMarkIcon className="h-4 w-4 shrink-0" />
          )}
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
      </div>
    </nav>
  );
}
