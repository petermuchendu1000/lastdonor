'use client';

/**
 * Tri-state client auth, and the one 429-aware read of `/api/auth/session`.
 *
 * ## Why this exists (docs/44)
 *
 * `next-auth/react` has exactly two answers for a client component: it has a
 * session, or it does not. `fetchData` in `next-auth/lib/client.js` catches
 * every transport and HTTP failure and returns `null`, and `SessionProvider`
 * stores that `null` as the session. So a 429, a 502, an offline tab and a
 * genuinely signed-out visitor all arrive at the UI as `status:
 * 'unauthenticated'`, and the header renders "Sign in" to a user who is still
 * holding a valid cookie.
 *
 * Here the three outcomes are kept apart:
 *
 *   authenticated - a 200 answer carrying a user
 *   anonymous     - a 200 answer carrying no user (the only conclusive "no")
 *   unknown       - anything else: 429, 5xx, a network error, or not read yet
 *
 * Nothing may render a sign-in call to action, or an auth-gated empty state,
 * for `unknown`.
 */

import { useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import type { Session } from 'next-auth';

/**
 * NextAuth's session endpoint. Hardcoded because `SessionProvider` is mounted
 * without a `basePath` prop and `NEXTAUTH_URL` is not exposed to the browser,
 * so `__NEXTAUTH.basePath` is the default `/api/auth`. It must stay in step
 * with `SESSION_READ_PATH` in `src/lib/rate-limit.ts`.
 */
export const SESSION_ENDPOINT = '/api/auth/session';

export type AuthState = 'authenticated' | 'anonymous' | 'unknown';

export type SessionProbe =
  | { outcome: 'authenticated'; session: Session }
  | { outcome: 'anonymous' }
  | { outcome: 'indeterminate'; reason: string; retryAfterMs: number };

/** Floor and ceiling applied to a server-supplied `Retry-After`. */
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const DEFAULT_RETRY_MS = 2_000;

// ─── "was the last session read conclusive?" store ──────────────────────────
//
// Module state, not context, because it is written from a plain async function
// and read from components that are not necessarily below the writer.

let conclusive = true;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

/** True when the most recent session read produced a definite answer. */
export function isSessionReadConclusive(): boolean {
  return conclusive;
}

export function markSessionReadConclusive(): void {
  if (conclusive) return;
  conclusive = true;
  emit();
}

export function markSessionReadIndeterminate(): void {
  if (!conclusive) return;
  conclusive = false;
  emit();
}

/** Test seam. Resets the flag without dropping React's subscriptions. */
export function resetSessionReadHealth(): void {
  conclusive = true;
  emit();
}

/** Subscribe a component to the conclusiveness flag. */
export function useSessionReadConclusive(): boolean {
  // Server snapshot is `true`: SSR renders the loading state anyway, and a
  // server render has no failed fetch to report.
  return useSyncExternalStore(subscribe, isSessionReadConclusive, () => true);
}

// ─── The probe ──────────────────────────────────────────────────────────────

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return DEFAULT_RETRY_MS;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_MS;
  return Math.min(Math.max(seconds * 1000, MIN_RETRY_MS), MAX_RETRY_MS);
}

function asSession(body: unknown): Session | null {
  if (!body || typeof body !== 'object') return null;
  const user = (body as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return null;
  return body as Session;
}

/**
 * Read the session once, keeping the HTTP status code.
 *
 * Only a 200 is allowed to conclude anything. Every other outcome is
 * `indeterminate`, which callers must surface as `unknown` rather than as
 * "signed out".
 */
export async function probeSessionRead(
  fetchImpl: typeof fetch = fetch,
): Promise<SessionProbe> {
  let response: Response;
  try {
    response = await fetchImpl(SESSION_ENDPOINT, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
  } catch {
    markSessionReadIndeterminate();
    return { outcome: 'indeterminate', reason: 'network', retryAfterMs: DEFAULT_RETRY_MS };
  }

  if (response.status !== 200) {
    markSessionReadIndeterminate();
    return {
      outcome: 'indeterminate',
      reason: `http_${response.status}`,
      retryAfterMs: retryAfterMs(response),
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    markSessionReadIndeterminate();
    return { outcome: 'indeterminate', reason: 'malformed', retryAfterMs: DEFAULT_RETRY_MS };
  }

  markSessionReadConclusive();
  const session = asSession(body);
  return session ? { outcome: 'authenticated', session } : { outcome: 'anonymous' };
}

// ─── The hook components should use ─────────────────────────────────────────

export interface AuthStateResult {
  state: AuthState;
  /** The session, only ever set when `state === 'authenticated'`. */
  session: Session | null;
  /** Convenience: `state === 'authenticated'`. */
  isAuthenticated: boolean;
  /** Convenience: `state === 'anonymous'`. The ONLY flag that may gate a sign-in CTA. */
  isAnonymous: boolean;
}

/**
 * Replacement for `useSession()` in anything that branches on being signed in.
 *
 * `status === 'unauthenticated'` is believed only when the last session read
 * was conclusive; otherwise the answer is `unknown` and the caller must hold
 * its previous or neutral rendering.
 */
export function useAuthState(): AuthStateResult {
  const { data, status } = useSession();
  const readConclusive = useSessionReadConclusive();

  let state: AuthState;
  if (status === 'authenticated' && data?.user) {
    state = 'authenticated';
  } else if (status === 'loading') {
    state = 'unknown';
  } else if (!readConclusive) {
    state = 'unknown';
  } else {
    state = 'anonymous';
  }

  return {
    state,
    session: state === 'authenticated' ? (data as Session) : null,
    isAuthenticated: state === 'authenticated',
    isAnonymous: state === 'anonymous',
  };
}
