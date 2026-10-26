'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createCampaignSchema } from '@/lib/validators/campaign';
import type { CreateCampaignInput } from '@/lib/validators/campaign';
import { generateSlug } from '@/lib/utils/slug';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { Money } from '@/components/ui/Money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { ImageUpload } from '@/components/admin/ImageUpload';

const CATEGORIES = [
  { value: 'medical', label: 'Medical' },
  { value: 'disaster', label: 'Disaster' },
  { value: 'military', label: 'Military' },
  { value: 'veterans', label: 'Veterans' },
  { value: 'memorial', label: 'Memorial' },
  { value: 'first-responders', label: 'First Responders' },
  { value: 'community', label: 'Community' },
  { value: 'essential-needs', label: 'Essential Needs' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'charity', label: 'Charity' },
  { value: 'education', label: 'Education' },
  { value: 'animal', label: 'Animal' },
  { value: 'environment', label: 'Environment' },
  { value: 'business', label: 'Business' },
  { value: 'competition', label: 'Competition' },
  { value: 'creative', label: 'Creative' },
  { value: 'event', label: 'Event' },
  { value: 'faith', label: 'Faith' },
  { value: 'family', label: 'Family' },
  { value: 'sports', label: 'Sports' },
  { value: 'travel', label: 'Travel' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'wishes', label: 'Wishes' },
] as const;

interface CampaignEditorProps {
  mode: 'create' | 'edit';
  campaignId?: string;
  /**
   * The campaign's currency, for DISPLAY only.
   *
   * ⚠️ `CreateCampaignInput` carries no currency, so this editor cannot SET
   * one and every campaign created here takes the database default (USD).
   * Editing an existing KES campaign still showed its goal with a dollar
   * sign, which this fixes; being unable to choose a currency on creation is
   * recorded as open.
   */
  currency?: string;
  defaultValues?: Partial<CreateCampaignInput>;
}

/* Helper: label with required asterisk */
function FieldLabel({ htmlFor, required, children }: { htmlFor?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
      {required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
    </Label>
  );
}

/* Helper: subtle description text below a field */
function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-muted-foreground">{children}</p>;
}

/* Helper: error text */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-sm text-destructive" role="alert">{message}</p>;
}

/* Section wrapper with title */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-border">
      <legend className="ml-4 px-1 text-sm font-semibold text-muted-foreground">{title}</legend>
      <div className="space-y-4 px-4 pb-4 pt-2">{children}</div>
    </fieldset>
  );
}

export function CampaignEditor({ mode, campaignId, currency = 'USD', defaultValues }: CampaignEditorProps) {
  const router = useRouter();
  const [previewHtml, setPreviewHtml] = useState('');

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateCampaignInput>({
    resolver: zodResolver(createCampaignSchema) as never,
    defaultValues: {
      title: '',
      slug: '',
      category: 'medical',
      heroImageUrl: '',
      photoCredit: '',
      subjectName: '',
      subjectHometown: '',
      storyHtml: '',
      goalAmount: 100_000,
      impactTiers: [],
      status: 'draft',
      ...defaultValues,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'impactTiers',
  });

  const storyHtml = watch('storyHtml');
  const heroImageUrl = watch('heroImageUrl');
  const goalAmountCents = watch('goalAmount');

  function handleTitleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const currentSlug = watch('slug');
    if (!currentSlug) {
      setValue('slug', generateSlug(e.target.value));
    }
  }

  function handleShowPreview() {
    setPreviewHtml(sanitizeHtml(storyHtml));
  }

  function handleGoalDollarsChange(e: React.ChangeEvent<HTMLInputElement>) {
    const dollars = parseFloat(e.target.value);
    if (!isNaN(dollars) && dollars >= 0) {
      setValue('goalAmount', Math.round(dollars * 100));
    }
  }

  async function onSubmit(data: CreateCampaignInput) {
    const url =
      mode === 'create'
        ? '/api/v1/campaigns'
        : `/api/v1/campaigns/${campaignId}`;
    const method = mode === 'create' ? 'POST' : 'PUT';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = await res.json();
      toast.error(body.error?.message ?? `Failed to ${mode} campaign`);
      return;
    }

    toast.success(mode === 'create' ? 'Campaign created!' : 'Campaign updated!');
    router.push('/admin/campaigns');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr,380px]">
        {/* ─── Left column ─── */}
        <div className="space-y-6">

          {/* Campaign identity */}
          <FormSection title="Campaign identity">
            <div>
              <FieldLabel htmlFor="title" required>Title</FieldLabel>
              <Input id="title" {...register('title')} onBlur={handleTitleBlur} placeholder="A specific, person-focused title" />
              <FieldHint>5–200 characters. Auto-generates slug on first blur.</FieldHint>
              <FieldError message={errors.title?.message} />
            </div>

            <div>
              <FieldLabel htmlFor="slug" required>URL Slug</FieldLabel>
              <div className="flex items-center gap-0">
                <span className="inline-flex h-9 items-center rounded-l-md border border-r-0 border-border bg-muted/50 px-3 text-xs text-muted-foreground">
                  /campaigns/
                </span>
                <Input id="slug" {...register('slug')} className="rounded-l-none" placeholder="campaign-url-slug" />
              </div>
              <FieldHint>Lowercase letters, numbers, and hyphens only.</FieldHint>
              <FieldError message={errors.slug?.message} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="category" required>Category</FieldLabel>
                <Select
                  defaultValue={defaultValues?.category ?? 'medical'}
                  onValueChange={(val) =>
                    setValue('category', val as CreateCampaignInput['category'])
                  }
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.category?.message} />
              </div>

              <div>
                <FieldLabel htmlFor="status">Initial Status</FieldLabel>
                <Select
                  defaultValue={defaultValues?.status ?? 'draft'}
                  onValueChange={(val) =>
                    setValue('status', val as 'draft' | 'active')
                  }
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                  </SelectContent>
                </Select>
                <FieldHint>Draft campaigns are not visible publicly.</FieldHint>
              </div>
            </div>
          </FormSection>

          {/* Subject */}
          <FormSection title="Subject">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="subjectName" required>Name</FieldLabel>
                <Input id="subjectName" {...register('subjectName')} placeholder="Person or family name" />
                <FieldError message={errors.subjectName?.message} />
              </div>
              <div>
                <FieldLabel htmlFor="subjectHometown">Hometown</FieldLabel>
                <Input id="subjectHometown" {...register('subjectHometown')} placeholder="City, State" />
              </div>
            </div>
          </FormSection>

          {/* Fundraising */}
          <FormSection title="Fundraising">
            <div>
              <FieldLabel htmlFor="goalDollars" required>Goal Amount</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  id="goalDollars"
                  type="number"
                  step="0.01"
                  min="1000"
                  className="pl-7"
                  defaultValue={(defaultValues?.goalAmount ?? 100_000) / 100}
                  onChange={handleGoalDollarsChange}
                  placeholder="5,000.00"
                />
              </div>
              <FieldHint>
                Minimum $1,000 · Maximum $100,000
                {goalAmountCents > 0 && (
                  <> · Currently set to <strong className="text-foreground"><Money minor={goalAmountCents} currency={currency} precision="exact" /></strong></>
                )}
              </FieldHint>
              {/* Hidden field syncs the actual cents value */}
              <input type="hidden" {...register('goalAmount', { valueAsNumber: true })} />
              <FieldError message={errors.goalAmount?.message} />
            </div>
          </FormSection>

          {/* Hero image */}
          <FormSection title="Hero image">
            <div>
              <ImageUpload
                value={heroImageUrl}
                onChange={(url) => setValue('heroImageUrl', url, { shouldValidate: true })}
                folder="campaign-photos"
                label="Hero Image *"
              />
              <FieldHint>Upload an image or paste a URL. JPEG, PNG, WebP, AVIF up to 5 MB.</FieldHint>
              <FieldError message={errors.heroImageUrl?.message} />
              {/* Keep the value synced with react-hook-form */}
              <input type="hidden" {...register('heroImageUrl')} />
            </div>
            <div>
              <FieldLabel htmlFor="photoCredit">Photo Credit</FieldLabel>
              <Input id="photoCredit" {...register('photoCredit')} placeholder="Photographer or source" />
            </div>
          </FormSection>
        </div>

        {/* ─── Right column - Preview & Impact Tiers ─── */}
        <div className="space-y-6">

          {/* Impact tiers */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Impact tiers</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ amount: 2500, label: '' })}
              >
                <PlusIcon className="mr-1 h-4 w-4" />
                Add
              </Button>
            </div>
            <div className="space-y-3 p-4">
              {fields.length === 0 && (
                <p className="text-center text-sm text-muted-foreground">
                  No impact tiers yet. Add tiers to show donors what their contribution achieves.
                </p>
              )}
              {fields.map((field, index) => {
                const _tierCents = watch(`impactTiers.${index}.amount`);
                return (
                  <div key={field.id} className="flex items-end gap-2">
                    <div className="w-28 shrink-0">
                      <Label className="text-xs text-muted-foreground">Amount</Label>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="5"
                          className="pl-6 text-sm"
                          defaultValue={field.amount / 100}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) setValue(`impactTiers.${index}.amount`, Math.round(v * 100));
                          }}
                        />
                      </div>
                      {/* Sync actual cents value */}
                      <input type="hidden" {...register(`impactTiers.${index}.amount`, { valueAsNumber: true })} />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">What this provides</Label>
                      <Input {...register(`impactTiers.${index}.label`)} placeholder="e.g. Covers one week of medication" className="text-sm" />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(index)}
                      className="shrink-0"
                      aria-label={`Remove tier ${index + 1}`}
                    >
                      <TrashIcon className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
              {errors.impactTiers && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.impactTiers.message ?? errors.impactTiers.root?.message}
                </p>
              )}
            </div>
          </div>

          {/* Publish info (only in edit mode) */}
          {mode === 'edit' && (
            <div className="rounded-lg border border-dashed border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Campaign ID: <code className="font-mono text-foreground">{campaignId}</code>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Story HTML - full width ─── */}
      <FormSection title="Campaign story">
        <div>
          <FieldLabel required>Story content (HTML)</FieldLabel>
          <FieldHint>Tell the subject&apos;s story. Minimum 50 characters. Use HTML for formatting.</FieldHint>
          <Tabs defaultValue="edit" className="mt-2">
            <TabsList>
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview" onClick={handleShowPreview}>
                Preview
              </TabsTrigger>
            </TabsList>
            <TabsContent value="edit">
              <Textarea
                rows={16}
                className="font-mono text-sm"
                placeholder="<p>Write the campaign story here…</p>"
                {...register('storyHtml')}
              />
              <FieldError message={errors.storyHtml?.message} />
            </TabsContent>
            <TabsContent value="preview">
              {previewHtml ? (
                <div
                  className="prose max-w-none rounded-md border border-border bg-background p-4 dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <div className="rounded-md border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
                  Enter story content and click Preview to see rendered output.
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </FormSection>

      {/* ─── Form actions ─── */}
      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Saving…'
            : mode === 'create'
              ? 'Create Campaign'
              : 'Save Changes'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/campaigns')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
