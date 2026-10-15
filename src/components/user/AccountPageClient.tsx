'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateProfileSchema } from '@/lib/validators/user';
import type { UpdateProfileInput, UserPreferences } from '@/lib/validators/user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { signOut } from 'next-auth/react';
import { CameraIcon, TrashIcon } from '@heroicons/react/24/outline';
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid';

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface ProfileData {
  name: string;
  email: string;
  location: string | null;
  avatarUrl: string | null;
}

const AVATAR_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const AVATAR_MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const DEFAULT_PREFERENCES: UserPreferences = {
  // `emailNotifications` is the global gate every transactional email already
  // checks (src/lib/notifications.ts:wantsEmail). It was missing from both the
  // schema and this UI, so no user could switch notification email off.
  emailNotifications: true,
  emailDonationReceipts: true,
  emailCampaignUpdates: true,
  emailNewsletter: false,
  showProfilePublicly: true,
  showDonationsPublicly: false,
  showBadgesPublicly: true,
};

/* ─── Avatar Upload ──────────────────────────────────────────────────────── */

function AvatarUpload({
  currentUrl,
  userName,
}: {
  currentUrl: string | null;
  userName: string;
}) {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState(currentUrl);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const initials = userName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const upload = useCallback(
    async (file: File) => {
      if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
        toast.error('Please upload a JPEG, PNG, or WebP image.');
        return;
      }
      if (file.size > AVATAR_MAX_SIZE) {
        toast.error('Image must be under 5 MB.');
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/v1/users/avatar', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          toast.error(data.error?.message || 'Upload failed. Please try again.');
          return;
        }

        setAvatarUrl(data.data.url);
        toast.success('Avatar updated');
        router.refresh();
      } catch {
        toast.error('Upload failed. Please check your connection and try again.');
      } finally {
        setUploading(false);
      }
    },
    [router],
  );

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file);
    e.target.value = '';
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch('/api/v1/users/avatar', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error?.message || 'Failed to remove avatar.');
        return;
      }
      setAvatarUrl(null);
      toast.success('Avatar removed');
      router.refresh();
    } catch {
      toast.error('Failed to remove avatar. Please try again.');
    } finally {
      setRemoving(false);
    }
  }

  const busy = uploading || removing;

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => !busy && inputRef.current?.click()}
          disabled={busy}
          aria-label="Upload avatar photo"
          className="group relative h-20 w-20 overflow-hidden rounded-full border-2 border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={`${userName}'s avatar`}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-xl font-bold text-muted-foreground">
              {initials || '?'}
            </span>
          )}

          <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {uploading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <CameraIcon className="h-6 w-6 text-white" aria-hidden="true" />
            )}
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => !busy && inputRef.current?.click()}
          disabled={busy}
          className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? 'Uploading...' : avatarUrl ? 'Change photo' : 'Upload photo'}
        </button>
        {avatarUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
          >
            <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Remove
          </button>
        )}
        <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP. Max 5 MB.</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPTED_TYPES.join(',')}
        onChange={handleFileSelect}
        className="hidden"
        aria-hidden="true"
      />
    </div>
  );
}

/* ─── Profile Form ───────────────────────────────────────────────────────── */

function ProfileForm({ profile }: { profile: ProfileData }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: profile.name,
      location: profile.location ?? undefined,
    },
  });

  async function onSubmit(data: UpdateProfileInput) {
    const res = await fetch('/api/v1/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = await res.json();
      toast.error(body.error?.message ?? 'Failed to update profile');
      return;
    }

    toast.success('Profile updated');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <AvatarUpload currentUrl={profile.avatarUrl} userName={profile.name} />

      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register('name')} />
        {errors.name && (
          <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>
      <div>
        <Label htmlFor="location">Location</Label>
        <Input id="location" placeholder="City, State" {...register('location')} />
        {errors.location && (
          <p className="mt-1 text-sm text-destructive">{errors.location.message}</p>
        )}
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : 'Save Changes'}
      </Button>
    </form>
  );
}

/* ─── Preference Toggle ──────────────────────────────────────────────────── */

function SettingRow({
  label,
  description,
  checked,
  onCheckedChange,
  id,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="space-y-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/* ─── Preferences Section ────────────────────────────────────────────────── */

function PreferencesSection({ email }: { email: string }) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function loadPreferences() {
      try {
        const res = await fetch('/api/v1/users/settings', { signal: controller.signal });
        if (!res.ok) return;
        const json = await res.json();
        if (json.ok && json.data) {
          setPreferences({ ...DEFAULT_PREFERENCES, ...json.data });
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    loadPreferences();
    return () => controller.abort();
  }, []);

  const savePreferences = useCallback(async (updated: UserPreferences) => {
    try {
      const res = await fetch('/api/v1/users/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error?.message ?? 'Failed to save settings');
        return;
      }
      toast.success('Settings saved');
    } catch {
      toast.error('Network error. Please try again.');
    }
  }, []);

  /**
   * Mirror the newsletter toggle onto the `newsletter_subscribers` list.
   *
   * `preferences.emailNewsletter` is read by nothing that sends mail — the
   * newsletter cron reads `newsletter_subscribers` — so storing the flag alone
   * left the toggle inert. Writing through to the list is what makes it real.
   */
  const syncNewsletterList = useCallback(async (enabled: boolean) => {
    if (!email) return;
    try {
      const res = await fetch(
        enabled ? '/api/v1/newsletter/subscribe' : '/api/v1/newsletter/unsubscribe',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(enabled ? { email, source: 'newsletter' } : { email }),
        },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok === false) {
        toast.error(json?.error?.message ?? 'Saved, but updating the newsletter list failed.');
      }
    } catch {
      toast.error('Saved, but updating the newsletter list failed.');
    }
  }, [email]);

  function updatePref(key: keyof UserPreferences, value: boolean) {
    const updated = { ...preferences, [key]: value };
    setPreferences(updated);
    savePreferences(updated);
    if (key === 'emailNewsletter') void syncNewsletterList(value);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-36 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Email Notifications</CardTitle>
          <CardDescription>
            Choose which emails you&apos;d like to receive from LastDonor.org
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingRow
            id="emailNotifications"
            label="Account and activity emails"
            description="Refunds, campaign status changes, verification and withdrawal notices. Switching this off stops every notification email."
            checked={preferences.emailNotifications ?? true}
            onCheckedChange={(v) => updatePref('emailNotifications', v)}
          />
          <SettingRow
            id="emailDonationReceipts"
            label="Donation receipts"
            description="Receive an email confirmation after each donation"
            checked={preferences.emailDonationReceipts ?? true}
            onCheckedChange={(v) => updatePref('emailDonationReceipts', v)}
          />
          <SettingRow
            id="emailCampaignUpdates"
            label="Campaign updates"
            description="Get notified when campaigns you've donated to post updates or share impact reports"
            checked={preferences.emailCampaignUpdates ?? true}
            onCheckedChange={(v) => updatePref('emailCampaignUpdates', v)}
          />
          <SettingRow
            id="emailNewsletter"
            label="Monthly newsletter"
            description="Impact stories, platform updates, and community highlights"
            checked={preferences.emailNewsletter ?? false}
            onCheckedChange={(v) => updatePref('emailNewsletter', v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
          <CardDescription>
            Control what other donors can see about you
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingRow
            id="showProfilePublicly"
            label="Public profile"
            description="Allow your name and avatar to appear on the Last Donor Wall and campaign pages"
            checked={preferences.showProfilePublicly ?? true}
            onCheckedChange={(v) => updatePref('showProfilePublicly', v)}
          />
          <SettingRow
            id="showDonationsPublicly"
            label="Show donation amounts"
            description="Display your donation amounts alongside your name on campaign pages"
            checked={preferences.showDonationsPublicly ?? false}
            onCheckedChange={(v) => updatePref('showDonationsPublicly', v)}
          />
          <SettingRow
            id="showBadgesPublicly"
            label="Show badges"
            description="Display your earned badges (Last Donor, First Believer, etc.) on your public profile"
            checked={preferences.showBadgesPublicly ?? true}
            onCheckedChange={(v) => updatePref('showBadgesPublicly', v)}
          />
        </CardContent>
      </Card>
    </>
  );
}

/* ─── Delete Account ─────────────────────────────────────────────────────── */

function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch('/api/v1/users/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message ?? 'Failed to delete account');
        return;
      }

      toast.success('Account deleted');
      await signOut({ callbackUrl: '/' });
    } finally {
      setDeleting(false);
      setOpen(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ExclamationTriangleIcon className="h-5 w-5 text-destructive" aria-hidden="true" />
          <CardTitle className="text-destructive">Delete account</CardTitle>
        </div>
        <CardDescription>
          Permanently delete your account and anonymize all donation data. This action cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive">Delete my account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you absolutely sure?</DialogTitle>
              <DialogDescription>
                This will permanently delete your account and anonymize all your donation records.
                You will not be able to recover your data.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Yes, delete my account'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */

export default function AccountPageClient({ profile }: { profile: ProfileData }) {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          <CardDescription>
            Your name and location appear on donations you make and campaigns you create.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm profile={profile} />
        </CardContent>
      </Card>

      <PreferencesSection email={profile.email} />

      <Separator />

      <DeleteAccountSection />
    </div>
  );
}
