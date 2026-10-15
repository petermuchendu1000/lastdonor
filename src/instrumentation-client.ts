import * as Sentry from '@sentry/nextjs';

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
});
