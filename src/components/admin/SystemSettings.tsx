'use client';

import { useState, useCallback, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  SETTING_CATEGORIES,
  SETTING_META,
  CATEGORY_LABELS,
  type SettingsMap,
  type SettingKey,
  type SettingCategory,
} from '@/lib/settings';

// ─── Types ──────────────────────────────────────────────────────────────────

interface EnvKeyStatus {
  label: string;
  source: 'db' | 'env' | 'missing';
  maskedValue: string | null;
  updatedAt: string | null;
}

interface SystemSettingsProps {
  initialSettings: SettingsMap;
  hasSecurityQuestion: boolean;
  stats: {
    totalUsers: number;
    totalCampaigns: number;
    totalDonations: number;
    totalNewsletterSubscribers: number;
    cronJobs: { name: string; schedule: string }[];
  };
  environment: {
    hasStripeKey: boolean;
    hasResendKey: boolean;
    hasDatabaseUrl: boolean;
    hasOpenRouterKey: boolean;
    hasSentryDsn: boolean;
    nodeEnv: string;
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SystemSettings({ initialSettings, hasSecurityQuestion: initialHasSQ, stats, environment }: SystemSettingsProps) {
  const [settings, setSettings] = useState<SettingsMap>(initialSettings);
  const [editingCategory, setEditingCategory] = useState<SettingCategory | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // ─── Environment config state ──────────────────────────────────────
  const [envStatuses, setEnvStatuses] = useState<Record<string, EnvKeyStatus>>({});
  const [, setEnvLoading] = useState(false);
  const [hasSQ, setHasSQ] = useState(initialHasSQ);
  const [securityToken, setSecurityToken] = useState<string | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<number>(0);

  // Dialog states
  const [setupSQOpen, setSetupSQOpen] = useState(false);
  const [verifySQOpen, setVerifySQOpen] = useState(false);
  const [editEnvOpen, setEditEnvOpen] = useState(false);
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);

  // Form states
  const [sqQuestion, setSqQuestion] = useState('');
  const [sqAnswer, setSqAnswer] = useState('');
  const [sqPassword, setSqPassword] = useState('');
  const [sqQuestionText, setSqQuestionText] = useState('');
  const [verifyAnswer, setVerifyAnswer] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [showNewKey, setShowNewKey] = useState(false);
  const [formBusy, setFormBusy] = useState(false);

  // Fetch env statuses
  const fetchEnvStatuses = useCallback(async () => {
    setEnvLoading(true);
    try {
      const res = await fetch('/api/v1/admin/settings/environment');
      if (res.ok) {
        const { data } = await res.json();
        setEnvStatuses(data);
      }
    } catch {
      toast.error('Failed to load environment status');
    } finally {
      setEnvLoading(false);
    }
  }, []);

  useEffect(() => { fetchEnvStatuses(); }, [fetchEnvStatuses]);

  // Auto-expire security token
  useEffect(() => {
    if (!securityToken || tokenExpiry <= 0) return;
    const ms = tokenExpiry - Date.now();
    if (ms <= 0) { setSecurityToken(null); return; }
    const timeout = setTimeout(() => setSecurityToken(null), ms);
    return () => clearTimeout(timeout);
  }, [securityToken, tokenExpiry]);

  /** Called when admin clicks "Update" on an env key. Starts the appropriate flow. */
  const handleEnvKeyClick = useCallback(async (envKey: string) => {
    // If we already have a valid security token, go straight to editing
    if (securityToken && tokenExpiry > Date.now()) {
      setEditingEnvKey(envKey);
      setNewKeyValue('');
      setShowNewKey(false);
      setEditEnvOpen(true);
      return;
    }

    // Check if admin has a security question set
    if (!hasSQ) {
      setSetupSQOpen(true);
      setEditingEnvKey(envKey);
      return;
    }

    // Fetch the question text and open verification dialog
    try {
      const res = await fetch('/api/v1/admin/settings/security-question');
      if (res.ok) {
        const { data } = await res.json();
        setSqQuestionText(data.question ?? '');
      }
    } catch {
      toast.error('Failed to load security question');
    }
    setEditingEnvKey(envKey);
    setVerifyAnswer('');
    setVerifySQOpen(true);
  }, [securityToken, tokenExpiry, hasSQ]);

  /** Save security question. */
  const handleSetupSQ = useCallback(async () => {
    setFormBusy(true);
    try {
      const res = await fetch('/api/v1/admin/settings/security-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: sqQuestion, answer: sqAnswer, currentPassword: sqPassword }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.code === 'VALIDATION_ERROR' ? (err.error?.message ?? 'Failed to set security question') : 'Failed to set security question');
      }
      setHasSQ(true);
      setSetupSQOpen(false);
      setSqQuestion(''); setSqAnswer(''); setSqPassword('');
      toast.success('Security question saved');
      // Continue to verification flow
      if (editingEnvKey) {
        setSqQuestionText(sqQuestion);
        setVerifyAnswer('');
        setVerifySQOpen(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set security question');
    } finally {
      setFormBusy(false);
    }
  }, [sqQuestion, sqAnswer, sqPassword, editingEnvKey]);

  /** Verify security answer → get token. */
  const handleVerifySQ = useCallback(async () => {
    setFormBusy(true);
    try {
      const res = await fetch('/api/v1/admin/settings/verify-security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: verifyAnswer }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.code === 'VALIDATION_ERROR' ? (err.error?.message ?? 'Verification failed') : 'Verification failed');
      }
      const { data } = await res.json();
      setSecurityToken(data.token);
      setTokenExpiry(data.expiresAt);
      setVerifySQOpen(false);
      setVerifyAnswer('');
      toast.success('Verified - you have 5 minutes to make changes');
      // Open edit dialog for the pending key
      if (editingEnvKey) {
        setNewKeyValue('');
        setShowNewKey(false);
        setEditEnvOpen(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setFormBusy(false);
    }
  }, [verifyAnswer, editingEnvKey]);

  /** Save env key update. */
  const handleSaveEnvKey = useCallback(async () => {
    if (!editingEnvKey || !securityToken || !newKeyValue.trim()) return;
    setFormBusy(true);
    try {
      const res = await fetch('/api/v1/admin/settings/environment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          securityToken,
          keys: { [editingEnvKey]: newKeyValue.trim() },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.code === 'VALIDATION_ERROR' ? (err.error?.message ?? 'Failed to update key') : 'Failed to update key');
      }
      setEditEnvOpen(false);
      setNewKeyValue('');
      setEditingEnvKey(null);
      toast.success('API key updated successfully');
      fetchEnvStatuses(); // refresh statuses
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update key');
    } finally {
      setFormBusy(false);
    }
  }, [editingEnvKey, securityToken, newKeyValue, fetchEnvStatuses]);

  const startEditing = useCallback((category: SettingCategory) => {
    const keysInCategory = (Object.keys(SETTING_META) as SettingKey[]).filter(
      (k) => SETTING_META[k].category === category,
    );
    const categoryDraft: Record<string, unknown> = {};
    for (const key of keysInCategory) {
      categoryDraft[key] = settings[key];
    }
    setDraft(categoryDraft);
    setEditingCategory(category);
  }, [settings]);

  const cancelEditing = useCallback(() => {
    setEditingCategory(null);
    setDraft({});
  }, []);

  const saveCategory = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.code === 'VALIDATION_ERROR' ? (err.error?.message ?? 'Failed to save') : 'Failed to save');
      }
      const { data } = await res.json();
      setSettings(data);
      setEditingCategory(null);
      setDraft({});
      toast.success('Settings saved successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [draft]);

  return (
    <div className="space-y-6">
      {/* Environment Configuration (interactive) */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Environment Configuration</h3>
          {securityToken && tokenExpiry > Date.now() ? (
            <Badge variant="default" className="text-xs font-normal">Verified</Badge>
          ) : (
            <Badge variant="outline" className="text-xs font-normal">Secured</Badge>
          )}
        </div>
        <div className="p-4">
          <p className="mb-4 text-sm text-muted-foreground">
            Click &quot;Update&quot; on any key to provide a new API credential. Changes require security verification and are encrypted at rest.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <EnvItem label="Node Environment" value={environment.nodeEnv} ok readOnly />
            {Object.entries(envStatuses).length > 0 ? (
              Object.entries(envStatuses).map(([key, status]) => (
                <EnvItemInteractive
                  key={key}
                  envKey={key}
                  label={status.label}
                  source={status.source}
                  maskedValue={status.maskedValue}
                  onUpdate={handleEnvKeyClick}
                />
              ))
            ) : (
              <>
                <EnvItem label="Database (Supabase)" value={environment.hasDatabaseUrl ? 'Connected' : 'Missing'} ok={environment.hasDatabaseUrl} onUpdate={() => handleEnvKeyClick('DATABASE_URL')} />
                <EnvItem label="Stripe" value={environment.hasStripeKey ? 'Configured' : 'Missing'} ok={environment.hasStripeKey} onUpdate={() => handleEnvKeyClick('STRIPE_SECRET_KEY')} />
                <EnvItem label="Resend (Email)" value={environment.hasResendKey ? 'Configured' : 'Missing'} ok={environment.hasResendKey} onUpdate={() => handleEnvKeyClick('RESEND_API_KEY')} />
                <EnvItem label="OpenRouter (AI)" value={environment.hasOpenRouterKey ? 'Configured' : 'Missing'} ok={environment.hasOpenRouterKey} onUpdate={() => handleEnvKeyClick('OPENROUTER_API_KEY')} />
                <EnvItem label="Sentry" value={environment.hasSentryDsn ? 'Configured' : 'Not set'} ok={environment.hasSentryDsn} onUpdate={() => handleEnvKeyClick('SENTRY_DSN')} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Security Question Setup Dialog ─── */}
      <Dialog open={setupSQOpen} onOpenChange={(open) => { if (!open) { setSetupSQOpen(false); setEditingEnvKey(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Up Security Question</DialogTitle>
            <DialogDescription>
              You need a security question before updating API keys. This acts as a second factor to protect sensitive credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="sq-question">Security Question</Label>
              <Input id="sq-question" placeholder="e.g. What was your first pet's name?" value={sqQuestion} onChange={(e) => setSqQuestion(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sq-answer">Answer</Label>
              <Input id="sq-answer" type="password" placeholder="Your answer (case-insensitive)" value={sqAnswer} onChange={(e) => setSqAnswer(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sq-password">Current Password</Label>
              <Input id="sq-password" type="password" placeholder="Confirm your account password" value={sqPassword} onChange={(e) => setSqPassword(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSetupSQOpen(false); setEditingEnvKey(null); }} disabled={formBusy}>Cancel</Button>
            <Button onClick={handleSetupSQ} disabled={formBusy || !sqQuestion.trim() || !sqAnswer.trim() || !sqPassword.trim()}>
              {formBusy ? 'Saving…' : 'Save & Continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Security Verification Dialog ─── */}
      <Dialog open={verifySQOpen} onOpenChange={(open) => { if (!open) { setVerifySQOpen(false); setEditingEnvKey(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Security Verification</DialogTitle>
            <DialogDescription>
              Answer your security question to authorise changes to API credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium">{sqQuestionText || 'Your security question'}</Label>
              <Input type="password" placeholder="Your answer" value={verifyAnswer} onChange={(e) => setVerifyAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && verifyAnswer.trim()) handleVerifySQ(); }} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVerifySQOpen(false); setEditingEnvKey(null); }} disabled={formBusy}>Cancel</Button>
            <Button onClick={handleVerifySQ} disabled={formBusy || !verifyAnswer.trim()}>
              {formBusy ? 'Verifying…' : 'Verify'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Env Key Dialog ─── */}
      <Dialog open={editEnvOpen} onOpenChange={(open) => { if (!open) { setEditEnvOpen(false); setEditingEnvKey(null); setNewKeyValue(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update {editingEnvKey ? envStatuses[editingEnvKey]?.label ?? editingEnvKey : 'API Key'}</DialogTitle>
            <DialogDescription>
              Enter the new value below. The key will be encrypted at rest and override the environment variable.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editingEnvKey && envStatuses[editingEnvKey]?.maskedValue && (
              <div className="rounded-md bg-muted px-3 py-2">
                <p className="text-xs text-muted-foreground">Current value</p>
                <p className="font-mono text-sm">{envStatuses[editingEnvKey].maskedValue}</p>
              </div>
            )}
            <div>
              <Label htmlFor="new-key-value">New Value</Label>
              <div className="flex gap-2">
                <Input
                  id="new-key-value"
                  type={showNewKey ? 'text' : 'password'}
                  placeholder="Paste your new API key"
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  className="font-mono"
                  onKeyDown={(e) => { if (e.key === 'Enter' && newKeyValue.trim()) handleSaveEnvKey(); }}
                />
                <Button variant="outline" size="sm" type="button" onClick={() => setShowNewKey(!showNewKey)}>
                  {showNewKey ? 'Hide' : 'Show'}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditEnvOpen(false); setEditingEnvKey(null); setNewKeyValue(''); }} disabled={formBusy}>Cancel</Button>
            <Button onClick={handleSaveEnvKey} disabled={formBusy || !newKeyValue.trim()}>
              {formBusy ? 'Saving…' : 'Save Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Platform Statistics (read-only) */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Platform Statistics</h3>
        </div>
        <div className="p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatItem label="Total Users" value={stats.totalUsers} />
            <StatItem label="Total Campaigns" value={stats.totalCampaigns} />
            <StatItem label="Total Donations" value={stats.totalDonations} />
            <StatItem label="Newsletter Subscribers" value={stats.totalNewsletterSubscribers} />
          </div>
        </div>
      </div>

      {/* Editable setting categories */}
      {SETTING_CATEGORIES.map((category) => {
        const keys = (Object.keys(SETTING_META) as SettingKey[]).filter(
          (k) => SETTING_META[k].category === category,
        );
        const isEditing = editingCategory === category;

        return (
          <div key={category} className="rounded-lg border">
            <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
              <h3 className="text-sm font-semibold text-muted-foreground">{CATEGORY_LABELS[category]}</h3>
              {!isEditing ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startEditing(category)}
                  disabled={editingCategory !== null && editingCategory !== category}
                >
                  Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveCategory} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="space-y-4">
                {keys.map((key) => (
                  <SettingRow
                    key={key}
                    settingKey={key}
                    value={isEditing ? (draft[key] ?? settings[key]) : settings[key]}
                    isEditing={isEditing}
                    onChange={(val) => setDraft((prev) => ({ ...prev, [key]: val }))}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {/* Cron Jobs (read-only) */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Scheduled Cron Jobs</h3>
          <Badge variant="outline" className="text-xs font-normal">Read-only</Badge>
        </div>
        <div className="p-4">
          <p className="mb-4 text-sm text-muted-foreground">
            Cron schedules are defined in vercel.json and managed via deployment configuration.
          </p>
          <div className="space-y-3">
            {stats.cronJobs.map((job) => (
              <div key={job.name} className="flex items-center justify-between rounded-md border px-4 py-3">
                <div>
                  <p className="font-medium">{job.name}</p>
                  <p className="font-mono text-sm text-muted-foreground">{job.schedule}</p>
                </div>
                <Badge variant="secondary">Active</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SettingRow({
  settingKey,
  value,
  isEditing,
  onChange,
}: {
  settingKey: SettingKey;
  value: unknown;
  isEditing: boolean;
  onChange: (val: unknown) => void;
}) {
  const meta = SETTING_META[settingKey];

  if (!isEditing) {
    return (
      <div className="flex items-center justify-between rounded-md border px-4 py-3">
        <div>
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <DisplayValue value={value} inputType={meta.inputType} />
      </div>
    );
  }

  return (
    <div className="rounded-md border px-4 py-3">
      <Label className="text-sm font-medium">{meta.label}</Label>
      <p className="mb-2 text-xs text-muted-foreground">{meta.description}</p>
      <EditInput value={value} inputType={meta.inputType} onChange={onChange} />
    </div>
  );
}

/**
 * A settings threshold, shown in MINOR UNITS with no currency symbol.
 *
 * ⛔ This was `Intl.NumberFormat('en-US', { style: 'currency', currency:
 * 'USD' }).format(cents / 100)` - a hard dollar sign on a figure that has no
 * currency at all.
 *
 * [VERIFIED 2026-10-26] The four `inputType: 'cents'` settings are
 * `donation.min_amount`, `donation.max_amount`, `campaign.min_goal` and
 * `campaign.max_goal`, and their ONLY readers are in
 * `api/v1/admin/settings/route.ts`, which checks that min is below max. No
 * money path reads them: the real per-currency bounds are
 * `CURRENCIES[code].minDonationMinor` / `maxDonationMinor` (`docs/98`). So
 * the figure is a bare platform-wide threshold, and printing it as dollars
 * claimed a currency it does not have.
 *
 * ⚠️ The ratchet's exemption for this file covers its `CentsInput` - an
 * editable field must hold a bare numeric string - which is correct, and
 * which is why that input is untouched. It did NOT cover this read-only
 * display, and that gap is what let the dollar sign survive `docs/88` F4.
 */
function formatSettingMinor(minor: number): string {
  return `${minor.toLocaleString('en-US')} (minor units)`;
}

function DisplayValue({ value, inputType }: { value: unknown; inputType: string }) {
  if (inputType === 'boolean') {
    return (
      <Badge variant={value ? 'default' : 'secondary'}>
        {value ? 'Enabled' : 'Disabled'}
      </Badge>
    );
  }
  if (inputType === 'cents') {
    return <span className="font-mono text-sm">{formatSettingMinor(value as number)}</span>;
  }
  if (inputType === 'json') {
    if (Array.isArray(value)) {
      // If all items are numbers that look like cent amounts (>= 100), display as dollars
      const allCents = value.every((v) => typeof v === 'number' && v >= 100);
      const display = allCents
        ? value.map((v: number) => formatSettingMinor(v)).join(', ')
        : value.join(', ');
      return <span className="font-mono text-sm">{display}</span>;
    }
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      return (
        <span className="font-mono text-sm">
          {Object.entries(obj).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}
        </span>
      );
    }
    return <span className="font-mono text-sm">{String(value)}</span>;
  }
  return <span className="font-mono text-sm">{String(value)}</span>;
}

function CentsInput({ value, onChange }: { value: number; onChange: (val: unknown) => void }) {
  const [display, setDisplay] = useState(() => (value / 100).toFixed(2));
  useEffect(() => { setDisplay((value / 100).toFixed(2)); }, [value]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">$</span>
      <Input
        type="text"
        inputMode="decimal"
        className="max-w-48"
        value={display}
        onChange={(e) => {
          const raw = e.target.value;
          // Allow digits, one dot, up to 2 decimals
          if (/^\d*\.?\d{0,2}$/.test(raw) || raw === '') {
            setDisplay(raw);
            const dollars = parseFloat(raw);
            if (!isNaN(dollars)) onChange(Math.round(dollars * 100));
          }
        }}
        onBlur={() => {
          const dollars = parseFloat(display);
          if (!isNaN(dollars)) {
            setDisplay(dollars.toFixed(2));
          } else {
            setDisplay((value / 100).toFixed(2));
          }
        }}
      />
    </div>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (val: unknown) => void }) {
  const [display, setDisplay] = useState(() => String(value ?? ''));
  useEffect(() => { setDisplay(String(value ?? '')); }, [value]);
  return (
    <Input
      type="text"
      inputMode="numeric"
      min="0"
      className="max-w-48"
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          setDisplay('');
          onChange(0);
        } else if (/^\d+$/.test(raw)) {
          setDisplay(raw);
          onChange(parseInt(raw, 10));
        }
      }}
    />
  );
}

function ArrayInput({ value, onChange }: { value: unknown[]; onChange: (val: unknown) => void }) {
  const isNumericArray = value.every((v) => typeof v === 'number');
  const [display, setDisplay] = useState(() => value.join(', '));
  useEffect(() => { setDisplay(value.join(', ')); }, [value]);
  return (
    <Input
      type="text"
      className="max-w-md font-mono"
      value={display}
      onChange={(e) => {
        setDisplay(e.target.value);
        const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
        if (isNumericArray) {
          // For numeric arrays, only update when all parts are valid numbers
          if (parts.length > 0 && parts.every((p) => /^-?\d+(\.\d+)?$/.test(p))) {
            onChange(parts.map(Number));
          }
        } else {
          onChange(parts);
        }
      }}
    />
  );
}

function ObjectInput({ value, onChange }: { value: Record<string, unknown>; onChange: (val: unknown) => void }) {
  const [localValues, setLocalValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v ?? '')]))
  );
  useEffect(() => {
    setLocalValues(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v ?? '')])));
  }, [value]);
  return (
    <div className="flex flex-wrap gap-3">
      {Object.entries(localValues).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <Label className="whitespace-nowrap text-xs text-muted-foreground">{k}:</Label>
          <Input
            type="text"
            inputMode="numeric"
            className="w-32"
            value={v}
            onChange={(e) => {
              const raw = e.target.value;
              setLocalValues({ ...localValues, [k]: raw });
              if (raw === '') {
                onChange({ ...value, [k]: 0 });
              } else if (/^\d+$/.test(raw)) {
                onChange({ ...value, [k]: parseInt(raw, 10) });
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}

function EditInput({
  value,
  inputType,
  onChange,
}: {
  value: unknown;
  inputType: string;
  onChange: (val: unknown) => void;
}) {
  if (inputType === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={!!value}
          onCheckedChange={(checked) => onChange(checked)}
        />
        <span className="text-sm">{value ? 'Enabled' : 'Disabled'}</span>
      </div>
    );
  }

  if (inputType === 'cents') {
    return <CentsInput value={value as number} onChange={onChange} />;
  }

  if (inputType === 'number') {
    return <NumberInput value={value as number} onChange={onChange} />;
  }

  if (inputType === 'json') {
    // For arrays: comma-separated input
    if (Array.isArray(value)) {
      return <ArrayInput value={value} onChange={onChange} />;
    }
    // For objects (e.g., rate limit): individual fields
    if (typeof value === 'object' && value !== null) {
      return <ObjectInput value={value as Record<string, unknown>} onChange={onChange} />;
    }
    return (
      <Input
        type="text"
        className="max-w-md font-mono"
        value={JSON.stringify(value)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            // keep raw string while user is still typing
          }
        }}
      />
    );
  }

  // Default: text input
  return (
    <Input
      type="text"
      className="max-w-md"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function EnvItem({ label, value, ok, readOnly, onUpdate }: { label: string; value: string; ok: boolean; readOnly?: boolean; onUpdate?: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <Badge variant={ok ? 'default' : 'destructive'} className="text-xs">
          {value}
        </Badge>
        {!readOnly && onUpdate && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onUpdate}>
            Update
          </Button>
        )}
      </div>
    </div>
  );
}

function EnvItemInteractive({ envKey, label, source, maskedValue, onUpdate }: {
  envKey: string;
  label: string;
  source: 'db' | 'env' | 'missing';
  maskedValue: string | null;
  onUpdate: (key: string) => void;
}) {
  const ok = source !== 'missing';
  const displayValue = source === 'missing' ? 'Missing' : source === 'db' ? 'Custom' : 'Env';

  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="min-w-0 flex-1">
        <span className="text-sm">{label}</span>
        {maskedValue && (
          <p className="truncate font-mono text-xs text-muted-foreground">{maskedValue}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={ok ? (source === 'db' ? 'default' : 'secondary') : 'destructive'} className="text-xs">
          {displayValue}
        </Badge>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onUpdate(envKey)}>
          Update
        </Button>
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}
