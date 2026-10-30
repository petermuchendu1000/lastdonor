'use client';

import { useEffect, useState, useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PhoneIcon,
  UserGroupIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { formatDate } from '@/lib/utils/dates';
import type { InteractionType } from '@/types';

interface Interaction {
  id: string;
  type: InteractionType;
  subject: string;
  body: string | null;
  contactedAt: string;
  createdAt: string;
  staffId: string | null;
  staffName: string | null;
  staffEmail: string;
}

interface InteractionTimelineProps {
  userId: string;
}

const TYPE_META: Record<InteractionType, { icon: typeof EnvelopeIcon; label: string; color: string }> = {
  email:   { icon: EnvelopeIcon,            label: 'Email',   color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  call:    { icon: PhoneIcon,               label: 'Call',    color: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
  meeting: { icon: UserGroupIcon,           label: 'Meeting', color: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  note:    { icon: PencilSquareIcon,        label: 'Note',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
};

export function InteractionTimeline({ userId }: InteractionTimelineProps) {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formType, setFormType] = useState<InteractionType>('note');
  const [formSubject, setFormSubject] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 16));

  const fetchInteractions = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/users/${userId}/interactions`);
      const json = await res.json();
      if (json.ok) setInteractions(json.data);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchInteractions(); }, [fetchInteractions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formSubject.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${userId}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formType,
          subject: formSubject.trim(),
          body: formBody.trim() || undefined,
          contactedAt: new Date(formDate).toISOString(),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setFormSubject('');
        setFormBody('');
        setFormType('note');
        setFormDate(new Date().toISOString().slice(0, 16));
        setShowForm(false);
        await fetchInteractions();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(interactionId: string) {
    const res = await fetch(
      `/api/v1/admin/users/${userId}/interactions?interactionId=${interactionId}`,
      { method: 'DELETE' },
    );
    const json = await res.json();
    if (json.ok) {
      setInteractions((prev) => prev.filter((i) => i.id !== interactionId));
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-row items-center justify-between border-b bg-muted/40 px-4 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ChatBubbleLeftRightIcon className="h-4 w-4" />
          Interaction Log
          <Badge variant="secondary" className="ml-1">{interactions.length}</Badge>
        </h3>
        <Button
          variant={showForm ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          <PlusIcon className="mr-1 h-4 w-4" />
          {showForm ? 'Cancel' : 'Log Interaction'}
        </Button>
      </div>
      <div className="space-y-4 p-4">
        {/* Add form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="interaction-type">Type</Label>
                <Select value={formType} onValueChange={(v) => setFormType(v as InteractionType)}>
                  <SelectTrigger id="interaction-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Note</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Subject</Label>
              <Input
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                placeholder="Brief description of the interaction"
                required
              />
            </div>
            <div>
              <Label>Details (optional)</Label>
              <Textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                placeholder="Detailed notes, discussion points, follow-up items..."
                rows={3}
              />
            </div>
            <Button type="submit" size="sm" disabled={saving || !formSubject.trim()}>
              {saving ? 'Saving...' : 'Save Interaction'}
            </Button>
          </form>
        )}

        {/* Timeline */}
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading interactions...</p>
        ) : interactions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No interactions logged yet. Use &ldquo;Log Interaction&rdquo; to record calls, emails, meetings, or notes.
          </p>
        ) : (
          <div className="relative space-y-0">
            {/* Vertical timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

            {interactions.map((item) => {
              const meta = TYPE_META[item.type];
              const Icon = meta.icon;
              const isExpanded = expandedId === item.id;

              return (
                <div key={item.id} className="relative flex gap-4 pb-4">
                  {/* Icon dot */}
                  <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{item.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {meta.label} · {formatDate(item.contactedAt)}
                          {item.staffName && ` · by ${item.staffName}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.body && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : item.id)}
                            className="p-1 text-muted-foreground hover:text-foreground"
                            title={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded
                              ? <ChevronUpIcon className="h-4 w-4" />
                              : <ChevronDownIcon className="h-4 w-4" />
                            }
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="p-1 text-muted-foreground hover:text-destructive"
                          title="Delete"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {isExpanded && item.body && (
                      <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                        {item.body}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
