'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { FundraiserPreviewModal } from './FundraiserPreviewModal';
import { computeStartingGoal } from '@/lib/compute-starting-goal';

// ─── Constants ──────────────────────────────────────────────────────────────

/*
  There used to be a `STEPS` array here naming all six screens
  ('Fundraiser Type', 'Set Your Goal', 'Add Media', …). Nothing rendered a
  single one of those strings — every use of the array was `STEPS.length`.
  It was a third parallel naming of the six screens, after `STEP_HERO` and
  the per-step headings inside the form, and the three had already drifted
  apart ('Category' vs 'Help us categorize your campaign' vs the h2 the step
  actually showed). One source of truth for the copy, one number for the
  count. See docs/75.
*/
const STEP_COUNT = 6;

const CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'medical', label: 'Medical' },
  { value: 'disaster', label: 'Disaster Relief' },
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
];

/*
  One heading per screen, and it is the question being asked.

  This is the whole copy budget for the top of each screen, and it is now
  the ONLY heading on it: each step used to restate its own title as an `h2`
  a few hundred pixels below (screen 1 asked "Who are you fundraising for?"
  three times before the two buttons that answer it), under a marketing
  `h1` that repeated on all six.

  Subtitles earn their place or they are gone. 'This information helps us
  understand the beneficiary and fundraising need' told the visitor nothing
  they could act on; `undefined` renders nothing at all. The ones that
  remain each say something the person does not already know.
*/
const STEP_HERO: ReadonlyArray<{ title: string; subtitle?: string }> = [
  { title: 'Who are you fundraising for?' },
  { title: 'How much do you want to raise?', subtitle: 'You can change this later.' },
  { title: 'Add photos', subtitle: 'The cover photo is the first thing a donor sees.' },
  { title: 'What is this fundraiser for?', subtitle: 'Donors browse by category and by place.' },
  { title: 'Tell the story', subtitle: 'What happened, and what the money will do.' },
  { title: 'Review and submit', subtitle: 'A person reads every campaign before it goes live.' },
];

const RELATIONS = [
  { value: 'self', label: 'Myself' },
  { value: 'family', label: 'A family member' },
  { value: 'friend', label: 'A friend' },
  { value: 'colleague', label: 'A colleague' },
  { value: 'community_member', label: 'A community member' },
  { value: 'organization', label: 'An organization' },
  { value: 'other', label: 'Someone else' },
] as const;

const DRAFT_KEY = 'lastdonor_campaign_draft';
const PENDING_PHOTO_DB = 'lastdonor_pending_photo';
const PENDING_PHOTO_STORE = 'files';

// ── IndexedDB helpers for pending photo persistence ─────────────────────
//
// When an unauthenticated user selects a photo, the File object is stored
// in IndexedDB so it survives the login redirect. localStorage can't hold
// binary data, and blob URLs become invalid after page unload. IndexedDB
// handles File objects natively and has generous size limits.

function openPendingPhotoDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PENDING_PHOTO_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PENDING_PHOTO_STORE)) {
        db.createObjectStore(PENDING_PHOTO_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePendingPhoto(file: File): Promise<void> {
  try {
    const db = await openPendingPhotoDB();
    const tx = db.transaction(PENDING_PHOTO_STORE, 'readwrite');
    tx.objectStore(PENDING_PHOTO_STORE).put(file, 'pendingPhoto');
    db.close();
  } catch {
    // IndexedDB unavailable (private browsing, etc.) - acceptable degradation
  }
}

async function loadPendingPhoto(): Promise<File | null> {
  try {
    const db = await openPendingPhotoDB();
    return new Promise((resolve) => {
      const tx = db.transaction(PENDING_PHOTO_STORE, 'readonly');
      const req = tx.objectStore(PENDING_PHOTO_STORE).get('pendingPhoto');
      req.onsuccess = () => {
        db.close();
        const file = req.result;
        resolve(file instanceof File ? file : null);
      };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch {
    return null;
  }
}

async function clearPendingPhoto(): Promise<void> {
  try {
    const db = await openPendingPhotoDB();
    const tx = db.transaction(PENDING_PHOTO_STORE, 'readwrite');
    tx.objectStore(PENDING_PHOTO_STORE).delete('pendingPhoto');
    db.close();
  } catch {
    // Ignore - best effort cleanup
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface FormData {
  // Step 0: Who are you raising funds for?
  fundraisingFor: string;
  // Step 1: Set Your Goal
  goalAmount: string;
  autoGoal: boolean;
  // Step 2: Add Media
  heroImageUrl: string;
  galleryImages: string[];
  photoCredit: string;
  youtubeUrl: string;
  // Step 3: Category, Location & Who
  subjectHometown: string;
  category: string;
  subjectName: string;
  beneficiaryRelation: string;
  beneficiaryConsent: boolean;
  // Step 4: Tell Their Story
  title: string;
  story: string;
  // Step 5: Review & Submit (legal)
  agreedToTerms: boolean;
  confirmedTruthful: boolean;
}

type FormErrors = Partial<Record<string, string>>;

const INITIAL: FormData = {
  fundraisingFor: '',
  goalAmount: '',
  autoGoal: true,
  heroImageUrl: '',
  galleryImages: [],
  photoCredit: '',
  youtubeUrl: '',
  subjectName: '',
  subjectHometown: '',
  beneficiaryRelation: '',
  category: '',
  beneficiaryConsent: false,
  title: '',
  story: '',
  agreedToTerms: false,
  confirmedTruthful: false,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function storyCharMessage(len: number): { text: string; color: string } {
  if (len === 0) return { text: '', color: '' };
  if (len < 200)
    return { text: `Keep going, ${200 - len} more characters needed`, color: 'text-amber-600 dark:text-amber-400' };
  if (len < 500)
    return { text: 'Good start. More detail helps donors connect.', color: 'text-teal-600 dark:text-teal-400' };
  if (len < 800)
    return { text: 'Nice work. Campaigns with detailed stories raise significantly more.', color: 'text-teal-600 dark:text-teal-400' };
  if (len < 1500)
    return { text: 'Strong story. This level of detail inspires donors to give.', color: 'text-teal-600 dark:text-teal-400' };
  return { text: 'Excellent. This is the kind of detail that makes campaigns successful.', color: 'text-teal-600 dark:text-teal-400' };
}

/**
 * Extract a YouTube video ID from common URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * Returns null if the URL is not a valid YouTube link.
 */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') {
      // /watch?v=ID
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      // /embed/ID or /shorts/ID
      const match = u.pathname.match(/^\/(embed|shorts)\/([\w-]{11})/);
      if (match) return match[2];
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Focus trap helper for inline dialogs ───────────────────────────────────
const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

function trapFocus(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'Tab') return;
  const container = e.currentTarget.querySelector<HTMLElement>('[role="dialog"] > div') ?? e.currentTarget;
  const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

type MediaDialog = 'closed' | 'picker' | 'youtube';
type EditField = 'title' | 'goal' | 'story' | 'youtube' | 'category' | 'location' | 'name' | 'relationship' | null;

export function ShareYourStoryForm() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [showPreview, setShowPreview] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState(false);
  const [showPhotoCredit, setShowPhotoCredit] = useState(false);
  const [mediaDialog, setMediaDialog] = useState<MediaDialog>('closed');
  const [ytInput, setYtInput] = useState('');
  const [ytError, setYtError] = useState('');
  const [editField, setEditField] = useState<EditField>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingGalleryFiles, setPendingGalleryFiles] = useState<File[]>([]);
  const blobUrlRef = useRef<string | null>(null);
  const galleryBlobUrlsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: session } = useSession();
  const router = useRouter();

  // ── Blob URL management ────────────────────────────────────────────────
  //
  // When an unauthenticated user selects a photo, we create a blob URL for
  // local preview. The ref tracks the current blob URL so we can revoke it
  // when replaced or on unmount, preventing memory leaks.

  function setBlobPreview(file: File) {
    // Revoke previous blob URL if any
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    setPendingFile(file);
    update('heroImageUrl', url);
  }

  function clearBlobPreview() {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPendingFile(null);
  }

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      galleryBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // ── Draft persistence ──────────────────────────────────────────────────
  //
  // Persists form fields + current step to localStorage so the user's
  // progress survives page reloads and login redirects. Legal checkboxes
  // are excluded: re-checking them is a deliberate, low-effort action that
  // reinforces consent (Baymard Institute recommendation for legal fields).

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<FormData & { _step: number }>;
        const { _step, ...fields } = parsed;
        // BUG 6 fix: Sanitize stale drafts - 'charity' was removed as a fundraisingFor option
        if (fields.fundraisingFor && !['yourself', 'someone_else'].includes(fields.fundraisingFor)) {
          fields.fundraisingFor = '';
        }
        // Ensure beneficiaryRelation is consistent with fundraisingFor
        if (fields.fundraisingFor === 'yourself' && fields.beneficiaryRelation !== 'self') {
          fields.beneficiaryRelation = 'self';
        }
        setForm((prev) => ({ ...prev, ...fields }));
        if (typeof _step === 'number' && _step >= 0 && _step < STEP_COUNT) {
          setStep(_step);
        }
        setDraftRestored(true);
        if (fields.photoCredit) setShowPhotoCredit(true);
      }
    } catch {
      // Corrupt draft, ignore
    }
  }, []);

  // Restore pending photo from IndexedDB after login redirect.
  // The File object is stored before redirect and restored here to
  // re-create the blob URL preview without requiring re-selection.
  useEffect(() => {
    loadPendingPhoto().then((file) => {
      if (file) {
        setBlobPreview(file);
        clearPendingPhoto();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDraft = useCallback((data: FormData, currentStep: number) => {
    try {
      const { agreedToTerms: _agreedToTerms, confirmedTruthful: _confirmedTruthful, ...draftFields } = data;
      // Exclude blob URLs from draft - they become invalid after page unload.
      // The pending file is persisted separately in IndexedDB.
      const heroUrl = draftFields.heroImageUrl ?? '';
      if (heroUrl.startsWith('blob:')) {
        draftFields.heroImageUrl = '';
      }
      // Exclude blob URLs from gallery images
      draftFields.galleryImages = (draftFields.galleryImages ?? []).filter(
        (url) => !url.startsWith('blob:'),
      );
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draftFields, _step: currentStep }));
    } catch {
      // localStorage full or unavailable, acceptable degradation
    }
  }, []);

  useEffect(() => {
    if (form.fundraisingFor || form.subjectHometown || form.category || form.subjectName || form.title || form.story) {
      saveDraft(form, step);
    }
  }, [form, step, saveDraft]);

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }

  // ── Form updates ───────────────────────────────────────────────────────

  function update(field: keyof FormData, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (field === 'heroImageUrl') setImagePreviewError(false);
  }

  // ── Step validation ────────────────────────────────────────────────────
  //
  // Each step validates only its own fields. The Add Media step (step 2)
  // has no required fields -- the photo is only required at step 5
  // (Review & Submit). Authentication is deferred to the publish action
  // so users can complete all steps without signing in first.
  function validateStep(s: number): boolean {
    const errs: FormErrors = {};

    if (s === 0) {
      if (!form.fundraisingFor)
        errs.fundraisingFor = 'Please select who you are raising funds for';
      if (form.fundraisingFor === 'someone_else') {
        if (form.subjectName.trim().length < 2)
          errs.subjectName = 'Name must be at least 2 characters';
        if (!form.beneficiaryRelation)
          errs.beneficiaryRelation = 'Please select your relationship';
      }
    } else if (s === 1) {
      const amount = parseInt(form.goalAmount || '0', 10);
      if (isNaN(amount) || amount < 1) errs.goalAmount = 'Minimum goal is $1';
      else if (amount > 1_000_000_000) errs.goalAmount = 'Maximum goal is $1,000,000,000';
    } else if (s === 2) {
      // Add Media - no required fields; photo is validated at Review
    } else if (s === 3) {
      if (form.subjectHometown.trim().length < 2)
        errs.subjectHometown = 'Location is required (e.g. "Austin, TX")';
      if (!form.category)
        errs.category = 'Please select a category';
    } else if (s === 4) {
      if (form.title.trim().length < 20)
        errs.title = `Title must be at least 20 characters (${form.title.trim().length}/20)`;
      if (form.title.trim().length > 120)
        errs.title = 'Title must be under 120 characters';
      if (form.story.trim().length < 200)
        errs.story = `Story must be at least 200 characters (${form.story.trim().length}/200)`;
    } else if (s === 5) {
      // BUG 4 fix: Comprehensive validation - re-check ALL fields at Review
      // so inline edits that broke previously-valid data are caught before submission.
      if (!form.heroImageUrl.trim())
        errs.heroImageUrl = 'A campaign photo is required';
      if (form.youtubeUrl.trim() && !extractYouTubeId(form.youtubeUrl.trim()))
        errs.youtubeUrl = 'Please enter a valid YouTube link or remove the video';
      const goalNum = parseInt(form.goalAmount || '0', 10);
      if (isNaN(goalNum) || goalNum < 1)
        errs.goalAmount = 'Minimum goal is $1';
      else if (goalNum > 1_000_000_000)
        errs.goalAmount = 'Maximum goal is $1,000,000,000';
      if (form.subjectHometown.trim().length < 2)
        errs.subjectHometown = 'Location is required (e.g. "Austin, TX")';
      if (!form.category)
        errs.category = 'Please select a category';
      if (form.fundraisingFor === 'someone_else') {
        if (form.subjectName.trim().length < 2)
          errs.subjectName = 'Beneficiary name must be at least 2 characters';
        if (!form.beneficiaryRelation || form.beneficiaryRelation === 'self')
          errs.beneficiaryRelation = 'Please select your relationship';
      }
      if (form.title.trim().length < 20)
        errs.title = `Title must be at least 20 characters (${form.title.trim().length}/20)`;
      if (form.title.trim().length > 120)
        errs.title = 'Title must be under 120 characters';
      if (form.story.trim().length < 200)
        errs.story = `Story must be at least 200 characters (${form.story.trim().length}/200)`;
      // Consent checks removed -- implicit when user clicks "Launch fundraiser".
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  //
  // All steps are freely navigable without authentication. Auth is deferred
  // to the publish action so users can invest time in building their
  // campaign before being asked to sign in. The current step is saved in
  // the draft so the user returns to the same place after signing in.

  function goNext() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  // ── Preview & Submit ──────────────────────────────────────────────────

  /** Show the preview modal (validate first, auth gate for unauthenticated). */
  function handlePreviewLaunch() {
    // Auth gate: redirect to login if not signed in
    if (!session?.user) {
      if (pendingFile) savePendingPhoto(pendingFile);
      saveDraft(form, 5);
      router.push('/login?callbackUrl=%2Fshare-your-story');
      return;
    }
    if (!validateStep(5)) return;
    setShowPreview(true);
  }

  /** Actually submit the campaign (called from preview modal confirm). */
  async function handleSubmit() {
    // BUG 5 fix: Guard against double-submit
    if (submitting) return;

    setSubmitting(true);
    try {
      // If there's a pending file (selected while unauthenticated), upload
      // it now that we're authenticated. Replace the blob URL with the real
      // server URL before creating the campaign.
      let resolvedHeroImageUrl = form.heroImageUrl.trim();
      if (pendingFile) {
        const uploadData = new FormData();
        uploadData.append('file', pendingFile);
        try {
          const uploadRes = await fetch('/api/v1/campaign-photos', {
            method: 'POST',
            body: uploadData,
          });
          const uploadJson = await uploadRes.json();
          if (!uploadRes.ok) {
            const { toast } = await import('sonner');
            toast.error(uploadJson.error?.message || 'Photo upload failed. Please try again.');
            setSubmitting(false);
            return;
          }
          resolvedHeroImageUrl = uploadJson.data.url;
          // Update form state so the preview shows the real URL going forward
          clearBlobPreview();
          update('heroImageUrl', resolvedHeroImageUrl);
          clearPendingPhoto();
        } catch {
          const { toast } = await import('sonner');
          toast.error('Photo upload failed. Please check your connection and try again.');
          setSubmitting(false);
          return;
        }
      }

      // Upload any pending gallery files (selected while unauthenticated)
      const resolvedGalleryImages = (form.galleryImages ?? []).filter(
        (url) => !url.startsWith('blob:'),
      );
      if (pendingGalleryFiles.length > 0) {
        for (const gFile of pendingGalleryFiles) {
          const uploadData = new FormData();
          uploadData.append('file', gFile);
          try {
            const uploadRes = await fetch('/api/v1/campaign-photos', {
              method: 'POST',
              body: uploadData,
            });
            const uploadJson = await uploadRes.json();
            if (uploadRes.ok) {
              resolvedGalleryImages.push(uploadJson.data.url);
            }
          } catch {
            // Skip failed gallery uploads - non-blocking
          }
        }
        // Clean up gallery blob URLs
        galleryBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        galleryBlobUrlsRef.current = [];
        setPendingGalleryFiles([]);
      }

      const goalCents = parseInt(form.goalAmount, 10) * 100;

      // BUG 3 fix: Validate session.user.name exists for "yourself" fundraisers
      const resolvedSubjectName =
        form.fundraisingFor === 'yourself'
          ? (session?.user?.name ?? '').trim()
          : form.subjectName.trim();

      if (resolvedSubjectName.length < 2) {
        const { toast } = await import('sonner');
        toast.error(
          form.fundraisingFor === 'yourself'
            ? 'Your profile name is required. Please update your name in your profile settings before creating a campaign.'
            : 'Beneficiary name must be at least 2 characters.'
        );
        return;
      }

      // Ensure beneficiaryRelation is valid for the "yourself" case.
      // Stale drafts or race conditions could leave it as '' which fails
      // server-side enum validation.
      const resolvedRelation =
        form.fundraisingFor === 'yourself' ? 'self' : form.beneficiaryRelation;

      const res = await fetch('/api/v1/user-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectName: resolvedSubjectName,
          subjectHometown: form.subjectHometown.trim(),
          beneficiaryRelation: resolvedRelation,
          category: form.category,
          beneficiaryConsent: true,
          title: form.title.trim(),
          story: form.story.trim(),
          goalAmount: goalCents,
          heroImageUrl: resolvedHeroImageUrl,
          galleryImages: resolvedGalleryImages.length > 0 ? resolvedGalleryImages : undefined,
          photoCredit: form.photoCredit.trim() || undefined,
          youtubeUrl: form.youtubeUrl.trim() || undefined,
          agreedToTerms: true,
          confirmedTruthful: true,
        }),
      });

      let data: Record<string, unknown> | null = null;
      try {
        data = await res.json();
      } catch {
        // Response body is not JSON (e.g. HTML error page from edge/proxy)
      }

      if (!res.ok) {
        const { toast } = await import('sonner');
        const msg =
          data?.error && typeof data.error === 'object' && 'message' in data.error
            ? String((data.error as Record<string, unknown>).message)
            : data?.message
              ? String(data.message)
              : typeof data?.error === 'string'
                ? data.error
                : 'Failed to create campaign. Please try again.';
        toast.error(msg, { duration: 8000 });
        console.error(
          `[campaign-create] status=${res.status} body=${JSON.stringify(data)}`,
        );
        return;
      }

      clearDraft();
      clearBlobPreview();
      clearPendingPhoto();

      // Redirect to the live campaign page so the organizer sees exactly
      // what donors see. The ?launched=true param triggers a success banner
      // with share buttons and a verification prompt.
      const slug = (data?.data as Record<string, unknown> | undefined)?.slug;
      router.push(typeof slug === 'string' ? `/campaigns/${slug}?launched=true` : '/dashboard');
      return;
    } catch (err) {
      const { toast } = await import('sonner');
      toast.error('Something went wrong. Please try again.');
      console.error('[campaign-create] unhandled:', err instanceof Error ? err.message : err);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────

  const goalDollars = form.goalAmount ? parseInt(form.goalAmount, 10) : 0;

  const startingGoal = computeStartingGoal(goalDollars);
  const storyLen = form.story.trim().length;
  const storyMsg = storyCharMessage(storyLen);
  const showBeneficiaryConsent = form.beneficiaryRelation && form.beneficiaryRelation !== 'self';

  return (
    /*
      `data-focus-flow` suppresses the sitewide navbar and footer (the
      `:has()` rule in globals.css). Measured at 390px, screen 1 of this
      wizard was 2,715px against GoFundMe's 844px, and roughly 1,500px of
      ours was the footer, the newsletter strip and a four-answer FAQ sitting
      under a form the visitor had not finished. The sticky Continue bar was
      a casualty of the same thing: with that much page below the panel, it
      parked over the second option card instead of at the foot of the form.
      See docs/75.
    */
    <div data-focus-flow className="flex min-h-[100dvh] flex-col lg:flex-row">
      {/* Fundraiser preview modal */}
      {showPreview && (
        <FundraiserPreviewModal
          data={{
            title: form.title,
            story: form.story,
            heroImageUrl: form.heroImageUrl,
            galleryImages: form.galleryImages ?? [],
            youtubeUrl: form.youtubeUrl || null,
            photoCredit: form.photoCredit,
            category: form.category,
            subjectName: form.fundraisingFor === 'yourself'
              ? (session?.user?.name ?? '')
              : form.subjectName,
            subjectHometown: form.subjectHometown,
            goalAmount: form.goalAmount,
            beneficiaryRelation: form.beneficiaryRelation,
            organizerName: session?.user?.name ?? 'You',
            organizerImage: session?.user?.image ?? null,
          }}
          onClose={() => setShowPreview(false)}
          onConfirmLaunch={() => {
            setShowPreview(false);
            handleSubmit();
          }}
          launching={submitting}
        />
      )}

      {/* Publishing overlay */}
      {submitting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          role="status"
          aria-label="Publishing your campaign"
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="relative h-16 w-16">
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-muted" />
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-t-primary" style={{ animationDuration: '1.2s' }} />
            </div>
            <div>
              <p className="font-display text-xl font-semibold text-foreground">
                Publishing your campaign
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Hang tight, your campaign will be live in just a moment.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Left Panel - Hero/Brand (desktop only) */}
      <aside className="relative hidden lg:flex lg:w-[25%] lg:shrink-0 lg:flex-col lg:sticky lg:top-0 lg:h-dvh">
        {/* Logo - anchored top-left */}
        <div className="px-8 pt-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-teal/10">
            <svg className="h-5 w-5 text-brand-teal" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
            </svg>
          </div>
        </div>
        {/* Step content - positioned above center */}
        <div className="flex flex-1 flex-col justify-center px-8 pb-28">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-brand-teal">
              Step {step + 1} of {STEP_COUNT}
            </p>
            {/*
              The page's `h1`. It used to be a `<p>`, with the real `h1`
              spent on "Start a fundraiser on LastDonor" in the form panel -
              so the largest text on screen was not a heading, and the
              heading was not what the screen was about. This is also the
              desktop copy of the same heading the mobile bar renders; only
              one is ever visible, which `lg:hidden` / `hidden lg:flex`
              guarantee.
            */}
            <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground lg:text-4xl">
              {STEP_HERO[step].title}
            </h1>
            {STEP_HERO[step].subtitle && (
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                {STEP_HERO[step].subtitle}
              </p>
            )}
          </div>

          {/* Reciprocity: surface what the platform gives back, so the effort of filling
              out the form reads as a fair trade instead of a hurdle. */}
          <ul className="mt-10 space-y-2.5 border-t border-border pt-6">
            <li className="flex items-start gap-2 text-sm text-foreground">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Draft in minutes. Reviewed before publication.</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-foreground">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>0% platform fees. Standard payment processing fees apply.</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-foreground">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Save and come back - we keep your draft.</span>
            </li>
          </ul>
        </div>
      </aside>

      {/*
        Mobile chrome (< lg). With the sitewide navbar suppressed, this is
        the only bar a phone gets, so it carries the two things GoFundMe's
        create header carries: whose site this is, and a way out that does
        not lose the draft. Everything is saved to localStorage on change,
        so "Save & exit" is a plain link, not a confirm dialog.
      */}
      <div className="lg:hidden">
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <Link
            href="/"
            className="font-display text-base font-bold tracking-tight text-foreground"
          >
            Last<span className="text-primary">Donor</span>
            <span className="text-accent">.</span>
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Save &amp; exit
          </Link>
        </div>
        <div className="px-6 pb-6 pt-7">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-teal">
            Step {step + 1} of {STEP_COUNT}
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {STEP_HERO[step].title}
          </h1>
          {STEP_HERO[step].subtitle && (
            <p className="mt-2 text-sm text-muted-foreground">
              {STEP_HERO[step].subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex flex-1 flex-col bg-stone-50 dark:bg-gray-900/40">
        <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 lg:px-12 lg:py-16">
          {/*
            A marketing header used to sit here - "Start a fundraiser on
            LastDonor" plus a 30-word sentence listing nine categories - and
            it rendered on ALL SIX screens, between the step heading and the
            step's own fields. On a phone that put two large headings and a
            four-line paragraph in front of every question. Its job was SEO,
            and the page's `<title>`, meta description and FAQ JSON-LD
            already do that job; its `h1` has moved to the step heading,
            which is what the screen is actually about. See docs/75.
          */}
          {/* Draft restored notice */}
          {draftRestored && step === 0 && (
            <div className="mb-8 flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 dark:border-teal-900 dark:bg-teal-950/30">
              <p className="text-sm text-teal-800 dark:text-teal-200">
                Your previous draft has been restored.
              </p>
              <button
                type="button"
                onClick={() => {
                  setForm(INITIAL);
                  setStep(0);
                  clearDraft();
                  clearBlobPreview();
                  clearPendingPhoto();
                  setDraftRestored(false);
                }}
                className="text-sm font-medium text-teal-700 underline hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-100"
              >
                Start fresh
              </button>
            </div>
          )}
          {/* ── Step 0: Who are you raising funds for? ──────────────── */}
          {step === 0 && (
            <div className="space-y-8">
              {/*
                The `h2` that was here read "Who are you fundraising for?" -
                the step heading, word for word, a few hundred pixels below
                itself. With the marketing header gone the heading is the
                nearest thing above these buttons, so the question is asked
                once.
              */}
              {errors.fundraisingFor && <p className="text-sm text-red-500">{errors.fundraisingFor}</p>}
              <div className="space-y-4" role="radiogroup" aria-label="Who are you fundraising for?">
                {[
                  {
                    value: 'yourself',
                    title: 'Yourself',
                    description: 'Funds are delivered to your bank account for your own use',
                    icon: (
                      <svg className="h-7 w-7 text-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                      </svg>
                    ),
                  },
                  {
                    value: 'someone_else',
                    title: 'Someone else',
                    description: "You'll invite a beneficiary to receive funds or distribute them yourself",
                    icon: (
                      <svg className="h-7 w-7 text-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                      </svg>
                    ),
                  },
                ].map((type) => {
                  const isSelected = form.fundraisingFor === type.value;
                  return (
                    <button
                      key={type.value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => {
                        update('fundraisingFor', type.value);
                        if (type.value === 'yourself') {
                          update('beneficiaryRelation', 'self');
                        } else if (form.beneficiaryRelation === 'self') {
                          update('beneficiaryRelation', '');
                        }
                      }}
                      className={`group flex w-full items-center gap-5 rounded-xl border-2 p-5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                        isSelected
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border bg-card hover:border-foreground/30 hover:shadow-sm'
                      }`}
                    >
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors ${
                        isSelected ? 'bg-primary/10' : 'bg-muted'
                      }`}>
                        {type.icon}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{type.title}</p>
                        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{type.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Conditional fields for "someone else" */}
              {form.fundraisingFor === 'someone_else' && (
                <>
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold text-foreground">Who are you fundraising for?</h2>
                    <Input
                      id="subjectName"
                      value={form.subjectName}
                      onChange={(e) => update('subjectName', e.target.value)}
                      maxLength={200}
                      placeholder="Their full name"
                      className="h-14 text-base"
                      aria-invalid={!!errors.subjectName}
                      aria-describedby={errors.subjectName ? 'subjectName-error' : undefined}
                    />
                    {errors.subjectName && <p id="subjectName-error" className="text-sm text-red-500">{errors.subjectName}</p>}
                  </div>

                  <div className="space-y-4">
                    <h2 className="text-xl font-bold text-foreground">What is your relationship to this person?</h2>
                    <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Relationship to beneficiary">
                      {RELATIONS.filter((r) => r.value !== 'self').map((r) => {
                        const selected = form.beneficiaryRelation === r.value;
                        return (
                          <button
                            key={r.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => update('beneficiaryRelation', r.value)}
                            className={`rounded-full border px-4 py-2 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                              selected
                                ? 'border-green-600 bg-green-50 font-medium text-green-900 dark:border-green-500 dark:bg-green-950/40 dark:text-green-100'
                                : 'border-border bg-background text-foreground hover:border-foreground/40 hover:bg-accent/50'
                            }`}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                    {errors.beneficiaryRelation && (
                      <p className="text-sm text-red-500">{errors.beneficiaryRelation}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 1: Set Your Goal ─────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-8">
              {/* Amount input */}
              <div className="space-y-4">
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-muted-foreground">$</span>
                  <Input
                    id="goalAmount"
                    type="number"
                    min={1}
                    max={1_000_000_000}
                    step={1}
                    value={form.goalAmount}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // Strip decimals and leading zeros; block negatives
                      const sanitized = raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
                      // Clamp to 1 billion
                      const num = parseInt(sanitized || '0', 10);
                      if (num > 1_000_000_000) {
                        update('goalAmount', '1000000000');
                      } else {
                        update('goalAmount', sanitized);
                      }
                    }}
                    onKeyDown={(e) => {
                      // Block decimal point, minus, and 'e' keys
                      if (e.key === '.' || e.key === '-' || e.key === 'e' || e.key === '+') {
                        e.preventDefault();
                      }
                    }}
                    className="h-14 pl-9 pr-20 text-lg [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    placeholder="Enter amount"
                    aria-label="Fundraising goal amount in dollars"
                    aria-invalid={!!errors.goalAmount}
                    aria-describedby={errors.goalAmount ? 'goalAmount-error' : 'goalAmount-hint'}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    USD
                  </span>
                </div>
                {errors.goalAmount && <p id="goalAmount-error" className="text-sm text-red-500">{errors.goalAmount}</p>}
                <p id="goalAmount-hint" className="text-base text-muted-foreground">
                  <span className="underline cursor-pointer hover:text-foreground">Fundraisers like yours</span>{' '}
                  typically aim to raise{' '}
                  <span className="font-medium text-foreground">$5,000</span>
                </p>
              </div>

              {/* Automated goal setting card */}
              <div className="rounded-xl border border-border bg-muted/30 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <span className="inline-block rounded border border-green-600 bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-800 dark:border-green-500 dark:bg-green-950/40 dark:text-green-300">
                      Recommended
                    </span>
                    <h3 className="text-base font-bold text-foreground">Automated goal setting</h3>
                    <p className="text-base leading-relaxed text-muted-foreground">
                      To help build momentum, we&apos;ll gradually adjust your goal as donations come in.{' '}
                      <span className="underline cursor-pointer hover:text-foreground">More details</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.autoGoal}
                    aria-label="Automated goal setting"
                    onClick={() => update('autoGoal', !form.autoGoal)}
                    className={`relative mt-1 inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                      form.autoGoal
                        ? 'bg-green-600'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
                        form.autoGoal ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {goalDollars > 0 && form.autoGoal && (
                <div className="flex items-center gap-2 px-1">
                  <svg className="h-5 w-5 shrink-0 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                  <p className="text-base text-muted-foreground">
                    Your starting goal would be:{' '}
                    <span className="font-bold text-foreground">${startingGoal.toLocaleString()}</span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Add Media ─────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-8">
              <div className="space-y-3">
                <h2 className="text-2xl font-bold text-foreground">
                  Add a cover photo or video
                </h2>
                <p className="text-base text-muted-foreground">
                  Cover media helps tell your story. You can upload up to 5 photos
                  and add a YouTube video. If you find better media later,
                  you can always change it.
                </p>
              </div>

              {/* ── Photo grid ────────────────────────────────────── */}
              {form.heroImageUrl && (() => {
                const allImages = [form.heroImageUrl, ...(form.galleryImages ?? [])];
                const canAddMore = allImages.length < 5;
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
                      {allImages.map((url, i) => (
                        <div
                          key={`${url}-${i}`}
                          className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={i === 0 ? 'Main campaign photo' : `Campaign photo ${i + 1}`}
                            className="h-full w-full object-cover"
                            onError={() => {
                              setForm((prev) => ({ ...prev, galleryImages: (prev.galleryImages ?? []).filter((u) => u !== url) }));
                            }}
                          />
                          {/* Main photo badge */}
                          {i === 0 && (
                            <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                              Main
                            </span>
                          )}
                          {/* Remove button */}
                          <button
                            type="button"
                            onClick={() => {
                              if (i === 0) {
                                // Removing hero: promote first gallery image to hero
                                const gallery = form.galleryImages ?? [];
                                if (gallery.length > 0) {
                                  const [newHero, ...rest] = gallery;
                                  clearBlobPreview();
                                  setForm((prev) => ({
                                    ...prev,
                                    heroImageUrl: newHero,
                                    galleryImages: rest,
                                  }));
                                } else {
                                  clearBlobPreview();
                                  update('heroImageUrl', '');
                                }
                              } else {
                                // Removing a gallery image
                                const idx = i - 1;
                                setForm((prev) => ({
                                  ...prev,
                                  galleryImages: (prev.galleryImages ?? []).filter((_, gi) => gi !== idx),
                                }));
                              }
                            }}
                            className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
                            aria-label={`Remove photo ${i + 1}`}
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}

                      {/* Add more button */}
                      {canAddMore && (
                        <button
                          type="button"
                          onClick={() => {
                            fileInputRef.current?.click();
                          }}
                          className="flex aspect-square flex-col items-center justify-center rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent/30 hover:text-foreground"
                          aria-label="Add another photo"
                        >
                          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                          <span className="mt-1 text-xs">Add photo</span>
                        </button>
                      )}
                    </div>

                    {/* Photo credit */}
                    {!showPhotoCredit ? (
                      <button
                        type="button"
                        onClick={() => setShowPhotoCredit(true)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        + Add photo credit
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="photoCredit">
                          Photo credit <span className="text-muted-foreground">(optional)</span>
                        </Label>
                        <Input
                          id="photoCredit"
                          value={form.photoCredit}
                          onChange={(e) => update('photoCredit', e.target.value)}
                          maxLength={200}
                          placeholder="Photo by Jane Smith"
                        />
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── YouTube preview ───────────────────────────────── */}
              {form.youtubeUrl && (() => {
                const videoId = extractYouTubeId(form.youtubeUrl);
                return videoId ? (
                  <div className="space-y-2">
                    <div className="group relative overflow-hidden rounded-lg border border-border">
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                        title="YouTube video preview"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="aspect-video w-full"
                      />
                      <button
                        type="button"
                        onClick={() => update('youtubeUrl', '')}
                        className="absolute top-2 right-2 rounded bg-black/60 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : null;
              })()}

              {/* ── Upload area (opens picker dialog) ────────────── */}
              {!form.heroImageUrl && !form.youtubeUrl && (
                <button
                  type="button"
                  onClick={() => setMediaDialog('picker')}
                  className="flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border px-6 py-16 text-center transition-colors hover:border-foreground/30 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  aria-label="Upload a photo or video"
                >
                  <svg className="mb-3 h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                  <p className="text-sm text-muted-foreground">Upload a photo or video</p>
                </button>
              )}

              {/* ── Add second media type ─────────────────────────── */}
              {(form.heroImageUrl && !form.youtubeUrl) && (
                <button
                  type="button"
                  onClick={() => { setYtInput(''); setYtError(''); setMediaDialog('youtube'); }}
                  className="flex items-center gap-2 text-xs font-medium text-primary hover:underline"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" />
                    <path fill="white" d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                  Add a YouTube video
                </button>
              )}
              {(!form.heroImageUrl && form.youtubeUrl) && (
                <button
                  type="button"
                  onClick={() => setMediaDialog('picker')}
                  className="flex items-center gap-2 text-xs font-medium text-primary hover:underline"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                  Upload a photo
                </button>
              )}

              {/* ── Media picker dialog (overlay) ────────────────── */}
              {mediaDialog !== 'closed' && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                  onClick={() => setMediaDialog('closed')}
                  onKeyDown={trapFocus}
                  role="dialog"
                  aria-modal="true"
                  aria-label={mediaDialog === 'picker' ? 'Choose media type' : 'Add YouTube video'}
                >
                  <div
                    className="relative mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {mediaDialog === 'picker' && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            setMediaDialog('closed');
                            fileInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-3 rounded-lg px-4 py-3.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent"
                        >
                          <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                          </svg>
                          Upload a photo
                        </button>
                        <hr className="border-border" />
                        <button
                          type="button"
                          onClick={() => {
                            setYtInput(form.youtubeUrl || '');
                            setYtError('');
                            setMediaDialog('youtube');
                          }}
                          className="flex w-full items-center gap-3 rounded-lg px-4 py-3.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent"
                        >
                          <svg className="h-5 w-5 text-muted-foreground" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" />
                            <path fill="white" d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                          </svg>
                          Add a YouTube video
                        </button>
                        <hr className="border-border" />
                        <button
                          type="button"
                          onClick={() => setMediaDialog('closed')}
                          className="flex w-full items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    {mediaDialog === 'youtube' && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-bold text-foreground">Paste a YouTube link</h3>
                          <button
                            type="button"
                            onClick={() => setMediaDialog('closed')}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label="Close"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="space-y-2">
                          <div className="relative">
                            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.193-9.193a4.5 4.5 0 00-6.364 0l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                            </svg>
                            <Input
                              value={ytInput}
                              onChange={(e) => { setYtInput(e.target.value); setYtError(''); }}
                              placeholder="YouTube link"
                              className="pl-9"
                              aria-label="YouTube link"
                              aria-invalid={!!ytError}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const trimmed = ytInput.trim();
                                  if (!trimmed) { setYtError('Please paste a YouTube link'); return; }
                                  const id = extractYouTubeId(trimmed);
                                  if (!id) { setYtError('Please enter a valid YouTube link'); return; }
                                  update('youtubeUrl', trimmed);
                                  setMediaDialog('closed');
                                }
                              }}
                            />
                          </div>
                          {ytError && <p className="text-sm text-red-500">{ytError}</p>}
                          <p className="text-sm text-muted-foreground">
                            If you want to use a video from your device, please upload it to YouTube first.
                          </p>
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              const trimmed = ytInput.trim();
                              if (!trimmed) { setYtError('Please paste a YouTube link'); return; }
                              const id = extractYouTubeId(trimmed);
                              if (!id) { setYtError('Please enter a valid YouTube link'); return; }
                              update('youtubeUrl', trimmed);
                              setMediaDialog('closed');
                            }}
                            className="rounded-full bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
                          >
                            Add video
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ── Step 3: Category & Location ────────────────────────── */}
          {step === 3 && (
            <div className="space-y-10">
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-foreground">Where will the funds go?</h2>
                <p className="text-base text-muted-foreground">
                  The location where the person in need is based.
                </p>
                <Input
                  id="subjectHometown"
                  value={form.subjectHometown}
                  onChange={(e) => update('subjectHometown', e.target.value)}
                  maxLength={200}
                  placeholder="City, State (e.g. Austin, TX)"
                  className="h-14 text-base"
                  aria-invalid={!!errors.subjectHometown}
                  aria-describedby={errors.subjectHometown ? 'subjectHometown-error' : undefined}
                />
                {errors.subjectHometown && <p id="subjectHometown-error" className="text-sm text-red-500">{errors.subjectHometown}</p>}
              </div>

              <div className="space-y-4">
                <h2 className="text-xl font-bold text-foreground">What best describes why you&apos;re fundraising?</h2>
                <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Campaign category">
                  {CATEGORIES.map((cat) => {
                    const selected = form.category === cat.value;
                    return (
                      <button
                        key={cat.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => update('category', cat.value)}
                        className={`rounded-full border px-4 py-2 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                          selected
                            ? 'border-green-600 bg-green-50 font-medium text-green-900 dark:border-green-500 dark:bg-green-950/40 dark:text-green-100'
                            : 'border-border bg-background text-foreground hover:border-foreground/40 hover:bg-accent/50'
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
                {errors.category && <p className="text-sm text-red-500">{errors.category}</p>}
              </div>
            </div>
          )}

          {/* ── Step 4: Tell Their Story ─────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-10">
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-foreground">Campaign title</h2>
                <p className="text-base text-muted-foreground">
                  A specific, person-focused title that tells donors exactly what this
                  campaign is about.
                </p>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => update('title', e.target.value)}
                  maxLength={120}
                  placeholder={
                    form.subjectName
                      ? `Help ${form.subjectName} with...`
                      : 'Help [Name] recover from [situation]'
                  }
                  aria-invalid={!!errors.title}
                  aria-describedby={errors.title ? 'title-error' : 'title-hint'}
                />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span id="title-hint">{form.title.trim().length} / 120 characters</span>
                  {form.title.trim().length > 0 && form.title.trim().length < 20 && (
                    <span className="text-amber-500">{20 - form.title.trim().length} more needed</span>
                  )}
                </div>
                {errors.title && <p id="title-error" className="text-sm text-red-500">{errors.title}</p>}
              </div>

              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-foreground">
                  Tell {form.subjectName ? `${form.subjectName}'s` : 'their'} story
                </h2>
                <div className="rounded-lg border border-border bg-muted/50 p-5">
                  <p className="text-base font-semibold text-foreground">Writing tips</p>
                  <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    <li>Use their first name, not &ldquo;the patient&rdquo;</li>
                    <li>Include one personal detail that makes them real: their hometown, a hobby, a family role</li>
                    <li>Explain what happened in plain language, no jargon</li>
                    <li>Be specific about the gap: what do they need that they don&apos;t have?</li>
                    <li>Show strength, not helplessness. These are people, not victims</li>
                  </ul>
                </div>
                <Textarea
                  id="story"
                  value={form.story}
                  onChange={(e) => update('story', e.target.value)}
                  rows={14}
                  maxLength={10000}
                  placeholder={
                    form.subjectName
                      ? `${form.subjectName} is from ${form.subjectHometown || '[their hometown]'}. [Share what happened and when the situation began.]\n\n[How is this affecting ${form.subjectName} and their family right now?]\n\n[Why is help needed now? What happens if the goal isn't reached?]`
                      : 'Start with their name and where they\'re from. Share what happened, how it\'s affecting them, and why they need help now.'
                  }
                  aria-invalid={!!errors.story}
                  aria-describedby="story-counter"
                />
                <div id="story-counter" className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{storyLen.toLocaleString()} / 10,000 characters</span>
                  {storyMsg.text && <span className={storyMsg.color}>{storyMsg.text}</span>}
                </div>
                {errors.story && <p className="text-sm text-red-500">{errors.story}</p>}
              </div>
            </div>
          )}

          {/* ── Step 5: Review & Submit ───────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-10">

              <div>
                <h2 className="text-2xl font-bold text-foreground">
                  Review Your Campaign
                </h2>
                <p className="mt-3 text-base text-muted-foreground">
                  Check the details below, then agree to our guidelines and submit.
                </p>
              </div>

              {/* Auth notice for unauthenticated users */}
              {!session?.user && (
                <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 dark:border-blue-900 dark:bg-blue-950/30">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <p className="text-sm leading-relaxed text-blue-800 dark:text-blue-200">
                    To publish your campaign, you&apos;ll need to sign in or create an account.
                    Your progress is saved automatically.
                  </p>
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-border bg-card">
                {/* Photo preview */}
                {form.heroImageUrl && !imagePreviewError ? (
                  <div className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={form.heroImageUrl}
                      alt=""
                      className="aspect-[3/2] w-full object-cover"
                      onError={() => setImagePreviewError(true)}
                    />
                    {form.photoCredit && (
                      <p className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                        {form.photoCredit}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        fileInputRef.current?.click();
                      }}
                      className="absolute top-2 right-2 rounded bg-black/60 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full flex-col items-center justify-center gap-2 px-6 py-10 text-center transition-colors hover:bg-accent/50"
                  >
                    <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                    </svg>
                    <p className="text-sm font-medium text-primary">Add a cover photo</p>
                  </button>
                )}
                {errors.heroImageUrl && (
                  <p className="px-6 py-2 text-sm text-red-500">{errors.heroImageUrl}</p>
                )}
                {/* YouTube video preview in review */}
                {form.youtubeUrl && (() => {
                  const videoId = extractYouTubeId(form.youtubeUrl);
                  return videoId ? (
                    <div className="border-t border-border p-6">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm text-muted-foreground">YouTube video</p>
                        <button
                          type="button"
                          onClick={() => setEditField('youtube')}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Edit
                        </button>
                      </div>
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                        title="YouTube video preview"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="aspect-video w-full rounded-lg"
                      />
                    </div>
                  ) : null;
                })()}
                {errors.youtubeUrl && (
                  <p className="px-6 py-2 text-sm text-red-500">{errors.youtubeUrl}</p>
                )}

                <div className="space-y-6 p-8">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Title</p>
                      <h3 className="mt-1 font-display text-xl font-bold text-foreground">{form.title || <span className="text-muted-foreground italic">No title</span>}</h3>
                      {errors.title && <p className="mt-1 text-sm text-red-500">{errors.title}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditField('title')}
                      className="shrink-0 text-sm font-medium text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Beneficiary</p>
                        <p className="mt-1 text-base font-medium text-foreground">
                          {form.fundraisingFor === 'yourself'
                            ? (session?.user?.name || 'You')
                            : form.subjectName}
                        </p>
                        {errors.subjectName && <p className="mt-1 text-sm text-red-500">{errors.subjectName}</p>}
                      </div>
                      {form.fundraisingFor !== 'yourself' && (
                        <button
                          type="button"
                          onClick={() => setEditField('name')}
                          className="shrink-0 text-sm font-medium text-primary hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Location</p>
                        <p className="mt-1 text-base font-medium text-foreground">{form.subjectHometown}</p>
                        {errors.subjectHometown && <p className="mt-1 text-sm text-red-500">{errors.subjectHometown}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditField('location')}
                        className="shrink-0 text-sm font-medium text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Category</p>
                        <p className="mt-1 text-base font-medium text-foreground">
                          {CATEGORIES.find((c) => c.value === form.category)?.label}
                        </p>
                        {errors.category && <p className="mt-1 text-sm text-red-500">{errors.category}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditField('category')}
                        className="shrink-0 text-sm font-medium text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Goal</p>
                        <p className="mt-1 text-base font-medium text-foreground">${goalDollars.toLocaleString()}</p>
                        {errors.goalAmount && <p className="mt-1 text-sm text-red-500">{errors.goalAmount}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditField('goal')}
                        className="shrink-0 text-sm font-medium text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    {form.fundraisingFor !== 'yourself' && (
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Relationship</p>
                          <p className="mt-1 text-base font-medium text-foreground">
                            {RELATIONS.find((r) => r.value === form.beneficiaryRelation)?.label}
                          </p>
                          {errors.beneficiaryRelation && <p className="mt-1 text-sm text-red-500">{errors.beneficiaryRelation}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditField('relationship')}
                          className="shrink-0 text-sm font-medium text-primary hover:underline"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">Story</p>
                      <button
                        type="button"
                        onClick={() => setEditField('story')}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="mt-2 max-h-60 overflow-y-auto text-base leading-relaxed text-foreground whitespace-pre-wrap">
                      {form.story}
                    </div>
                    {errors.story && <p className="mt-1 text-sm text-red-500">{errors.story}</p>}
                  </div>
                </div>
              </div>

              {/* Passive legal notice (replaces mandatory checkboxes) */}
              <div className="rounded-lg border border-border bg-muted/30 px-6 py-5">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  By clicking &ldquo;Launch fundraiser&rdquo; you agree to LastDonor&apos;s{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Privacy Policy
                  </a>
                  , and confirm that the information you&apos;ve provided is accurate.
                  LastDonor does not charge a platform fee; payment processing fees
                  (2.9%&nbsp;+&nbsp;$0.30) apply to each donation.
                </p>
                {showBeneficiaryConsent && (
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    By continuing, you confirm that{' '}
                    {form.subjectName || 'the person named above'} is aware you are creating
                    this campaign on their behalf.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border bg-muted/50 p-6">
                <p className="text-base font-semibold text-foreground">What happens next?</p>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  <li>Our editorial team reviews your campaign, typically within 24 hours</li>
                  <li>Once approved, your campaign goes live and can start accepting donations</li>
                  <li>Share your campaign link with friends, family, and social media</li>
                  <li>You&apos;ll receive an email with tips to maximize your reach</li>
                </ul>
              </div>

              {/* ── Inline Edit Modals ─────────────────────────────── */}
              {editField && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                  onClick={() => setEditField(null)}
                  onKeyDown={trapFocus}
                  role="dialog"
                  aria-modal="true"
                  aria-label={`Edit ${editField}`}
                >
                  <div
                    className={`relative mx-4 w-full rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 ${editField === 'story' ? 'max-w-2xl' : 'max-w-lg'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mb-5 flex items-center justify-between">
                      <h3 className="text-lg font-bold text-foreground">
                        {editField === 'title' && 'Edit title'}
                        {editField === 'goal' && 'Edit fundraising goal'}
                        {editField === 'story' && 'Edit story'}
                        {editField === 'youtube' && 'Edit YouTube video'}
                        {editField === 'category' && 'Edit category'}
                        {editField === 'location' && 'Edit location'}
                        {editField === 'name' && 'Edit beneficiary name'}
                        {editField === 'relationship' && 'Edit relationship'}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setEditField(null)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="Close"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* ── Title ──────────────────────────────────── */}
                    {editField === 'title' && (
                      <div className="space-y-3">
                        <Input
                          value={form.title}
                          onChange={(e) => update('title', e.target.value)}
                          maxLength={120}
                          placeholder="Campaign title"
                          className="h-12 text-base"
                          autoFocus
                        />
                        <div className="flex justify-end text-sm text-muted-foreground">
                          {form.title.trim().length} / 120
                        </div>
                      </div>
                    )}

                    {/* ── Goal ───────────────────────────────────── */}
                    {editField === 'goal' && (
                      <div className="space-y-4">
                        <div className="relative">
                          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-muted-foreground">$</span>
                          <Input
                            type="number"
                            min={1}
                            max={1_000_000_000}
                            step={1}
                            value={form.goalAmount}
                            onChange={(e) => {
                              const sanitized = e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
                              const num = parseInt(sanitized || '0', 10);
                              update('goalAmount', num > 1_000_000_000 ? '1000000000' : sanitized);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === '.' || e.key === '-' || e.key === 'e' || e.key === '+') e.preventDefault();
                            }}
                            className="h-14 pl-9 pr-20 text-lg [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            placeholder="Enter amount"
                            autoFocus
                          />
                          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            USD
                          </span>
                        </div>
                        <div className="rounded-xl border border-border bg-muted/30 p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1.5">
                              <span className="inline-block rounded border border-green-600 bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-800 dark:border-green-500 dark:bg-green-950/40 dark:text-green-300">
                                Recommended
                              </span>
                              <h4 className="text-base font-bold text-foreground">Automated goal setting</h4>
                              <p className="text-sm leading-relaxed text-muted-foreground">
                                To help build momentum, we&apos;ll gradually adjust your goal as donations come in.
                              </p>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={form.autoGoal}
                              aria-label="Automated goal setting"
                              onClick={() => update('autoGoal', !form.autoGoal)}
                              className={`relative mt-1 inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                                form.autoGoal ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
                              }`}
                            >
                              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
                                form.autoGoal ? 'translate-x-6' : 'translate-x-1'
                              }`} />
                            </button>
                          </div>
                        </div>
                        {goalDollars > 0 && form.autoGoal && (
                          <div className="flex items-center gap-2">
                            <svg className="h-5 w-5 shrink-0 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                            </svg>
                            <p className="text-sm text-muted-foreground">
                              Your starting goal would be:{' '}
                              <span className="font-bold text-foreground">${startingGoal.toLocaleString()}</span>
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Story ──────────────────────────────────── */}
                    {editField === 'story' && (
                      <div className="space-y-3">
                        <Textarea
                          value={form.story}
                          onChange={(e) => update('story', e.target.value)}
                          rows={14}
                          maxLength={10000}
                          className="text-base leading-relaxed"
                          autoFocus
                        />
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{storyLen.toLocaleString()} / 10,000 characters</span>
                          {storyMsg.text && <span className={storyMsg.color}>{storyMsg.text}</span>}
                        </div>
                      </div>
                    )}

                    {/* ── YouTube ────────────────────────────────── */}
                    {editField === 'youtube' && (
                      <div className="space-y-3">
                        <Input
                          value={form.youtubeUrl}
                          onChange={(e) => update('youtubeUrl', e.target.value)}
                          placeholder="Paste a YouTube link"
                          className="h-12 text-base"
                          autoFocus
                        />
                        {form.youtubeUrl && !extractYouTubeId(form.youtubeUrl) && (
                          <p className="text-sm text-red-500">Please enter a valid YouTube link</p>
                        )}
                        {form.youtubeUrl && (
                          <button
                            type="button"
                            onClick={() => { update('youtubeUrl', ''); setEditField(null); }}
                            className="text-sm font-medium text-red-500 hover:underline"
                          >
                            Remove video
                          </button>
                        )}
                      </div>
                    )}

                    {/* ── Category ───────────────────────────────── */}
                    {editField === 'category' && (
                      <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Campaign category">
                        {CATEGORIES.map((cat) => {
                          const selected = form.category === cat.value;
                          return (
                            <button
                              key={cat.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => { update('category', cat.value); setEditField(null); }}
                              className={`rounded-full border px-4 py-2 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                                selected
                                  ? 'border-green-600 bg-green-50 font-medium text-green-900 dark:border-green-500 dark:bg-green-950/40 dark:text-green-100'
                                  : 'border-border bg-background text-foreground hover:border-foreground/40 hover:bg-accent/50'
                              }`}
                            >
                              {cat.label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* ── Location ───────────────────────────────── */}
                    {editField === 'location' && (
                      <div className="space-y-3">
                        <Input
                          value={form.subjectHometown}
                          onChange={(e) => update('subjectHometown', e.target.value)}
                          maxLength={200}
                          placeholder="City, State (e.g. Austin, TX)"
                          className="h-12 text-base"
                          autoFocus
                        />
                      </div>
                    )}

                    {/* ── Name ───────────────────────────────────── */}
                    {editField === 'name' && (
                      <div className="space-y-3">
                        <Input
                          value={form.subjectName}
                          onChange={(e) => update('subjectName', e.target.value)}
                          maxLength={200}
                          placeholder="Their full name"
                          className="h-12 text-base"
                          autoFocus
                        />
                      </div>
                    )}

                    {/* ── Relationship ───────────────────────────── */}
                    {editField === 'relationship' && (
                      <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Relationship to beneficiary">
                        {RELATIONS.map((r) => {
                          const selected = form.beneficiaryRelation === r.value;
                          return (
                            <button
                              key={r.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => { update('beneficiaryRelation', r.value); setEditField(null); }}
                              className={`rounded-full border px-4 py-2 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                                selected
                                  ? 'border-green-600 bg-green-50 font-medium text-green-900 dark:border-green-500 dark:bg-green-950/40 dark:text-green-100'
                                  : 'border-border bg-background text-foreground hover:border-foreground/40 hover:bg-accent/50'
                              }`}
                            >
                              {r.label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* ── Save button (text inputs only) ─────────── */}
                    {['title', 'goal', 'story', 'youtube', 'location', 'name'].includes(editField) && (
                      <div className="mt-5 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            // BUG 7 fix: Validate YouTube URL before saving
                            if (editField === 'youtube' && form.youtubeUrl.trim() && !extractYouTubeId(form.youtubeUrl.trim())) {
                              return; // Error already shown inline above the button
                            }
                            setEditField(null);
                          }}
                          className="rounded-full bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hidden file input -- rendered outside step conditionals so it exists
              at all steps (Step 2 media, Step 5 review "Add/Change photo").
              BUG 1 fix: Previously only rendered inside {step === 2}. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            aria-hidden="true"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';

              const MAX_SIZE = 5 * 1024 * 1024;
              const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
              if (!ACCEPTED.includes(file.type)) {
                const { toast } = await import('sonner');
                toast.error('Please upload a JPEG, PNG, or WebP image.');
                return;
              }
              if (file.size > MAX_SIZE) {
                const { toast } = await import('sonner');
                toast.error('Image must be under 5 MB.');
                return;
              }

              // Determine if this is a hero image or a gallery image
              const isHero = !form.heroImageUrl;
              const totalImages = 1 + (form.galleryImages?.length ?? 0);
              if (!isHero && totalImages >= 5) {
                const { toast } = await import('sonner');
                toast.error('You can upload up to 5 photos total.');
                return;
              }

              // If authenticated, upload immediately for a permanent URL.
              // If not, create a local blob URL for preview and defer
              // the upload to publish time. This removes all friction from
              // the media step for unauthenticated users.
              if (session?.user) {
                const formData = new FormData();
                formData.append('file', file);
                try {
                  const res = await fetch('/api/v1/campaign-photos', {
                    method: 'POST',
                    body: formData,
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    const { toast } = await import('sonner');
                    toast.error(data.error?.message || 'Upload failed. Please try again.');
                    return;
                  }
                  if (isHero) {
                    clearBlobPreview();
                    update('heroImageUrl', data.data.url);
                  } else {
                    setForm((prev) => ({
                      ...prev,
                      galleryImages: [...(prev.galleryImages ?? []), data.data.url],
                    }));
                  }
                } catch {
                  const { toast } = await import('sonner');
                  toast.error('Upload failed. Please check your connection and try again.');
                }
              } else {
                // Unauthenticated: local preview only, upload deferred to publish
                if (isHero) {
                  setBlobPreview(file);
                } else {
                  const blobUrl = URL.createObjectURL(file);
                  galleryBlobUrlsRef.current.push(blobUrl);
                  setPendingGalleryFiles((prev) => [...prev, file]);
                  setForm((prev) => ({
                    ...prev,
                    galleryImages: [...(prev.galleryImages ?? []), blobUrl],
                  }));
                }
              }
            }}
          />
        </div>

        {/* ── Navigation ─────────────────────────────────────────────── */}
        <div className="sticky bottom-0 border-t border-border bg-stone-50 dark:bg-gray-900">
          {/* Progress bar */}
          <div className="h-1 w-full bg-border/40">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }}
              role="progressbar"
              aria-valuenow={step + 1}
              aria-valuemin={1}
              aria-valuemax={STEP_COUNT}
              aria-label={`Step ${step + 1} of ${STEP_COUNT}`}
            />
          </div>
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
            {step > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent"
                aria-label="Go back"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3">
              {step === 2 && (
                <button
                  type="button"
                  onClick={goNext}
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Skip for now
                </button>
              )}
              {step < STEP_COUNT - 1 ? (
                <Button onClick={goNext} type="button" className="rounded-full px-8">
                  Continue
                </Button>
              ) : (
                <Button onClick={handlePreviewLaunch} disabled={submitting} type="button" className="rounded-full px-8">
                  {session?.user ? 'Preview & Launch' : 'Sign in & Launch'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
