'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

/**
 * Prevent open-redirect: only allow targets that resolve back to this origin.
 *
 * Prefix checks are NOT sufficient. `/\evil.com` starts with '/' and does not
 * start with '//', yet browsers normalise the backslash to a slash, so it
 * resolves to https://evil.com/ and the App Router performs a real
 * cross-origin navigation. The only reliable test is to resolve the candidate
 * against our own origin and compare origins.
 */
function safeCallbackUrl(raw: string | null): string {
  if (!raw) return '/dashboard';
  // During SSR there is no window; a reserved sentinel origin still resolves
  // relative paths identically while rejecting anything with an authority.
  const origin =
    typeof window === 'undefined' ? 'https://ssr.invalid' : window.location.origin;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return '/dashboard';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/dashboard';
  }
}

/**
 * Credential-failure copy. Read this before editing either string.
 *
 * `src/lib/auth.ts` emits exactly two codes of its own -
 * `invalid_credentials` and `password_reset_required` - because distinct
 * messages for locked / unknown / OAuth-only accounts turned this form into an
 * account-existence oracle (docs/32). Do not reintroduce them.
 *
 * But "one code from authorize()" is not "one outcome at the client".
 * `signIn()` reads `code` out of the callback URL
 * (node_modules/next-auth/react.js:175), and @auth/core also sends its own
 * default code `credentials` whenever `authorize` returns null or the
 * provider itself fails - which is what a database outage looks like. Those
 * two must not share one message: observed live 2026-10-15, a wrong password
 * and a dead database rendered the identical string, so the sign-in form told
 * a user who mistyped that the site was broken, and a user whose password was
 * correct to check their password. Opposite instructions from one sentence.
 *
 * So there are two messages, split on transient-vs-not, NOT on anything about
 * the account:
 *
 *   - `invalid_credentials` -> INVALID_CREDENTIALS_MESSAGE. Covers unknown
 *     address, wrong password, OAuth-only account and lockout alike, because
 *     `authorize()` collapses all four into this one code. "Incorrect email
 *     or password" is true of every one of them and names neither.
 *   - anything else -> TRANSIENT_FAILURE_MESSAGE. Says retry, claims nothing
 *     about the credentials, and does not blame the user for a server fault.
 *
 * Neither string is reached by a different path, at a different time or with a
 * different status depending on whether the account exists; the split is on
 * the server's own failure mode, which an enumerator cannot steer per address.
 * See docs/46 and `src/lib/auth.enumeration.test.ts`.
 */
const INVALID_CREDENTIALS_MESSAGE =
  'Incorrect email or password. Check both, or continue with Google.';

const TRANSIENT_FAILURE_MESSAGE =
  "We couldn't sign you in right now. Please try again shortly.";

/**
 * Plain-text twin of the forced-reset block rendered below. The inline path
 * renders that case with a real link; the `?error=` redirect path has only a
 * string to work with, so it points at the "Forgot password?" link that the
 * form already shows.
 */
const PASSWORD_RESET_REQUIRED_MESSAGE =
  'For your security, you must reset your password before logging in. Use the "Forgot password?" link below.';

/**
 * Copy for NextAuth's `?error=` codes. Without this the OAuth failure path
 * renders a blank login page: @auth/core sends SignInError subclasses to
 * `pages.signIn` (verified in node_modules/@auth/core/index.js: pageKind =
 * error.kind, and SignInError.kind === 'signIn'), so a user who registered
 * with a password and then clicks "Continue with Google" lands on
 * /login?error=OAuthAccountNotLinked with no explanation and loops forever.
 * `allowDangerousEmailAccountLinking` is deliberately NOT enabled - it would
 * let anyone controlling a Google account with a victim's address take over
 * the password account.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    'This email already has a LastDonor password. Sign in with your password below.',
  AccessDenied:
    'Google sign-in was declined or cancelled. Try again, or sign in with your email and password below.',
  Verification:
    'That sign-in link has expired or was already used. Try again, or sign in with your email and password below.',
};

const OAUTH_ERROR_FALLBACK =
  "We couldn't complete that sign-in. Try again, or sign in with your email and password below.";

/**
 * Copy for a credentials failure that arrived on the redirect path rather than
 * inline. `?error=CredentialsSignin` always travels with `?code=`, so the same
 * split used inline applies here: only `invalid_credentials` may say the
 * credentials were wrong.
 */
function credentialsErrorMessage(credentialsCode: string | null | undefined): string {
  if (credentialsCode === 'invalid_credentials') return INVALID_CREDENTIALS_MESSAGE;
  if (credentialsCode === 'password_reset_required') return PASSWORD_RESET_REQUIRED_MESSAGE;
  return TRANSIENT_FAILURE_MESSAGE;
}

function oauthErrorMessage(
  code: string | null,
  credentialsCode?: string | null,
): string | null {
  if (!code) return null;
  // Only reachable on the redirect path (the form posts with redirect: false),
  // but it must stay as non-disclosing as an inline failure.
  if (code === 'CredentialsSignin') return credentialsErrorMessage(credentialsCode);
  return OAUTH_ERROR_MESSAGES[code] ?? OAUTH_ERROR_FALLBACK;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
  const oauthError = oauthErrorMessage(
    searchParams.get('error'),
    searchParams.get('code'),
  );
  const registerHref = callbackUrl !== '/dashboard'
    ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : '/register';
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(data: LoginFormValues) {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        const code = (result as { code?: string }).code;
        // Three outcomes, split on the server's failure mode and never on
        // anything about the account. See INVALID_CREDENTIALS_MESSAGE.
        if (code === 'password_reset_required') {
          setError('password_reset_required');
        } else if (code === 'invalid_credentials') {
          setError('invalid_credentials');
        } else {
          // @auth/core's own default code (`credentials`), a missing code, or
          // anything it adds later. A provider-level fault, not the user's
          // typing - a database outage lands here.
          setError('signin_transient');
        }
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      // The sign-in POST itself never completed, so nothing is known about the
      // credentials. Transient by definition.
      setError('signin_transient');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    await signIn('google', { callbackUrl });
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[--shadow-elevation-2] sm:p-10">
          <div className="text-center">
            <h1 className="font-display text-3xl font-bold tracking-tight text-card-foreground">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Log in to track your donations and saved campaigns.
            </p>
          </div>

          {(error ?? oauthError) && (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error === 'password_reset_required' && (
                <>
                  For your security, you must reset your password before logging in.{' '}
                  <Link href="/login/forgot-password" className="font-semibold underline">
                    Reset your password
                  </Link>
                </>
              )}
              {error === 'invalid_credentials' && (
                <>
                  {INVALID_CREDENTIALS_MESSAGE}{' '}
                  <Link href="/login/forgot-password" className="font-semibold underline">
                    Reset your password
                  </Link>
                </>
              )}
              {/* No reset link here: the password is not the problem, and
                  sending a user to Forgot password during an outage costs
                  them a reset they did not need. */}
              {error === 'signin_transient' && <>{TRANSIENT_FAILURE_MESSAGE}</>}
              {!error && oauthError}
            </div>
          )}

          {/* SSO first - the Friction-Cost-optimized path. Most returning users
              authenticated via Google previously, so surface it above the fold. */}
          <Button
            variant="outline"
            onClick={handleGoogleSignIn}
            className="btn-press mt-6 w-full"
            type="button"
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </Button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-wider">
              <span className="bg-card px-3 text-muted-foreground">
                or with email
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...register('email')}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/login/forgot-password"
                  className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
                aria-describedby={errors.password ? 'password-error' : undefined}
              />
              {errors.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button type="submit" className="btn-press w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link
            href={registerHref}
            className="font-semibold text-primary hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
