'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  CheckCircleIcon,
  XCircleIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { ShieldCheckIcon } from '@heroicons/react/24/solid';

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Enter a valid email'),
  password: z
    .string()
    .min(10, 'Must be at least 10 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[0-9]/, 'Must contain a digit'),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

const PASSWORD_RULES = [
  { label: 'At least 10 characters', test: (v: string) => v.length >= 10 },
  { label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'One lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { label: 'One digit', test: (v: string) => /[0-9]/.test(v) },
] as const;

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
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
 * against our own origin and compare origins. Kept byte-identical to the copy
 * in `src/app/login/page.tsx`.
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

/* ---- Why this page does not sign you in (audit A4, docs/39) ---------------
 *
 * `POST /api/auth/register` answers a duplicate address with the SAME status
 * and the SAME body as a creation (commit 9a14dc6), so that one HTTP request
 * per address can no longer tell an anonymous caller whether a named person
 * has an account on a platform that publishes medical and hardship appeals.
 *
 * This page used to defeat that from the client. It auto-signed-in after the
 * 201 and branched on the result: a fresh address got a session and
 * `router.push(callbackUrl)`, a registered address failed `authorize()` and
 * got `router.push('/login?...')`. Submitting an address with a junk password
 * and reading which screen came back was exactly the oracle the route had
 * just given up — same information, one extra request.
 *
 * Any fix that reads the sign-in result IS the oracle, however the two
 * branches are dressed up, so auto-sign-in is gone. Both outcomes now reach
 * the same terminal screen below, and the thing that tells the two apart is
 * sent to the submitted address instead (`notifyRegistrationOutcome`), where
 * only the inbox owner can read it.
 *
 * The cost is one extra step for a genuinely new user: they sign in with the
 * password they chose seconds ago, via the email or the button on that
 * screen. Accepted deliberately — see docs/39 for the alternatives weighed.
 *
 * Validation failures (400) stay specific and are rendered as before: they
 * describe the submitted input, not the state of someone else's account.
 */
function RegisterForm() {
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Set once the API accepts the submission; the address is echoed back. */
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const passwordValue = watch('password') ?? '';

  async function onSubmit(data: RegisterFormValues) {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          body?.error?.message ?? 'Registration failed. Please try again.',
        );
        return;
      }

      // Accepted. Nothing here may depend on whether the address was free:
      // the response deliberately cannot say, and probing for it (signing in,
      // requesting a session, timing a second call) would rebuild the oracle.
      // The outcome is identical for both, and the email carries the rest.
      setSubmittedEmail(data.email);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    await signIn('google', { callbackUrl });
  }

  const loginHref =
    callbackUrl !== '/dashboard'
      ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : '/login';

  // The one terminal screen. Every word of it is fixed copy plus the address
  // the visitor typed, so it is byte-identical whether or not that address was
  // already registered — including the sign-in link, whose target comes from
  // the URL and never from the response. Nothing here may become conditional
  // on the API response body: it is the same body either way, and a branch on
  // it would be a branch on nothing while looking like a feature.
  if (submittedEmail) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-muted/30 px-4 py-12">
        <div className="w-full max-w-md">
          <div
            role="status"
            className="rounded-2xl border border-border bg-card p-8 text-center shadow-[--shadow-elevation-2] sm:p-10"
          >
            <EnvelopeIcon
              className="mx-auto h-10 w-10 text-brand-teal"
              aria-hidden="true"
            />
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-card-foreground">
              Check your email
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              We sent a message to{' '}
              <strong className="font-semibold text-card-foreground">
                {submittedEmail}
              </strong>{' '}
              with a link to sign in.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              If that address already had a LastDonor.org account, the email
              explains how to get back into it. Either way, there is nothing
              more to do on this page.
            </p>

            <Link
              href={loginHref}
              className={buttonVariants({
                className: 'btn-press mt-6 h-10 w-full',
              })}
            >
              Go to sign-in
            </Link>

            <p className="mt-4 text-xs text-muted-foreground">
              Nothing after a few minutes? Check your spam folder, or{' '}
              <Link
                href="/login/forgot-password"
                className="font-semibold text-primary hover:underline"
              >
                reset your password
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="relative rounded-2xl border border-border bg-card p-8 shadow-[--shadow-elevation-2] sm:p-10">
          {/* Submitting overlay */}
          {isSubmitting && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-2xl bg-card/80 backdrop-blur-sm">
              <svg
                className="h-8 w-8 animate-spin text-primary"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-sm font-medium text-card-foreground">Creating your account...</p>
            </div>
          )}
          <div className="text-center">
            <h1 className="font-display text-3xl font-bold tracking-tight text-card-foreground">
              Create your free account
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Takes under 30 seconds. No donation required.
            </p>
          </div>

          {/* Reciprocity: make the value of registering concrete up front. */}
          <ul className="mt-6 space-y-2.5">
            <li className="flex items-start gap-2.5 text-sm text-card-foreground">
              <span>Track every donation and the impact it made.</span>
            </li>
            <li className="flex items-start gap-2.5 text-sm text-card-foreground">
              <span>Save campaigns and get updates as they close.</span>
            </li>
            <li className="flex items-start gap-2.5 text-sm text-card-foreground">
              <span>One-tap checkout next time you give.</span>
            </li>
          </ul>

          {error && (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {/* SSO first - most new users sign up via Google; reduce Friction Cost. */}
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
            Sign up with Google
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
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                autoComplete="name"
                placeholder="Your name"
                {...register('name')}
                aria-describedby={errors.name ? 'name-error' : undefined}
              />
              {errors.name && (
                <p id="name-error" className="text-sm text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
                aria-describedby="password-requirements"
              />
              <div id="password-requirements" className="mt-2 space-y-1">
                {PASSWORD_RULES.map((rule) => {
                  const passes = rule.test(passwordValue);
                  return (
                    <div
                      key={rule.label}
                      className="flex items-center gap-2 text-xs"
                    >
                      {passes ? (
                        <CheckCircleIcon className="h-4 w-4 text-brand-green" />
                      ) : (
                        <XCircleIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span
                        className={
                          passes ? 'text-brand-green' : 'text-muted-foreground'
                        }
                      >
                        {rule.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <Button type="submit" className="btn-press w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          {/* Zero-Knowledge Proof: reduce FUD around email/privacy. */}
          <p className="mt-5 flex items-start justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-teal" aria-hidden="true" />
            <span>No spam. We&apos;ll never share or sell your email.</span>
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href={loginHref} className="font-semibold text-primary hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
