'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircleIcon } from '@/components/ui/icon';

/**
 * Phone number + SMS consent, on the account screen.
 *
 * `docs/83` is the reason this is a card on a page somebody already
 * visits rather than a route you have to know about: an integration whose
 * entry point nobody can reach is not shipped.
 *
 * Two things it refuses to blur:
 *
 *   - **Sandbox is announced.** When `AT_USERNAME=sandbox`, Africa's
 *     Talking delivers to its simulator and the person's handset never
 *     rings. Saying "we sent you a text" would be a lie, so it says where
 *     the message actually went.
 *   - **Consent is a second switch**, not a consequence of verifying.
 *     Proving a number reaches you is not agreeing to be messaged on it.
 */

interface PhoneState {
  phone: string;
  verified: boolean;
  smsConsent: boolean;
  smsAvailable: boolean;
  smsSandbox: boolean;
}

type Stage = 'idle' | 'code-sent';

export function PhoneVerificationCard() {
  const [state, setState] = useState<PhoneState | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A submit latch, as docs/42 used on the donate form: a double click
  // must not mint two codes and burn the cooldown.
  const busy = useRef(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/v1/users/phone')
      .then((r) => r.json())
      .then((j) => {
        if (live && j?.ok) setState(j.data as PhoneState);
      })
      .catch(() => {
        /* Leave the card in its loading shape rather than claiming a state. */
      });
    return () => {
      live = false;
    };
  }, []);

  async function call(method: 'POST' | 'PUT' | 'PATCH', payload: unknown) {
    if (busy.current) return null;
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/v1/users/phone', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json?.ok) {
        setError(json?.error?.message ?? 'Something went wrong. Try again.');
        return null;
      }
      return json.data as Record<string, unknown>;
    } catch {
      setError('We could not reach the server. Try again.');
      return null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function sendCode() {
    const data = await call('POST', { phone });
    if (!data) return;
    setStage('code-sent');
    setNotice(
      data.sandbox
        ? `Test mode: the code went to the Africa's Talking simulator, not to ${String(data.phone)}.`
        : `We sent a code to ${String(data.phone)}.`,
    );
  }

  async function submitCode() {
    const data = await call('PUT', { code });
    if (!data) return;
    setStage('idle');
    setCode('');
    setState((s) => (s ? { ...s, verified: true, phone: String(data.phone) } : s));
    setNotice('Phone number verified.');
  }

  async function toggleConsent(next: boolean) {
    const data = await call('PATCH', { smsConsent: next });
    if (!data) return;
    setState((s) => (s ? { ...s, smsConsent: next } : s));
    setNotice(next ? 'Text messages are on.' : 'Text messages are off.');
  }

  if (!state) {
    return (
      <section className="rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Phone number</h2>
        <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">Phone number</h2>

      {state.verified ? (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-brand-green">
          <CheckCircleIcon size="sm" />
          <span>{state.phone} is verified</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Verify a number so we can reach you about your campaign.
        </p>
      )}

      {!state.smsAvailable ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Text messaging is not switched on yet.
        </p>
      ) : (
        <>
          {state.smsSandbox && (
            <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <strong className="font-semibold">Test mode.</strong> Codes go to the
              Africa&apos;s Talking simulator, not to a real handset.
            </p>
          )}

          {stage === 'idle' ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <Label htmlFor="phone-number">
                  {state.verified ? 'Change number' : 'Mobile number'}
                </Label>
                <Input
                  id="phone-number"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+254 712 345 678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <Button onClick={sendCode} disabled={pending || !phone.trim()}>
                {pending ? 'Sending…' : 'Send code'}
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[8rem]">
                <Label htmlFor="phone-code">6-digit code</Label>
                <Input
                  id="phone-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <Button onClick={submitCode} disabled={pending || !code.trim()}>
                {pending ? 'Checking…' : 'Verify'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setStage('idle');
                  setCode('');
                  setError(null);
                  setNotice(null);
                }}
                disabled={pending}
              >
                Use a different number
              </Button>
            </div>
          )}

          {state.verified && (
            <label className="mt-4 flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={state.smsConsent}
                disabled={pending}
                onChange={(e) => toggleConsent(e.target.checked)}
              />
              <span>
                Text me about my campaign.
                <span className="block text-xs text-muted-foreground">
                  Message rates may apply. You can switch this off at any time.
                </span>
              </span>
            </label>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </section>
  );
}
