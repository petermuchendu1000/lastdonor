'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

/**
 * The button that actually accepts an invitation.
 *
 * It POSTs. The page it sits on deliberately does nothing on load, because
 * mail clients and link scanners fetch the URLs in an email before a person
 * reads it - see the note on `collaborate/accept/page.tsx`.
 *
 * ⚠️ One failure message for every refusal, matching the API. "Expired",
 * "already taken" and "no such token" would each tell the holder of a guessed
 * token something about which tokens exist. The real reason is in the audit
 * trail, where only we can read it.
 */
export function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setState('working');
    setError(null);
    try {
      const res = await fetch('/api/v1/collaborators/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setError(
          body?.error?.message ??
            'That invitation is no longer valid. Ask the organiser to send a new one.',
        );
        setState('idle');
        return;
      }

      setState('done');
      // The dashboard is where the campaign now appears for them.
      router.push('/dashboard/campaigns?joined=1');
    } catch {
      setError('Something went wrong. Try again in a moment.');
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className="mt-6 text-sm font-semibold text-primary">
        You are in. Taking you to your campaigns…
      </p>
    );
  }

  return (
    <div className="mt-6">
      <Button onClick={accept} disabled={state === 'working'}>
        {state === 'working' ? 'Accepting…' : 'Accept and start helping'}
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
