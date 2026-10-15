import * as Sentry from '@sentry/nextjs';
import type { Breadcrumb, Event } from '@sentry/nextjs';

/**
 * Sentry's `environment` tag.
 *
 * `NEXT_PUBLIC_VERCEL_ENV` is a Vercel-only variable and is UNSET on Fly (docs/26 §1 lists
 * the Vercel couplings to remove). Reading it alone tagged every production
 * event `development`, which silently breaks environment filters, alert rules
 * and release health — the errors arrive, but in the wrong bucket.
 *
 * Order: an explicit override, then Vercel's value if this ever runs there,
 * then NODE_ENV, which Fly sets to `production` in the runtime stage.
 */
// NEXT_PUBLIC_* is inlined at build time, so this is fixed when the image
// is built, not when the server boots.
const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
  process.env.NEXT_PUBLIC_VERCEL_ENV ??
  (process.env.NODE_ENV === 'production' ? 'production' : 'development');

/* ---- URL scrubbing: reset tokens must never reach Sentry -------------------
 *
 * `/login/reset-password?token=...&email=...` carries a working
 * account-takeover credential in the query string, valid for one hour
 * (`forgot-password/route.ts`, TOKEN_EXPIRY_MS). Sentry's browser SDK attaches
 * `window.location.href` to every event it sends and to navigation
 * breadcrumbs, and this client runs with `tracesSampleRate` 0.1 and
 * `replaysOnErrorSampleRate` 1.0 — so any error on that page uploaded the
 * credential to a third party, where it sits in an event store that a much
 * larger set of people can read than can read the user's mailbox.
 *
 * These hooks redact the value of `token` and `email` wherever they appear as a
 * query (or fragment) parameter in anything we are about to send: the request
 * URL and query string, request headers such as `Referer`, the transaction
 * name, breadcrumb URLs and messages, trace context, tags, extras and
 * exception messages.
 *
 * Known residual gap, out of scope for this file: Session Replay ships its own
 * envelope, which `beforeSend` does not pass through. `beforeBreadcrumb` below
 * covers the navigation breadcrumbs replay reuses, but a full fix needs
 * `replayIntegration({ beforeAddRecordingEvent })` or excluding
 * `/login/reset-password` from replay.
 */

/** Query/fragment parameters whose values are credentials or PII. */
const SENSITIVE_PARAMS = ['token', 'email'] as const;

const REDACTED = '[redacted]';

/**
 * One regex per parameter, matching `token=…` after `?`, `&`, `#` or at the
 * very start of the string, up to the next delimiter. Deliberately
 * string-based rather than `new URL()`: the values we scrub also show up in
 * relative paths, `Referer` headers, bare query strings
 * (`event.request.query_string` has no leading `?`) and free-text error
 * messages, none of which parse as absolute URLs.
 *
 * The leading `(^|[?&#])` is what keeps `mytoken=` and `csrf_token=` out of
 * scope — the name must start the parameter, not merely appear in it.
 */
const SENSITIVE_PATTERNS = SENSITIVE_PARAMS.map(
  (param) => new RegExp(`(^|[?&#])(${param}=)[^&#\\s"']*`, 'gi'),
);

/** Redact sensitive query-parameter values in any string. */
export function scrubSensitiveUrl(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, `$1$2${REDACTED}`);
  }
  return out;
}

/**
 * Walk a value, redacting every string it contains. Depth-limited because
 * Sentry payloads can nest arbitrarily and this runs on the hot path of every
 * event. Mutates arrays and plain objects in place; returns scalars.
 */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubSensitiveUrl(value);
  if (depth >= 5 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = scrubDeep(value[i], depth + 1);
    }
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    record[key] = scrubDeep(record[key], depth + 1);
  }
  return record;
}

/**
 * Redact sensitive parameters from every part of an outgoing event that can
 * carry a URL. Shared by `beforeSend` and `beforeSendTransaction`, and exported
 * so the guarantee is testable without a live Sentry transport.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  if (event.request) {
    if (typeof event.request.url === 'string') {
      event.request.url = scrubSensitiveUrl(event.request.url);
    }
    if (event.request.query_string !== undefined) {
      event.request.query_string = scrubDeep(
        event.request.query_string,
      ) as typeof event.request.query_string;
    }
    if (event.request.headers) {
      // `Referer` on a request made from the reset page is the reset URL.
      event.request.headers = scrubDeep(event.request.headers) as Record<string, string>;
    }
    if (event.request.data !== undefined) {
      event.request.data = scrubDeep(event.request.data);
    }
  }

  // The transaction name is the route for App Router events, but a
  // `window.location`-derived name would otherwise ship the token verbatim.
  if (typeof event.transaction === 'string') {
    event.transaction = scrubSensitiveUrl(event.transaction);
  }

  if (typeof event.message === 'string') {
    event.message = scrubSensitiveUrl(event.message);
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubSentryBreadcrumb);
  }

  if (event.contexts?.trace?.data) {
    event.contexts.trace.data = scrubDeep(event.contexts.trace.data) as Record<string, unknown>;
  }

  if (event.tags) {
    event.tags = scrubDeep(event.tags) as typeof event.tags;
  }

  if (event.extra) {
    event.extra = scrubDeep(event.extra) as typeof event.extra;
  }

  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === 'string') {
      exception.value = scrubSensitiveUrl(exception.value);
    }
  }

  return event;
}

/**
 * Redact sensitive parameters from a breadcrumb. Navigation breadcrumbs carry
 * `data.from` / `data.to`, fetch and XHR breadcrumbs carry `data.url`, and the
 * message is often the URL itself.
 */
export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (typeof breadcrumb.message === 'string') {
    breadcrumb.message = scrubSensitiveUrl(breadcrumb.message);
  }
  if (breadcrumb.data) {
    breadcrumb.data = scrubDeep(breadcrumb.data) as Record<string, unknown>;
  }
  return breadcrumb;
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,

  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session replay (lazy loaded)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Only send errors in non-development
  enabled: process.env.NODE_ENV !== 'development',

  // Filter out noisy errors
  ignoreErrors: [
    'ResizeObserver loop',
    'Non-Error promise rejection',
    'AbortError',
    'cancelled',
  ],

  // Strip password-reset credentials before anything leaves the browser.
  // Parameter types come from `Sentry.init`'s own option types (`ErrorEvent`
  // and `TransactionEvent`); only `TransactionEvent` is not re-exported by
  // `@sentry/nextjs`, so they are left to contextual typing rather than
  // importing from the transitive `@sentry/core`.
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
  beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
});
