# 40 - Campaign-update unsubscribe links: one token owner, honest fallback

**Date:** 2026-10-15
**Status:** Accepted, implemented in the same commit
**Supersedes:** nothing. **Amends:** the handover note in
`src/app/api/v1/campaigns/[slug]/subscribe/route.ts` and the "do not unify"
paragraph in the header of `src/lib/unsubscribe-tokens.ts`.
**Related:** `docs/29` (audit P1-6), `docs/31` item 2.7, `docs/32`.

---

## 1. The defect

**Verified 2026-10-15 by reading the code and by the tests listed in §6.**

Campaign-update emails carried a footer link of the form

```
${BASE_URL}/unsubscribe?email=<donorEmail>&campaign=<campaignSlug>
```

built at two sites in `src/lib/email-adaptive.ts` (`creatorThankYouUpdateEmail`,
`campaignUpdateDigestEmail`). It carried **no token**.
`src/app/unsubscribe/client.tsx` read only `email` and `campaign` and sent
`DELETE /api/v1/campaigns/<slug>/subscribe` with `{ email }`. That route has
authorised on `verifyCampaignUnsubscribeToken(...) || sessionEmail() === email`
since the P1-6 fix.

So: a donor who clicked unsubscribe in their mail got **403** unless they
happened to be signed in as that address. The one-click path, which is the only
path that matters for an emailed opt-out, was dead for every link already in an
inbox.

A non-functioning unsubscribe in commercial mail is a CAN-SPAM problem
(16 CFR 316.5; opt-out mechanism must be functional for 30 days after sending)
and a GDPR Art. 7(3) problem (withdrawal must be as easy as giving consent).
**Assumed, not legal advice:** the statutory citations are the same ones already
relied on in the route's own comments and in `src/lib/unsubscribe-tokens.ts`;
they are not re-verified here.

### Root cause

The verifier was **private to the route**, so no send site could mint what the
route demanded without copying crypto. The duplication-by-necessity that
`docs/32` already identified for the newsletter token produced, here, a worse
outcome than duplication: the send site simply shipped no token at all.

---

## 2. Decision

1. **`src/lib/unsubscribe-tokens.ts` owns both unsubscribe token formats.**
   The campaign mint (`createCampaignUnsubscribeToken`) and verify
   (`verifyCampaignUnsubscribeToken`) moved there; the route imports the
   verifier and its private copy is deleted.

2. **The wire format did not change.** Same version string
   `campaign-unsubscribe:v1`, same signed input
   `campaign-unsubscribe:v1:<campaignId>:<normalised email>`, same secret
   resolution (`CAMPAIGN_UNSUBSCRIBE_SECRET?.trim() ||
   NEWSLETTER_UNSUBSCRIBE_SECRET?.trim() || null`), same hex digest, same
   timing-safe compare, same fail-closed-on-missing-secret. **Verified**: a test
   asserts the module mints byte-identical output to the deleted route-local
   minter.

3. **The two formats stay distinct.** Co-locating the code is not unifying the
   formats. The newsletter token is `<subscriberId>.<hmac>`; the campaign token
   is a bare digest over a purpose-and-version-prefixed message. Neither
   verifier accepts the other's tokens, and that domain separation is what makes
   sharing `NEWSLETTER_UNSUBSCRIBE_SECRET` as the campaign fallback safe. The
   previous header comment's warning against unifying the formats stands; only
   its claim about *where the campaign code lives* is amended.

4. **`campaignId` is passed into the email templates.** The token signs over the
   campaign UUID, but the footer only had the slug in scope. `campaignId` was
   added to both template payload types and is supplied by
   `src/lib/notifications.ts`, which already held it. The email layer does
   **not** look the id up: templates stay pure string builders with no DB
   access.

5. **Without a secret, the footer emits a `mailto:` to `SUPPORT_MAILBOX`,
   subject naming the campaign slug** - never a tokenless `/unsubscribe` link.
   Minting never throws at a send site.

6. **The page forwards `token` in the JSON body** of the DELETE (the route's
   `readToken` accepts query or body; the body is where `email` already
   travels). A link with no token is still attempted, because the session path
   must keep working for old links, and a failure now offers the support
   mailbox instead of a bare error.

---

## 3. Rejected alternatives

| Rejected | Why |
|---|---|
| **Sign over `campaignSlug` instead of `campaignId`** | Changes the wire format, breaking the route's existing tests and any token minted after the change, for no gain. Slugs are also mutable; a renamed campaign would void every outstanding link. |
| **Look the campaign id up inside the email template** | Puts a DB round trip into a pure string builder, once per recipient, inside the per-subscriber loop. The caller already has the id. |
| **Fabricate or default the id (e.g. empty string) when absent** | Would mint a signature that verifies against nothing: the 403 again, but silent. `campaignId` is therefore required, not optional, so the type checker finds every caller. |
| **Drop the token and authorise the email-link flow some other way** (e.g. a one-time code, or re-opening DELETE to anonymous callers) | Re-opens audit P1-6: anonymous third-party unsubscribe. Single-use codes need redemption state, i.e. a migration. |
| **Emit the tokenless link and let the page tell the donor to sign in** | Puts a login between a donor and their opt-out. That is the GDPR Art. 7(3) failure mode, not a fix for it. |
| **Emit a tokenless link when the secret is unset** | A link that promises one-click unsubscribe and 403s is worse than an honest mailto: the donor believes they have opted out. |
| **Advertise RFC 8058 `List-Unsubscribe-Post` for the signed link** | `/unsubscribe` is a browser page that needs JavaScript to issue the DELETE. It is not a POST-able endpoint, so `campaignUnsubscribeMechanism` returns `oneClick: false` for both branches. |
| **Treat a missing `token` as `missing-params` in the page** | Breaks old links for signed-in donors, who can still unsubscribe through the session path. |
| **Unify the two token formats while moving the code** | Orphans every campaign token in flight and every newsletter link in an inbox, to save one function. See §2.3. |

---

## 4. Trade-offs accepted

- **The mailto fallback is manual.** If no secret is configured, opt-outs arrive
  as email a human must action. That is a real operational cost, accepted
  because the alternative is a link that lies. The signed path is the normal
  path: both secrets are already in `src/lib/validate-secrets.ts`.
- **Campaign tokens remain non-expiring and replayable.** Unchanged, and
  deliberate for the same reasons already documented on both routes: an
  unsubscribe link that stops working is itself the defect, and redemption
  state needs a migration. Replay is harmless - the operation is idempotent,
  terminal, and grants nothing else.
- **`mailtoUnsubscribeMechanism` grew an optional `subject` argument.**
  Backward compatible; the newsletter callers keep `?subject=Unsubscribe`.
- **Links already in inboxes stay dead.** Nothing can retroactively add a token
  to mail already delivered. Those donors land on the error state, which now
  names the support mailbox. Only mail sent from this change onward carries a
  working one-click link.

---

## 5. Files changed

| File | Change |
|---|---|
| `src/lib/unsubscribe-tokens.ts` | Owns both formats. Added `CAMPAIGN_TOKEN_VERSION`, `campaignUnsubscribeSecret`, `createCampaignUnsubscribeToken`, `tryCreateCampaignUnsubscribeToken`, `verifyCampaignUnsubscribeToken`, `campaignUnsubscribeUrl`, `campaignUnsubscribeMechanism`, `normalizeUnsubscribeEmail`; optional `subject` on `mailtoUnsubscribeMechanism`; header rewritten. |
| `src/app/api/v1/campaigns/[slug]/subscribe/route.ts` | Imports the verifier; private `TOKEN_VERSION`, `hexEquals`, `unsubscribeSecret`, `verifyCampaignUnsubscribeToken` deleted; handover note replaced with the current state. |
| `src/lib/email-adaptive.ts` | `campaignUnsubscribeFooter` helper; `campaignId` added to the two campaign-update payload types. |
| `src/lib/notifications.ts` | Passes `campaignId` into both templates. |
| `src/app/unsubscribe/client.tsx` | Reads and forwards `token`; support mailbox in the error and invalid-link states. |

---

## 6. Verification

**Verified 2026-10-15**, local Vitest, output recorded in the change's report:

- `src/lib/unsubscribe-tokens.test.ts` (80 tests) - campaign mint/verify round
  trip; no verification for a different campaign or a different email; tampered
  signature, foreign secret and rotated secret rejected; fail-closed with no
  secret; secret precedence and trimming; link construction and email
  normalisation; mailto fallback; byte-identity with the deleted route-local
  minter; cross-kind rejection against newsletter tokens.
- `src/app/api/v1/campaigns/[slug]/subscribe/route.test.ts` (20 tests) - a
  DELETE carrying a module-minted token succeeds with **no session**; the same
  request with the token stripped still 403s; a footer-link token for another
  campaign 403s.
- `src/lib/email-adaptive.campaign-unsubscribe.test.ts` (22 tests) - both
  footers carry a token that verifies for (campaignId, donor email) and for
  nothing else; no tokenless `/unsubscribe` link is ever emitted; mailto
  fallback with no secret.
- `src/app/unsubscribe/client.test.tsx` (8 tests) - the token is forwarded; a
  tokenless link is still attempted; dead ends offer the support mailbox.

### Not fixed here

`donorReengagementEmail` and the shared `wrap()` footer in
`src/lib/email-adaptive.ts` / `src/lib/email-templates.ts` offer only
`${BASE_URL}/settings` ("Manage notification preferences"), which is
login-gated. That is a *different* gap from this defect: not a link that 403s,
but marketing mail with no one-click opt-out at all, and it is not
campaign-scoped so the campaign token does not apply to it.
**Verified 2026-10-15:** `notifyDonorReengagement` has no caller anywhere in
`src/`, so no such mail is currently sent. Deciding the opt-out mechanism for
platform-level donor mail needs its own decision and its own doc.
