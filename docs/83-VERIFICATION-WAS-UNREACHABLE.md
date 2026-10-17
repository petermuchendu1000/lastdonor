# 83 — The verification flow worked and nobody could reach it

**Date:** 2026-10-17
**Status:** Fixed
**Follows:** `docs/81` (Didit), and is a consequence of `docs/72` and `docs/79`.

---

## The question that found it

> "where exactly is the user verifying? I cant see it anywhere"

Everything below the surface was fine. `docs/81` swapped Stripe Identity
for Didit, the route works, the webhook works, the client is tested against
probed responses. `/dashboard/campaigns/[id]/verification` renders
`CampaignVerificationDashboard`, which calls
`POST /api/v1/verification/identity/session` and opens Didit's hosted page.

**Nothing linked to it.**

The only entry point was the "urgent actions" banner on `/dashboard`:

```ts
const needsVerification = myCampaigns.filter(
  (c) =>
    (c.status === 'active' || c.status === 'last_donor_zone') &&
    c.donorCount > 0 &&
    (c.verificationStatus === 'unverified' || c.verificationStatus === 'info_requested'),
);
```

Three conditions, and **two of them are now unsatisfiable**:

| Condition | Why it can never be true |
|---|---|
| `status === 'active'` | `docs/79` gated both creation paths; every campaign is `under_review` until an admin approves, and all 12 that were live were moved into the queue. **Zero active campaigns.** |
| `donorCount > 0` | `docs/72`: `STRIPE_SECRET_KEY` is a placeholder, `create-checkout` 500s, and `donations` has **zero rows, ever**. No campaign can acquire a donor. |

So the banner could not render, and the verification page was reachable
only by typing the URL.

Neither condition was wrong when it was written. Each became impossible
because of a later change — one of them mine, yesterday. **Nothing failed.
No test broke, no error was logged, no page 500'd.** A route simply stopped
being reachable, silently, as a side effect of work in a different file.

---

## Why I did not catch it

I verified the provider, the route, the webhook, the status mapping and the
schema. I never asked **what a person clicks**.

That is the same omission in a new place. `docs/76` found a toggle wired to
nothing, `docs/77` found a review that never ran, `docs/81` refused to ship
a provider branch that could not be executed — and then shipped an
integration whose entry point could not be reached. Verifying that code
runs is not the same as verifying that someone can get to it.

**The check to add to the habit: trace the path from a signed-in person to
the feature, through the UI, before calling an integration done.**

---

## The fix

`src/components/dashboard/VerificationRow.tsx`, rendered on **every**
campaign row in the dashboard, in **every** state. Status in plain words
plus a link, with no precondition on donors, funding or approval.

The urgent banner stays exactly as it was. It is the right escalation —
chasing somebody to prove their identity before a single person has donated
is noise. What was wrong was that it was the only door, not that it exists.

### Deliberate details

- **An unrecognised status still renders a link.** A new
  `verification_status` value shows as itself (`some_future_state`) with
  the action intact, rather than falling through to nothing. Silently
  removing the organiser's only route to verification is precisely the
  failure this component exists to fix; it must not be able to reintroduce
  it.
- **`fully_verified` and `verified` show no action**, because there is
  nothing left to do.
- **`rejected` is not dressed up.** It reads "Verification did not pass",
  not a softer synonym, and a test asserts it never renders as verified.
- **`ReviewedIcon`, not a shield** (`docs/70`): a shield claims
  "protected", and nothing here protects anybody. The brand mark means "a
  person read this", which is what verification is.

24 tests, driving every enum value.

---

## Still true after this

Verification can now be *started* by any organiser. It cannot yet be
*completed end to end in production* for a reason outside this document:
`DIDIT_API_KEY` is staged as a Fly secret and the hosted flow has not been
walked by a real person. The route answers `VERIFICATION_UNAVAILABLE` (503)
rather than failing obscurely if the key is missing.
