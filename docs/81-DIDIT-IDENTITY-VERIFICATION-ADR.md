# 81 — Didit replaces Stripe Identity for ID verification

**Date:** 2026-10-17
**Status:** Implemented, pending deploy of the `DIDIT_API_KEY` secret.
**Supersedes:** the Stripe Identity provider choice in `src/lib/stripe-identity.ts`.
**Related:** `docs/72` (Stripe is non-functional), `docs/34` (migrations).

---

## The decision

Identity verification moves from **Stripe Identity** to **Didit**.

The deciding fact is not a feature comparison. It is `docs/72`: the Stripe
secret key on this deployment is the `sk_test_…0000` placeholder, so
**Stripe Identity cannot run at all** — the same credential gates it. The
existing verification flow was complete, well-structured, and incapable of
verifying anybody.

Didit's key was supplied and **verified working before any code was
written**.

### What was probed, and what it returned

Against the live service with this account's key, 2026-10-17:

| Call | Result |
|---|---|
| `POST /v2/session/` | `400 {"workflow_id":["This field is required."]}` |
| `POST /v1/session/` | **201**, session created |
| `GET /v1/session/<id>/decision/` | **200** |
| `GET /v1/workflows/`, `GET /v2/workflows/` | **404** |

A create returns `session_id`, `url` (the hosted page), `status`, and
echoes `vendor_data` and `callback`. The decision endpoint echoes
`vendor_data` back — **confirmed by round-tripping a value through both
calls**, because that field is the only thing tying a returning webhook to
a campaign.

Default features on v1: `OCR + LIVENESS + FACE_MATCH + IP_ANALYSIS`.

### Why v1 and not v2

v2 is the newer workflow-based API: a workflow is configured in the Didit
console and its id passed on every create. **We have no workflow id and no
endpoint to discover one**, so v2 cannot be exercised from here at all.
Writing a v2 branch would mean shipping a code path never once executed —
which is precisely the failure this codebase keeps finding (`docs/76`'s
toggle that did nothing, `docs/77`'s review that never happened).

v1 works end to end and provides the checks this product needs, so v1 is
what ships. Moving to v2 later means creating a workflow in the console,
setting `DIDIT_WORKFLOW_ID`, and probing each v2 endpoint against the live
service first — the same discipline, not an assumption that the docs are
accurate.

---

## The webhook has no shared secret, deliberately

The conventional design verifies an HMAC over the request body and then
trusts the body. That needs a secret shared with the provider, and it makes
an inbound HTTP body the input to a state change about somebody's identity.

`POST /api/v1/verification/didit/webhook` does neither. It reads **one**
value from the body — a session id — and then calls Didit's decision
endpoint **with our own API key** to ask what the status actually is.

What that buys:

- **No secret to configure, rotate, or leave unset.** The failure mode
  where an unset secret silently disables verification cannot occur. Given
  this session has already found an unset `MAILING_POSTAL_ADDRESS`, a
  placeholder Stripe key and a missing storage bucket, removing a
  configuration dependency is worth more than the elegance of an HMAC.
- **A forged request cannot assert an outcome.** The worst an attacker
  achieves by posting a real session id is making us re-read a decision we
  are entitled to read, and reach the same answer.
- A session id that is not ours, or unknown to Didit, changes nothing.

Cost: one extra outbound call per webhook. For an event that fires a
handful of times per verification, that is the right trade.

The route returns **200 for anything it declines to act on**. A 4xx invites
the provider to retry, and retrying will not turn an unknown session id
into a known one. A failed *decision read* does return 5xx, because that
one is worth retrying.

---

## "In Review" is not a pass

Didit's status vocabulary includes `In Review` — **their manual queue**, in
which a human has not finished. `mapDiditStatus` sends it to `pending`,
alongside `Not Started`, `In Progress`, `Abandoned` and `Expired`. Only
`Approved` and `Declined` move our state.

This is the same mistake `docs/77` found in a different costume: treating
an unfinished review as a completed one. A test names it explicitly.

---

## Schema

Two additive columns, `didit_session_id` and `didit_session_url`, plus a
unique index — `src/db/migrations-v2/0002_fixed_blindfold.sql`, generated
by `db:generate` into `migrations-v2/` per `docs/34`.

**The Stripe columns are kept, not dropped.** They hold the only record of
any verification started under the old provider, and dropping a column to
tidy up is how history is lost.

---

## What is unchanged

The route shape, the ownership check (`creatorId === session.user.id`), the
allowed-status list, the `force` flag for re-issuing a session, the
`verification_status` enum, and the approval/rejection emails. Only the
provider performing the check changed. That is what made this a contained
swap rather than a rebuild.

A `VERIFICATION_UNAVAILABLE` code was added (503, like
`PAYMENTS_UNAVAILABLE` in `docs/72`): a missing key or an unreachable
provider is unavailability, and the person is told it is our side and not
their documents.

---

## Operator notes

- `DIDIT_API_KEY` is staged as a Fly secret and applies on the next deploy.
- The webhook URL to register in the Didit console is
  **`https://lastdonor.org/api/v1/verification/didit/webhook`**. It is
  listed in `PUBLIC_API_ROUTES` with the reasoning above, since
  `src/middleware.ts` is default-deny.
- Three throwaway sessions were created against the live account while
  probing the API. They are unused and sit at `Not Started`.
- Nothing reads `DIDIT_WORKFLOW_ID` yet; it is named here only so the v2
  path has an agreed name when someone takes it.
