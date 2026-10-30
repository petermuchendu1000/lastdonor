'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Money } from '@/components/ui/Money';
import { formatMoney } from '@/lib/money/format';
import type { CurrencyTotal } from '@/lib/admin/donation-totals.server';
import { formatDate, formatRelativeTime } from '@/lib/utils/dates';
import { PhaseBadge } from '@/components/campaign/PhaseBadge';
import {
  ArrowLeftIcon,
  MapPinIcon,
  CalendarDaysIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  TagIcon,
  XMarkIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DonorScoreBadge } from '@/components/admin/DonorScoreBadge';
import { DonorProfileEditor } from '@/components/admin/DonorProfileEditor';
import { InteractionTimeline } from '@/components/admin/InteractionTimeline';
import { RelationshipsList } from '@/components/admin/RelationshipsList';
import { PREDEFINED_TAGS } from '@/lib/validators/donor';
import type { DonationPhase, UserBadge, DonorType, DonorAddress } from '@/types';

interface UserData {
  id: string;
  name: string | null;
  email: string;
  role: 'donor' | 'editor' | 'admin';
  location: string | null;
  avatarUrl: string | null;
  /**
   * What this person has given, PER CURRENCY, recomputed from `donations`.
   *
   * ⛔ Was `users.total_donated`: one integer, no currency dimension, printed
   * with a dollar sign (`docs/92`).
   */
  donationTotals: CurrencyTotal[];
  campaignsSupported: number;
  lastDonorCount: number;
  badges: unknown;
  preferences: unknown;
  createdAt: string;
  phone: string | null;
  donorType: DonorType;
  organizationName: string | null;
  address: DonorAddress | null;
  lastDonationAt: string | null;
  donorScore: number;
}

interface DonationRow {
  id: string;
  /** The donation's own currency. */
  currency: string;
  amount: number;
  donorName: string;
  isAnonymous: boolean;
  campaignTitle: string;
  campaignSlug: string;
  phaseAtTime: string;
  source: string;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  eventType: string;
  severity: string;
  details: unknown;
  timestamp: string;
}

interface UserDetailProps {
  user: UserData;
  donations: DonationRow[];
  auditEntries: AuditEntry[];
  currentUserId: string;
}

const ROLE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  admin: 'destructive',
  editor: 'default',
  donor: 'outline',
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'text-blue-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  critical: 'text-red-700 font-bold',
};

function getInitials(name: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserDetail({ user, donations, auditEntries, currentUserId }: UserDetailProps) {
  const router = useRouter();
  const [role, setRole] = useState(user.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isSelf = user.id === currentUserId;
  const badges = (user.badges ?? []) as UserBadge[];
  const prefs = (user.preferences ?? {}) as Record<string, unknown>;
  const [tags, setTags] = useState<string[]>((prefs.tags as string[]) ?? []);
  const [newTag, setNewTag] = useState('');

  async function handleRoleChange(newRole: string) {
    if (newRole === role) return;
    if (isSelf) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message ?? 'Failed to update role');
        return;
      }

      setRole(newRole as typeof role);
      setSuccess(`Role updated to ${newRole}`);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Users
      </Link>

      {/* User header */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <Avatar className="h-16 w-16 border-2 border-border">
          <AvatarImage src={user.avatarUrl ?? undefined} alt={user.name ?? 'User'} />
          <AvatarFallback className="bg-muted text-lg font-semibold">
            {getInitials(user.name)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">
              {user.name ?? 'Unnamed User'}
            </h2>
            <Badge variant={ROLE_VARIANT[role] ?? 'secondary'}>{role}</Badge>
            <DonorScoreBadge score={user.donorScore} />
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <EnvelopeIcon className="h-4 w-4" />
              {user.email}
            </span>
            {user.location && (
              <span className="flex items-center gap-1">
                <MapPinIcon className="h-4 w-4" />
                {user.location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <CalendarDaysIcon className="h-4 w-4" />
              Joined {formatDate(user.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Total Donated</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {user.donationTotals.length === 0
              ? '-'
              : user.donationTotals.map((t) => (
                  <span key={t.currency} className="block">
                    {formatMoney(t.totalMinor, t.currency, 'exact')}
                  </span>
                ))}
          </p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Campaigns Supported</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {user.campaignsSupported}
          </p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Last Donor Wins</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {user.lastDonorCount}
          </p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Last Donation</p>
          <p className="text-lg font-medium">
            {user.lastDonationAt ? formatRelativeTime(user.lastDonationAt) : 'Never'}
          </p>
        </div>
      </div>

      {/* Donor Profile (CRM) */}
      <DonorProfileEditor
        userId={user.id}
        initialData={{
          phone: user.phone,
          donorType: user.donorType,
          organizationName: user.organizationName,
          address: user.address,
        }}
      />

      {/* Role management */}
      <section className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Role Management</h3>
        </div>
        <div className="space-y-4 p-4">
          {isSelf && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
              You cannot change your own role.
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {(['donor', 'editor', 'admin'] as const).map((r) => (
              <button
                key={r}
                type="button"
                disabled={saving || isSelf}
                onClick={() => handleRoleChange(r)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  role === r
                    ? 'border-foreground/30 bg-muted/40'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {success && (
            <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
          )}
        </div>
      </section>

      {/* Donor Tags / Segmentation */}
      <section className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <TagIcon className="h-4 w-4" />
            Donor Tags
          </h3>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            {tags.length === 0 && (
              <p className="text-sm text-muted-foreground">No tags assigned.</p>
            )}
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button
                  type="button"
                  onClick={async () => {
                    const updated = tags.filter((t) => t !== tag);
                    try {
                      await fetch(`/api/v1/admin/users/${user.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tags: updated }),
                      });
                      setTags(updated);
                    } catch { /* ignore */ }
                  }}
                  className="ml-0.5 hover:text-destructive"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Add tag (e.g. major-donor, recurring, first-time)"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newTag.trim()) {
                  e.preventDefault();
                  const tag = newTag.trim().toLowerCase();
                  if (tags.includes(tag)) { setNewTag(''); return; }
                  const updated = [...tags, tag];
                  try {
                    await fetch(`/api/v1/admin/users/${user.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tags: updated }),
                    });
                    setTags(updated);
                    setNewTag('');
                  } catch { /* ignore */ }
                }
              }}
              className="max-w-xs"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!newTag.trim()}
              onClick={async () => {
                const tag = newTag.trim().toLowerCase();
                if (!tag || tags.includes(tag)) { setNewTag(''); return; }
                const updated = [...tags, tag];
                try {
                  await fetch(`/api/v1/admin/users/${user.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tags: updated }),
                  });
                  setTags(updated);
                  setNewTag('');
                } catch { /* ignore */ }
              }}
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>

          {/* Predefined tag suggestions */}
          {(() => {
            const suggestions = PREDEFINED_TAGS.filter((t) => !tags.includes(t));
            if (suggestions.length === 0) return null;
            return (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Quick-add:</p>
                <div className="flex flex-wrap gap-1">
                  {suggestions.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="rounded-full border border-dashed border-muted-foreground/30 px-2.5 py-0.5 text-xs text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors"
                      onClick={async () => {
                        const updated = [...tags, tag];
                        try {
                          await fetch(`/api/v1/admin/users/${user.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tags: updated }),
                          });
                          setTags(updated);
                        } catch { /* ignore */ }
                      }}
                    >
                      + {tag}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* Interaction Log (CRM) */}
      <InteractionTimeline userId={user.id} />

      {/* Relationships (CRM) */}
      <RelationshipsList userId={user.id} />

      {/* Donation history */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground">Donation History</h2>
        {donations.length === 0 ? (
          <div className="mt-4 rounded-lg border py-8 text-center text-muted-foreground">
            No donations from this user.
          </div>
        ) : (
          <div className="mt-4 relative overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Campaign</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">Phase</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground md:table-cell">Source</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {donations.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <Link
                        href={`/campaigns/${d.campaignSlug}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {d.campaignTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      <Money minor={d.amount} currency={d.currency} precision="exact" />
                    </td>
                    <td className="hidden px-4 py-2 sm:table-cell">
                      <PhaseBadge phase={d.phaseAtTime as DonationPhase} />
                    </td>
                    <td className="hidden px-4 py-2 md:table-cell">
                      <Badge variant={d.source === 'seed' ? 'outline' : 'secondary'}>
                        {d.source}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-2 text-muted-foreground sm:table-cell">
                      {formatDate(d.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Badges */}
      {badges.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Badges</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {badges.map((b, i) => (
              <Badge key={i} variant="secondary">
                {b.type} - {b.campaignSlug}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {/* Audit trail */}
      {auditEntries.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Activity Log</h2>
          <div className="mt-4 relative overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Event</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">Severity</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {auditEntries.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono text-sm">{a.eventType}</td>
                    <td className="hidden px-4 py-2 sm:table-cell">
                      <span className={SEVERITY_COLORS[a.severity] ?? 'text-muted-foreground'}>
                        {a.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatRelativeTime(a.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
