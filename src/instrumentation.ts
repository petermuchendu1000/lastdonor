import * as Sentry from '@sentry/nextjs';

/**
 * Sentry's `environment` tag.
 *
 * `VERCEL_ENV` is a Vercel-only variable and is UNSET on Fly (docs/26 §1 lists
 * the Vercel couplings to remove). Reading it alone tagged every production
 * event `development`, which silently breaks environment filters, alert rules
 * and release health — the errors arrive, but in the wrong bucket.
 *
 * Order: an explicit override, then Vercel's value if this ever runs there,
 * then NODE_ENV, which Fly sets to `production` in the runtime stage.
 */
const SENTRY_ENVIRONMENT =
  process.env.SENTRY_ENVIRONMENT ??
  process.env.VERCEL_ENV ??
  (process.env.NODE_ENV === 'production' ? 'production' : 'development');

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: SENTRY_ENVIRONMENT,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
      enabled: process.env.NODE_ENV !== 'development',
    });

    const { enforceSecrets } = await import('@/lib/validate-secrets');
    enforceSecrets();

    /*
      The wedge watchdog (docs/87). It runs here rather than as a cron
      route for two reasons: no cron has ever run in production
      (docs/65), and a route would come in through the same pool the
      watchdog exists to rescue. It opens its own single connection.
    */
    const { startWedgeWatchdog } = await import('@/db/wedge-watchdog');
    startWedgeWatchdog();
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: SENTRY_ENVIRONMENT,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
      enabled: process.env.NODE_ENV !== 'development',
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
