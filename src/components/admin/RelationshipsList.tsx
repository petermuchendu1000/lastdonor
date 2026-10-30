'use client';

import { useEffect, useState, useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LinkIcon,
  PlusIcon,
  TrashIcon,
  BuildingOfficeIcon,
  UserIcon,
} from '@heroicons/react/24/outline';

interface Relationship {
  id: string;
  donorId: string;
  relatedDonorId: string | null;
  organizationName: string | null;
  relationshipType: string;
  notes: string | null;
  createdAt: string;
  relatedDonorName: string | null;
}

interface RelationshipsListProps {
  userId: string;
}

const TYPE_LABELS: Record<string, string> = {
  referral: 'Referral',
  corporate_sponsor: 'Corporate Sponsor',
  family: 'Family',
  colleague: 'Colleague',
  organization_member: 'Organization Member',
};

export function RelationshipsList({ userId }: RelationshipsListProps) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formType, setFormType] = useState('referral');
  const [formOrgName, setFormOrgName] = useState('');
  const [formRelatedEmail, setFormRelatedEmail] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const fetchRelationships = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/users/${userId}/relationships`);
      const json = await res.json();
      if (json.ok) setRelationships(json.data);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchRelationships(); }, [fetchRelationships]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formOrgName.trim() && !formRelatedEmail.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        relationshipType: formType,
        notes: formNotes.trim() || undefined,
      };

      if (formOrgName.trim()) {
        body.organizationName = formOrgName.trim();
      }
      // If an email was provided, we'd need to look up the user ID.
      // For simplicity, we pass organizationName for non-donor relationships.
      // For donor-to-donor links, admin should use the donor's UUID.
      if (formRelatedEmail.trim() && !formOrgName.trim()) {
        body.organizationName = formRelatedEmail.trim();
      }

      const res = await fetch(`/api/v1/admin/users/${userId}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setFormType('referral');
        setFormOrgName('');
        setFormRelatedEmail('');
        setFormNotes('');
        setShowForm(false);
        await fetchRelationships();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(relationshipId: string) {
    const res = await fetch(
      `/api/v1/admin/users/${userId}/relationships?relationshipId=${relationshipId}`,
      { method: 'DELETE' },
    );
    const json = await res.json();
    if (json.ok) {
      setRelationships((prev) => prev.filter((r) => r.id !== relationshipId));
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-row items-center justify-between border-b bg-muted/40 px-4 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <LinkIcon className="h-4 w-4" />
          Relationships
          <Badge variant="secondary" className="ml-1">{relationships.length}</Badge>
        </h3>
        <Button
          variant={showForm ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          <PlusIcon className="mr-1 h-4 w-4" />
          {showForm ? 'Cancel' : 'Add'}
        </Button>
      </div>
      <div className="space-y-4 p-4">
        {showForm && (
          <form onSubmit={handleSubmit} className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="relationship-type">Relationship Type</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger id="relationship-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="referral">Referral</SelectItem>
                    <SelectItem value="corporate_sponsor">Corporate Sponsor</SelectItem>
                    <SelectItem value="family">Family</SelectItem>
                    <SelectItem value="colleague">Colleague</SelectItem>
                    <SelectItem value="organization_member">Organization Member</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Organization / Person Name</Label>
                <Input
                  value={formOrgName}
                  onChange={(e) => setFormOrgName(e.target.value)}
                  placeholder="e.g. Acme Corp, Jane Smith"
                />
              </div>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Additional context about this relationship"
              />
            </div>
            <Button type="submit" size="sm" disabled={saving || (!formOrgName.trim() && !formRelatedEmail.trim())}>
              {saving ? 'Saving...' : 'Save Relationship'}
            </Button>
          </form>
        )}

        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
        ) : relationships.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No relationships mapped. Use &ldquo;Add&rdquo; to link corporate sponsors, referrals, or family connections.
          </p>
        ) : (
          <div className="space-y-2">
            {relationships.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center justify-between rounded-lg border px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {rel.organizationName ? (
                    <BuildingOfficeIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ) : (
                    <UserIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {rel.relatedDonorName ?? rel.organizationName ?? '-'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {TYPE_LABELS[rel.relationshipType] ?? rel.relationshipType}
                      {rel.notes && ` · ${rel.notes}`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(rel.id)}
                  className="p-1 text-muted-foreground hover:text-destructive shrink-0"
                  title="Remove relationship"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
