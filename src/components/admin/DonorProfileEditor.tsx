'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
  PhoneIcon,
  BuildingOfficeIcon,
  MapPinIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import type { DonorAddress, DonorType } from '@/types';

interface DonorProfileData {
  phone: string | null;
  donorType: DonorType;
  organizationName: string | null;
  address: DonorAddress | null;
}

interface DonorProfileEditorProps {
  userId: string;
  initialData: DonorProfileData;
}

const DONOR_TYPE_LABELS: Record<DonorType, string> = {
  individual: 'Individual',
  corporate: 'Corporate',
  foundation: 'Foundation',
};

export function DonorProfileEditor({ userId, initialData }: DonorProfileEditorProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<DonorProfileData>(initialData);
  const [draft, setDraft] = useState<DonorProfileData>(initialData);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: draft.phone || null,
          donorType: draft.donorType,
          organizationName: draft.organizationName || null,
          address: draft.address,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setData(draft);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(data);
    setEditing(false);
  }

  const addr = data.address ?? {};

  return (
    <div className="rounded-lg border">
      <div className="flex flex-row items-center justify-between border-b bg-muted/40 px-4 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <UserIcon className="h-4 w-4" />
          Donor Profile
        </h3>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => { setDraft(data); setEditing(true); }}>
            <PencilSquareIcon className="mr-1 h-4 w-4" />
            Edit
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <CheckIcon className="mr-1 h-4 w-4" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
              <XMarkIcon className="mr-1 h-4 w-4" />
              Cancel
            </Button>
          </div>
        )}
      </div>
      <div className="p-4">
        {editing ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="donor-phone">Phone</Label>
              <Input
                id="donor-phone"
                value={draft.phone ?? ''}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="+1 (555) 123-4567"
              />
            </div>
            <div>
              <Label htmlFor="donor-type">Donor Type</Label>
              <Select
                value={draft.donorType}
                onValueChange={(v) => setDraft({ ...draft, donorType: v as DonorType })}
              >
                <SelectTrigger id="donor-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="corporate">Corporate</SelectItem>
                  <SelectItem value="foundation">Foundation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(draft.donorType === 'corporate' || draft.donorType === 'foundation') && (
              <div className="sm:col-span-2">
                <Label htmlFor="donor-org">Organization Name</Label>
                <Input
                  id="donor-org"
                  value={draft.organizationName ?? ''}
                  onChange={(e) => setDraft({ ...draft, organizationName: e.target.value })}
                  placeholder="Organization name"
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <Label className="mb-2 block font-medium">Address</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Street"
                  value={draft.address?.street ?? ''}
                  onChange={(e) => setDraft({ ...draft, address: { ...draft.address, street: e.target.value } })}
                />
                <Input
                  placeholder="City"
                  value={draft.address?.city ?? ''}
                  onChange={(e) => setDraft({ ...draft, address: { ...draft.address, city: e.target.value } })}
                />
                <Input
                  placeholder="State / Province"
                  value={draft.address?.state ?? ''}
                  onChange={(e) => setDraft({ ...draft, address: { ...draft.address, state: e.target.value } })}
                />
                <Input
                  placeholder="ZIP / Postal code"
                  value={draft.address?.zip ?? ''}
                  onChange={(e) => setDraft({ ...draft, address: { ...draft.address, zip: e.target.value } })}
                />
                <Input
                  placeholder="Country"
                  value={draft.address?.country ?? ''}
                  onChange={(e) => setDraft({ ...draft, address: { ...draft.address, country: e.target.value } })}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <PhoneIcon className="h-4 w-4 shrink-0" />
              <span className="font-medium text-foreground">Phone:</span>
              <span>{data.phone || '-'}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <BuildingOfficeIcon className="h-4 w-4 shrink-0" />
              <span className="font-medium text-foreground">Type:</span>
              <span>{DONOR_TYPE_LABELS[data.donorType]}</span>
              {data.organizationName && (
                <span className="text-foreground">({data.organizationName})</span>
              )}
            </div>
            <div className="flex items-start gap-2 text-muted-foreground sm:col-span-2">
              <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="font-medium text-foreground">Address:</span>
              <span>
                {[addr.street, addr.city, addr.state, addr.zip, addr.country]
                  .filter(Boolean)
                  .join(', ') || '-'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
