'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { subscribeSchema } from '@/lib/validators/newsletter';
import type { SubscribeInput } from '@/lib/validators/newsletter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { EnvelopeIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

type NewsletterVariant = 'inline' | 'hero' | 'footer';

/**
 * Only a brand-new subscription triggers a welcome email, so only that case may
 * tell the reader to check their inbox. `already_subscribed` and `resubscribed`
 * send nothing — the component used to promise mail for all three.
 */
const SUCCESS_MESSAGE = {
  subscribed: "You're subscribed! Check your inbox.",
  resubscribed: "You're subscribed again. Welcome back!",
  already_subscribed: "You're already subscribed.",
} as const;

const SUCCESS_TOAST = {
  subscribed: 'Welcome! Check your inbox for a confirmation.',
  resubscribed: 'Welcome back! Your subscription is active again.',
  already_subscribed: 'You are already subscribed.',
} as const;

interface NewsletterSignupProps {
  source: 'homepage' | 'campaign' | 'blog' | 'footer';
  /** Visual variant: inline (default), hero (homepage section), footer (dark bg). */
  variant?: NewsletterVariant;
  className?: string;
}

export function NewsletterSignup({ source, variant = 'inline', className }: NewsletterSignupProps) {
  const [subscribed, setSubscribed] = useState(false);
  /** Which API outcome produced the success panel; only 'subscribed' sends mail. */
  const [outcome, setOutcome] = useState<'subscribed' | 'resubscribed' | 'already_subscribed'>('subscribed');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<SubscribeInput>({
    resolver: zodResolver(subscribeSchema),
    defaultValues: { source },
  });

  async function onSubmit(data: SubscribeInput) {
    const res = await fetch('/api/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const body = await res.json().catch(() => null);

    if (!res.ok || body?.ok === false) {
      // Note: the API never answers 409 — the old `res.status === 409` branch
      // was dead code. Already-subscribed is a 200 with status
      // 'already_subscribed'.
      toast.error(body?.error?.message ?? 'Subscription failed. Please try again.');
      return;
    }

    // Only a brand-new subscription sends a welcome email. Telling an existing
    // or re-activated subscriber to check their inbox promises mail that is
    // never sent (cf. src/app/newsletter/form.tsx, which branches correctly).
    const status: string | undefined = body?.data?.status;
    const resolved =
      status === 'already_subscribed' || status === 'resubscribed' ? status : 'subscribed';
    setOutcome(resolved);
    setSubscribed(true);
    toast.success(SUCCESS_TOAST[resolved]);
    reset();
  }

  if (subscribed) {
    const successClass = variant === 'footer'
      ? 'text-sm font-medium text-brand-amber'
      : 'flex items-center gap-2 text-brand-teal font-medium';

    return (
      <div className={cn(successClass, className)} role="status" aria-live="polite">
        {variant !== 'footer' && <EnvelopeIcon className="h-5 w-5" />}
        <p>{SUCCESS_MESSAGE[outcome]}</p>
      </div>
    );
  }

  if (variant === 'footer') {
    return (
      <form onSubmit={handleSubmit(onSubmit)} className={cn('flex w-full max-w-sm flex-col gap-2 sm:flex-row', className)}>
        <label htmlFor="footer-newsletter-email" className="sr-only">Email address</label>
        <input
          id="footer-newsletter-email"
          type="email"
          required
          placeholder="Your email"
          {...register('email')}
          className="flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-400 transition-colors focus:border-brand-amber focus:outline-none focus:ring-2 focus:ring-brand-amber/30"
        />
        <input type="hidden" {...register('source')} />
        <button
          type="submit"
          disabled={isSubmitting}
          className="whitespace-nowrap rounded-full bg-brand-amber px-6 py-2.5 text-sm font-bold text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-amber/20 disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {isSubmitting ? 'Subscribing...' : 'Subscribe'}
        </button>
        {errors.email && (
          <p className="text-xs text-red-400 sm:absolute sm:bottom-0 sm:translate-y-full sm:pt-1">
            {errors.email.message}
          </p>
        )}
      </form>
    );
  }

  if (variant === 'hero') {
    return (
      <div className={cn('relative mx-auto max-w-2xl overflow-hidden rounded-2xl border border-border bg-card p-8 sm:p-12', className)}>
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Stay in the Loop
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Campaign updates, impact stories, and ways to help. Weekly. No spam.
        </p>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="newsletter-hero-email" className="sr-only">Email address</label>
          <input
            id="newsletter-hero-email"
            type="email"
            required
            placeholder="you@example.com"
            {...register('email')}
            className="flex-1 rounded-full border border-border bg-background px-5 py-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <input type="hidden" {...register('source')} />
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-press rounded-full bg-brand-amber px-8 py-3 text-sm font-bold text-white transition-colors duration-200 hover:bg-brand-amber/90 disabled:opacity-60"
          >
            {isSubmitting ? 'Subscribing...' : 'Subscribe'}
          </button>
        </form>
        {errors.email && (
          <p className="mt-3 text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>
    );
  }

  // Default inline variant
  return (
    <form onSubmit={handleSubmit(onSubmit)} className={className}>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="you@example.com"
          aria-label="Email address"
          {...register('email')}
          className="max-w-xs"
        />
        <input type="hidden" {...register('source')} />
        <Button type="submit" disabled={isSubmitting} size="sm">
          {isSubmitting ? 'Subscribing...' : 'Subscribe'}
        </Button>
      </div>
      {errors.email && (
        <p className="mt-1 text-sm text-destructive">{errors.email.message}</p>
      )}
    </form>
  );
}
