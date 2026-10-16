# 68 — The missing storage bucket, hero duplication, and the notification badge

**Date:** 2026-10-16
**Status:** Implemented

---

## 1. ⛔ Every image upload on the platform was failing

**Reported as "uploading images doesn't work". It was not a UI problem.**

### The finding

`src/lib/supabase-storage.ts` sets `BUCKET_NAME = 'media'`. Queried against
the Supabase project on 2026-10-16 with the service-role key:

```
GET /storage/v1/bucket  ->  200
  bucket: verification | public: false
```

**One bucket. No `media`.** A direct upload attempt confirmed it:

```
POST /storage/v1/object/media/campaign-photos/probe.png
  -> 400 {"statusCode":"404","error":"Bucket not found","code":"NoSuchBucket"}
```

So `supabase.storage.from('media').upload(...)` failed on **every** call, the
route logged the message and returned a generic `500 "Upload failed"`. Every
campaign hero image, every gallery photo, every impact-update photo.

### Why it stayed hidden

The route's reply is `{"code":"INTERNAL_ERROR","message":"Upload failed"}` —
indistinguishable from a transient network fault, so it reads as "try again"
rather than "this has never worked". The real reason was only ever in the
server log.

### The fix: infrastructure, not code

Created the bucket with limits that **mirror `validateFile`**, so the rule is
enforced twice and a bug in one layer cannot defeat the other:

| Setting | Value | Mirrors |
|---|---|---|
| `public` | `true` | `getPublicUrl()` is used for campaign photos |
| `file_size_limit` | 5 MiB | `MAX_FILE_SIZE` |
| `allowed_mime_types` | jpeg, png, webp, avif | `ALLOWED_TYPES` |

Verified end to end after creation:

| Check | Result |
|---|---|
| Upload a PNG | **200** |
| Read it back on the public URL | **200**, `content-type: image/png` |
| Upload `text/plain` | **400 `invalid_mime_type`** (rejected by the bucket, not just the app) |
| Delete the probe | **200** |

The private bucket needs nothing: `PRIVATE_BUCKET_NAME` defaults to
`verification`, which exists and is correctly `public: false`.

### Corrections made while diagnosing

Two things I asserted and then disproved, recorded so the reasoning is not
repeated:

- I suspected the **public `/share-your-story` page posting to an
  auth-gated endpoint**. It does, but that is deliberate: a guest gets a
  blob preview, the upload is deferred to publish time, and
  `handlePreviewLaunch` saves the draft and the pending photo before
  redirecting to login. The flow is sound.
- I read `/api/v1/user-campaigns` as unauthenticated because a grep for
  `auth(` found nothing. It uses `requireRole(['donor','editor','admin'])`.
  **Grep for the behaviour, not for one spelling of it.**

---

## 2. The hero repeated the trust bar

The hero carried three chips — "No signup to donate", "Human-reviewed
campaigns", "0% platform fees" — directly above a trust bar reading "0%
platform fee", "Human reviewed", "Impact updates". Two of three were the
same claim twice, about 80px apart.

**This was self-inflicted.** The chips predate the trust-bar rebuild in
`docs/64`, which shortened the bar's labels to almost exactly the words the
chips already used. Shortening one strip turned a loose overlap into a
visible repeat.

**The trust bar keeps them, the hero loses them.** The bar is the narrower
strip, it reads as a band of facts rather than as part of the pitch, and the
hero's subheading already carries "0% platform fees" in a sentence.

"No signup to donate" was the one claim unique to the chips. It is not lost:
step 02 of the How it works stepper says "Any card, no account needed".

---

## 3. The notification bell became a badge on the avatar

The navbar rendered `<NotificationBell />` as a second 36px button beside the
avatar. On a phone that is real estate spent on a second entry point to the
account area.

Now:

- the **unread count rides the avatar** as a badge, capped at `9+` so it
  stays a circle;
- **"Notifications"** is an item in the account menu with the exact count
  (capped at `99+`), linking to `/notifications`.

### Keeping one poller

`NotificationBell` owns a module-level store polled every 60s, ref-counted
through `_subscribe`. Removing the bell from the navbar would have left
nothing subscribed, so the count would have sat at zero forever.

A new `useUnreadNotificationCount()` hook subscribes to that same store, so
there is still exactly one poller and one piece of state whether or not the
bell is mounted anywhere.

The hook's effect **mirrors the bell's exactly**: it only *stops* polling
when the session goes away. An earlier draft also called `_startPolling` and
returned `_stopPolling` from cleanup; that was wrong, because `_subscribe`
already starts on the first subscriber and stops on the last, and the
cleanup would have fought the ref-count whenever both the hook and the bell
were mounted.

### Accessibility

The badge is `aria-hidden`, and the count is folded into the button's own
label instead: *"User menu, 3 unread notifications"*. Announcing it from
both the badge and the label is worse than announcing it once.
