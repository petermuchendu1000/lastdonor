'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { MessageItem } from '@/components/campaign/MessageWall';
import { useAddOptimisticMessage } from '@/components/campaign/MessageWallContext';

interface MessageFormProps {
  campaignSlug: string;
  className?: string;
}

const MAX_CHARS = 500;

export function MessageForm({ campaignSlug, className }: MessageFormProps) {
  const { data: session, status } = useSession();
  const [message, setMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const addOptimisticMessage = useAddOptimisticMessage();

  const charCount = message.length;
  const isOverLimit = charCount > MAX_CHARS;
  const canSubmit = charCount > 0 && !isOverLimit && !submitting;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      setSubmitting(true);
      try {
        const res = await fetch(
          `/api/v1/campaigns/${encodeURIComponent(campaignSlug)}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, isAnonymous }),
          },
        );

        const json = await res.json();

        if (!res.ok) {
          if (res.status === 429) {
            toast.error('You\'ve reached the daily message limit for this campaign.');
          } else if (res.status === 401) {
            toast.error('Please sign in to leave a message.');
          } else {
            toast.error(json.error?.message ?? 'Failed to send message.');
          }
          return;
        }

        // Optimistic update via context
        const optimistic: MessageItem = {
          id: json.data.id,
          donorName: isAnonymous ? 'Anonymous' : (session?.user?.name ?? 'Donor'),
          donorLocation: null,
          message,
          isAnonymous,
          createdAt: json.data.createdAt,
        };
        addOptimisticMessage?.(optimistic);

        setMessage('');
        setIsAnonymous(false);
        toast.success('Message posted!');
      } catch {
        toast.error('Something went wrong. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, campaignSlug, message, isAnonymous, session, addOptimisticMessage],
  );

  // Auth gate
  if (status === 'loading') return null;
  if (!session?.user) {
    return (
      <div className={cn('rounded-lg border border-dashed border-border bg-card p-4 text-center', className)}>
        <p className="text-sm text-muted-foreground">
          <a
            href={`/login?callbackUrl=${encodeURIComponent(`/campaigns/${campaignSlug}`)}`}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </a>{' '}
          to leave a message of support.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-3', className)}>
      <h3 className="font-display text-lg font-semibold text-card-foreground">
        Leave a Message
      </h3>

      <div className="relative">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Share your words of encouragement…"
          rows={3}
          maxLength={MAX_CHARS + 50}
          className="resize-none pr-16"
          aria-label="Support message"
        />
        <span
          className={cn(
            'absolute bottom-2 right-3 text-xs',
            isOverLimit ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {charCount}/{MAX_CHARS}
        </span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id="anonymous-toggle"
            checked={isAnonymous}
            onCheckedChange={setIsAnonymous}
          />
          <Label htmlFor="anonymous-toggle" className="text-sm text-muted-foreground">
            Post anonymously
          </Label>
        </div>

        <Button type="submit" size="sm" disabled={!canSubmit}>
          {submitting ? 'Sending…' : 'Post Message'}
        </Button>
      </div>
    </form>
  );
}
