# 109 — Submitting a campaign sent the organiser to a 404

**Date:** 2026-10-25
**Status:** FIXED.
**Reported from production** by the owner, with a screenshot of
`lastdonor.org/campaigns/help-john-recover-after-a-car-accident?launched=true`
rendering **404 Page Not Found**.
**Read before:** touching the create-campaign redirect, `LaunchSuccessBanner`,
or anything in `src/lib/validators/instant-live-architecture.test.ts`.

---

## 1. What was wrong

Finishing the create-campaign wizard redirected to
`/campaigns/<slug>?launched=true`. The organiser got a **404**, and no
confirmation that anything had been received at all. The owner's words:
*"submitting a page for review gives no feedback and directs to this page."*

Both halves are the same defect. The redirect *was* the feedback, and it
landed nowhere.

## 2. Why, and nothing threw

`ShareYourStoryForm.tsx` carried this, with a comment still describing the
product as it was two gates ago:

```tsx
// Redirect to the live campaign page so the organizer sees exactly
// what donors see. The ?launched=true param triggers a success banner
router.push(`/campaigns/${slug}?launched=true`);
```

That was correct when campaigns went live instantly. `docs/78` and `docs/79`
made every campaign wait for a person:

- `POST /api/v1/user-campaigns` inserts `status: 'under_review'` with
  `published_at: null`.
- `getCampaign` in `src/app/campaigns/[slug]/page.tsx` serves exactly
  `active`, `last_donor_zone`, `completed`, `paused`, `suspended`,
  `cancelled` — **not `under_review`, not `draft`**.

So the lookup resolved `missing`, which is the one correct basis for a 404
(`docs/43`), and the page did precisely what it should. **Nothing failed.** A
redirect stopped being valid as a side effect of work in another file — the
same shape as `docs/83`, where the Didit verification flow worked and its only
link had quietly become unreachable.

Both ends were individually right. Only the line between them was stale.

## 3. ⚠️ A test was holding it in place

`src/lib/validators/instant-live-architecture.test.ts` — a 770-line file named
after the superseded architecture — asserted:

```ts
it('redirects to campaign page after submission', () => {
  expect(formSource).toContain('?launched=true');
});
it('does not say "Submitted for Review"', () => { ... });
```

It passed for the entire time the flow was broken, because it reads source
**text** and the source still carried the old redirect.

The file is not uniformly stale, which is the interesting part: **section 5
had already been reconciled** to the review gate and asserts the route does
*not* insert `status: 'active'`. So the same file asserted both halves of a
contradiction — campaigns are not instant-live, and the form must redirect as
though they were — and nothing noticed, because no test compares two
assertions to each other.

Section 9 is now rewritten. Sections 1–8 and 10 were checked and left alone.

## 4. The fix

**The redirect goes to `/dashboard/campaigns?submitted=1`** — the organiser's
own list, where the campaign actually is, under an "Under Review" badge, beside
the `VerificationRow` that `docs/83` put on every campaign in every state.

`SubmittedForReviewNotice` renders the confirmation there.

### 4.1 What the confirmation is allowed to say

⛔ **Not "we will email you when it is decided."** `docs/93` deleted exactly
that sentence from the submission receipt, because a **refused** campaign
notifies nobody: `under_review` transitions only to `active` or `suspended`,
and the suspend path reaches `notifyCampaignStatusChange`, which returns early
for anything outside `['completed','archived']` and addresses *donors* — of
which an unpublished campaign has none. That is **still open**. Writing the
promise on this screen would re-introduce the thing that doc removed.

⛔ **No turnaround time**, per `docs/78`, which quotes none anywhere.

What it does say is what is true and nothing more: a person reads every
campaign, it is not public yet, a receipt has been emailed, and *if it is
approved* a second email carries the link. Refusal is left unaddressed rather
than described falsely.

Four assertions in `submit-redirect.test.ts` pin each of those prohibitions
against the copy, because this is the kind of reassurance that grows a
comforting sentence the next time somebody edits it.

### 4.2 `LaunchSuccessBanner` moved rather than died

The banner says **"Your campaign is live"**, offers *"Make the first
donation"*, and shows share buttons. Every word of that is false for a
campaign waiting on review — so even if the page had rendered, the banner
would have lied.

Changing the redirect would have left it unreachable: `?launched=true` had
exactly one producer and one consumer. Rather than delete a component whose
words are *true at a different moment*, the flag moved to the one place that
moment exists — the **approval** email's CTA (`welcomeCampaignerEmail`, fired
from the admin approval route per `docs/78`). The banner now renders when the
campaign really is live, for the person who just got told so.

A URL change, not a copy change, so the `docs/94` readability and `docs/67`
dark-mode ratchets are unaffected — confirmed, 39 email tests green.

## 5. The check that replaces the one that failed

`src/app/share-your-story/submit-redirect.test.ts`.

The obvious test — "the form redirects to `/dashboard/campaigns`" — would be
exactly as stale as the one it replaces the day the review gate is
reconsidered. The old assertion is the proof that pinning today's answer does
not work.

So this one **derives both ends from source** and only then decides what the
redirect may be:

1. read the status the creation route actually inserts (`under_review`);
2. read the statuses the campaign page actually serves;
3. **only if** the inserted status is absent from that set, forbid redirecting
   to `/campaigns/<slug>`.

It stays correct in both directions. Proven by injection, both ways:

| injected | result |
|---|---|
| the exact production redirect restored | **6 tests fail** across the two files |
| instant-live restored on **both** ends (route inserts `active` *and* the old redirect) | the conditional rule **passes** — it is a rule, not a ban |

It also checks that the redirect target has a `page.tsx`, that the query
param it carries is the one the landing component reads, and that nothing on
the submission path emits `launched=true` any more.

Two defects in the test itself were caught while writing it and are worth
recording, because both would have made it pass for the wrong reason:

- It took the **first** `router.push` in the form, which is the sign-out
  bounce to `/login` — so it was reading the login page. It now takes the
  last, and asserts that one is not the login bounce.
- It matched copy against raw JSX, where a sentence wraps across lines and
  two levels of indentation. Whitespace is collapsed first; otherwise every
  copy assertion silently depended on where the line happened to break.

## 5a. A second door to the same 404, found by opening a browser

Verifying the fix meant looking at `/dashboard/campaigns`, and the campaign row
there carries a **"View"** button. It linked to `/campaigns/<slug>` for every
campaign in **every** status — so an organiser with a campaign still in the
queue clicked "View" on their own dashboard and got the same 404 the wizard had
just stopped giving them.

The same mistake twice: a link to the public page written without reference to
what that page serves. So the answer now lives in one place,
`src/lib/campaign-visibility.ts`:

```ts
export const PUBLICLY_VIEWABLE_STATUSES = [
  'active', 'last_donor_zone', 'completed', 'paused', 'suspended', 'cancelled',
] as const;
```

⚠️ `suspended` and `cancelled` belong there. The page serves them and renders
an explanatory notice — a donor following an old link deserves to be told what
happened, not that the appeal never existed.

`hasPublicPage()` **fails toward hiding the link**: an unknown status answers
false, because a missing button is a lost convenience and a shown one that
404s is the platform handing someone a dead page for their own appeal.

`campaign-visibility.test.ts` parses the page's own `getCampaign` filter and
asserts the constant equals it, so a second copy of the list cannot drift —
which is how this happened in the first place. It also reads
`CampaignsListClient` as text, because an unconditional `<Link>` compiles
perfectly and the type system would never notice the guard being removed.
Proven by injection: replacing the guard with `true` fails two tests.

⚠️ The campaign page still builds its filter inline rather than importing the
constant. That is deliberate for now — rewriting the query that gates the whole
public page is a bigger change than this one, and the parsing test gives the
same guarantee without touching it. If that query is ever refactored to use the
constant, delete the parsing half rather than leave it asserting that the
constant equals itself.

## 6. What this does not fix

- ⛔ **A refused campaign still notifies nobody** (`docs/93`, still open). The
  confirmation is careful not to imply otherwise, which is a mitigation, not a
  fix. It remains an owner decision: what should happen to a refused campaign.
- The wizard is not re-verified end to end by an automated test. `docs/99`
  records that the E2E suite has no signed-in fixture (ten tests skipped for
  it), and that gap is what let a six-screen flow end in a 404 unobserved. The
  landing half was verified in a real browser for this change; the six screens
  before it were not.
- The campaign page's own status filter is still a separate inline list
  (§5a).
