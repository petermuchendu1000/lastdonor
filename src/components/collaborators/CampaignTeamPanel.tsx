'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Member {
  id: string;
  email: string;
  accepted: boolean;
}

/**
 * The organiser's view of their team: who is on it, invite, remove.
 *
 * ⛔ Creator only. The page this sits on is already gated to the creator and
 * staff, and the API refuses anybody else - a collaborator cannot invite or
 * remove, because the trust root is the person who started the campaign
 * (`docs/111` §1).
 *
 * ⚠️ The panel says what a helper can and cannot do, on screen, before the
 * organiser invites anybody. An organiser who believes they are handing over
 * the money would invite differently from one who knows they are not, and
 * the invitation email says the same thing to the helper.
 */
export function CampaignTeamPanel({ campaignId }: { campaignId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/user-campaigns/${campaignId}/collaborators`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        // A failed read must not render as "no helpers" - that would invite
        // somebody already on the team and read as a duplicate error.
        setMembers(null);
        setError('Could not load your helpers. Reload the page.');
        return;
      }
      const body = await res.json();
      setMembers(body?.data?.collaborators ?? []);
      setLimit(body?.data?.limit ?? null);
    } catch {
      setMembers(null);
      setError('Could not load your helpers. Reload the page.');
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await fetch(`/api/v1/user-campaigns/${campaignId}/collaborators`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? 'Could not send that invitation.');
        return;
      }
      setSent(email);
      setEmail('');
      await load();
    } catch {
      setError('Could not send that invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/user-campaigns/${campaignId}/collaborators/${id}`,
        { method: 'DELETE', credentials: 'same-origin' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not remove that person.');
        return;
      }
      await load();
    } catch {
      setError('Could not remove that person.');
    } finally {
      setBusy(false);
    }
  }

  const atLimit = limit !== null && members !== null && members.length >= limit;

  return (
    <section className="rounded-lg border border-border bg-card p-6" aria-labelledby="team-heading">
      <h2 id="team-heading" className="font-display text-lg font-bold text-foreground">
        People helping you
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Ask family or friends to help. They can write updates and change what
        the page says.
      </p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        <strong className="text-foreground">They cannot touch the money.</strong>{' '}
        Only you can ask for a payout or change where it goes. Only you can add
        or remove helpers.
      </p>

      <form onSubmit={invite} className="mt-5 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="invite-email" className="sr-only">
          Email address to invite
        </label>
        <Input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their@email.com"
          disabled={busy || atLimit}
          className="sm:flex-1"
        />
        <Button type="submit" disabled={busy || atLimit || email.trim().length < 3}>
          {busy ? 'Sending…' : 'Send invitation'}
        </Button>
      </form>

      {atLimit && (
        <p className="mt-2 text-sm text-muted-foreground">
          You have {limit} helpers, which is the most for one campaign. Remove
          somebody to invite another.
        </p>
      )}
      {sent && (
        <p role="status" className="mt-2 text-sm font-medium text-primary">
          Invitation sent to {sent}.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {members !== null && members.length > 0 && (
        <ul className="mt-5 divide-y divide-border border-t border-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{m.email}</p>
                <p className="text-xs text-muted-foreground">
                  {m.accepted ? 'Helping now' : 'Invited, waiting for them to accept'}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => remove(m.id)}
                disabled={busy}
                aria-label={`Remove ${m.email}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {members !== null && members.length === 0 && (
        <p className="mt-5 text-sm text-muted-foreground">
          Nobody is helping yet.
        </p>
      )}

      {/*
        The growth half of this feature already worked and nothing told
        anybody (`docs/111` §6): pressing Share on the campaign page gives any
        signed-in person their OWN attributed link, and `/dashboard/impact`
        shows what each link brought in. A helper who never hears that shares
        the plain URL and sees nothing.
      */}
      <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
        Everyone who helps gets their own share link. Press Share on the
        campaign page, then see what it brought in on{' '}
        <Link href="/dashboard/impact" className="font-medium text-primary underline-offset-4 hover:underline">
          your impact page
        </Link>
        .
      </p>
    </section>
  );
}
