'use client';

/**
 * The single owner of the browser's view of the session (docs/44).
 *
 * ## The two bugs this file exists to fix
 *
 * 1. **One navigation used to cost two `GET /api/auth/session`.**
 *    `SessionProvider` fetches on mount when it is given no `session` prop.
 *    That fetch goes through `getSession()`, which (next-auth PR #10762 /
 *    #11470) posts `{event:'session'}` on a *freshly constructed*
 *    `BroadcastChannel('next-auth')`. A BroadcastChannel never receives its own
 *    messages, but `SessionProvider` listens on a *different* channel object in
 *    the same document, so it does receive it, treats it as a cross-tab event
 *    and refetches. Verified by reading
 *    `node_modules/next-auth/react.js` (5.0.0-beta.30) lines 102-112, 243-303.
 *
 * 2. **A rate-limited or failed read looked like a sign-out.** `fetchData`
 *    returns `null` for any non-2xx, and `SessionProvider` stores it.
 *
 * ## The arrangement
 *
 *     <SessionProvider session={null}>   <- never fetches; see below
 *       <SessionGate>                    <- owns the truth, probes once
 *         <SessionContext.Provider>      <- what every useSession() reads
 *
 * Giving the outer provider an explicit `session` makes `hasInitialSession`
 * true, so its mount effect returns before fetching, and because the value is
 * `null` its visibility-change handler also returns early. It therefore issues
 * no request of its own. It is kept in the tree for the behaviour that lives in
 * it and nowhere else: `signIn()` / `signOut()` reach the client through
 * `__NEXTAUTH._getSession`, which only exists while a provider is mounted, and
 * the cross-tab BroadcastChannel listener.
 *
 * `SessionGate` reads that outer context with `useSession()` and re-publishes
 * its own value, so children see a *tri-state* session: `loading` until a
 * conclusive answer exists. Both providers are mounted for the whole document
 * lifetime and never change element type, so nothing below them ever remounts.
 *
 * Cost: one request per full document load, zero per client-side navigation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SessionContext, SessionProvider, useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import {
  markSessionReadConclusive,
  probeSessionRead,
  type SessionProbe,
} from '@/lib/auth-state';

/**
 * How many times an inconclusive read is retried before the gate gives up and
 * stays `unknown`. With the `Retry-After` the limiter sends (about 11s) this
 * recovers on its own inside roughly half a minute.
 */
const MAX_PROBE_ATTEMPTS = 4;

type ContextValue = NonNullable<React.ContextType<typeof SessionContext>>;

/** `undefined` means "not determined", which is NOT the same as `null`. */
type OwnSession = Session | null | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function SessionGate({ children }: { children: React.ReactNode }) {
  // The outer provider's state. It is `unauthenticated` from the start (we hand
  // it `null`) and only ever becomes meaningful after signIn/signOut or a
  // cross-tab event, which is why `previousOuterStatus` is needed below.
  const outer = useSession();
  const [own, setOwn] = useState<OwnSession>(undefined);

  const mounted = useRef(true);
  const probing = useRef(false);
  const previousOuterStatus = useRef(outer.status);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** One conclusive read, retried while the answer is indeterminate. */
  const probe = useCallback(async (): Promise<void> => {
    if (probing.current) return;
    probing.current = true;
    try {
      for (let attempt = 1; attempt <= MAX_PROBE_ATTEMPTS; attempt += 1) {
        const result: SessionProbe = await probeSessionRead();
        if (!mounted.current) return;

        if (result.outcome === 'authenticated') {
          setOwn(result.session);
          return;
        }
        if (result.outcome === 'anonymous') {
          setOwn(null);
          return;
        }

        // Indeterminate: hold the UI in its unknown state rather than claiming
        // the visitor is anonymous, and try again.
        setOwn(undefined);
        if (attempt === MAX_PROBE_ATTEMPTS) return;
        await sleep(result.retryAfterMs);
        if (!mounted.current) return;
      }
    } finally {
      probing.current = false;
    }
  }, []);

  // The one read per document load.
  useEffect(() => {
    void probe();
  }, [probe]);

  // Adopt anything next-auth learns on its own: `signIn({redirect:false})` on
  // the login page and cross-tab sign-in/sign-out both land here.
  useEffect(() => {
    const previous = previousOuterStatus.current;
    previousOuterStatus.current = outer.status;

    if (outer.status === 'authenticated' && outer.data?.user) {
      markSessionReadConclusive();
      setOwn(outer.data);
      return;
    }

    if (previous === 'authenticated' && outer.status === 'unauthenticated') {
      // next-auth cannot tell a real sign-out from a 429: both reach it as
      // `null`. Go back to unknown and let the status-code-aware probe decide.
      setOwn(undefined);
      void probe();
    }
  }, [outer.status, outer.data, probe]);

  const value = useMemo<ContextValue>(() => {
    const update = async (): Promise<Session | null> => {
      const result = await probeSessionRead();
      if (result.outcome === 'authenticated') {
        setOwn(result.session);
        return result.session;
      }
      if (result.outcome === 'anonymous') {
        setOwn(null);
        return null;
      }
      setOwn(undefined);
      return null;
    };

    if (own === undefined) {
      return { data: null, status: 'loading', update };
    }
    if (own === null) {
      return { data: null, status: 'unauthenticated', update };
    }
    return { data: own, status: 'authenticated', update };
  }, [own]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider session={null}>
      <SessionGate>{children}</SessionGate>
    </SessionProvider>
  );
}
