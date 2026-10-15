# 39 - Registration page: closing the client-side enumeration oracle

**Date:** 2026-10-15
**Status:** Implemented
**Touches:** `src/app/register/page.tsx`, `src/app/api/auth/register/route.ts`,
`src/lib/notifications.ts`, `src/lib/email-templates.ts`
**Related:** docs/29 (audit A4), docs/32 (login oracle), commit `9a14dc6`
(server-side register fix), commit `224e069` (mail consent / CAN-SPAM)

---

## 1. The problem

`9a14dc6` made `POST /api/auth/register` answer a duplicate address with the
**same status (201) and the same body shape** as a real creation, and spend the
same bcrypt work, so that one HTTP request per address could no longer tell an
anonymous caller whether a named person has an account here. On a platform that
publishes medical and hardship appeals, "has an account here" is itself
sensitive information about an identifiable individual.

**The client defeated that fix.** `src/app/register/page.tsx` auto-signed-in
after the 201 and branched on the result (**verified** by reading the
pre-change file, lines 108-123):

| | Address was free | Address already registered |
|---|---|---|
| API response | 201, `{ok:true,data:{id,email,name}}` | identical |
| `signIn('credentials')` | succeeds | fails (`authorize()` rejects the junk password) |
| Navigation | `router.push(callbackUrl)` -> `/dashboard` | `router.push('/login?callbackUrl=...')` |
| Screen reached | dashboard | login form |
| Session cookie | set | not set |

So the attack was: submit `victim@example.com` with a junk password, read which
screen you land on. Same oracle the route had just given up, one request later.
The route's own header comment named this residual gap and assigned it to the
page.

## 2. Decision

1. **Auto-sign-in after registration is removed.** The page no longer calls
   `signIn('credentials')`, no longer navigates, and no longer has any branch
   downstream of the 201.
2. **Both outcomes reach one terminal screen** rendered in place: "Check your
   email", the submitted address echoed back, a fixed "Go to sign-in" link
   whose target is derived from the page URL (never from the response), and a
   password-reset link. Fixed copy plus the address the visitor typed, so the
   markup is byte-identical for both outcomes.
3. **The distinguishing information moves to the inbox.** Both branches of the
   route now send exactly one transactional email to the submitted address via
   `notifyRegistrationOutcome` (`src/lib/notifications.ts`):
   - created -> "Your LastDonor.org account is ready", with a sign-in link;
   - already registered -> "You already have a LastDonor.org account": nothing
     was created or changed, sign in, or reset your password.

   Only whoever can open that inbox learns which happened.
4. **Validation errors stay specific.** A 400 (malformed address, weak
   password, breached password) is still rendered verbatim in the `role="alert"`
   box. Those describe the caller's own input, not the state of someone else's
   account, so collapsing them would cost usability and buy nothing.

### Why the mail is not gated on a notification preference

`notifyRegistrationOutcome` deliberately uses `sendEmailOnly`, not
`createAndEmail`:

- `createAndEmail` INSERTs a notification row. On the duplicate path that would
  write to an account the caller does not control, from an unauthenticated
  endpoint, and would make the two paths differ by one INSERT.
- `createAndEmail` checks the `emailNotifications` preference. This is
  transactional auth mail: one is the receipt for an account just created, the
  other is a security notice about an attempt on an existing account. Neither
  is commercial mail (**verified**: 15 U.S.C. 7702(2)(B) exempts transactional
  or relationship messages; the List-Unsubscribe / postal-address machinery
  added in `224e069` is for bulk and newsletter sends). A user who has switched
  notification email off must still be told their address was used to sign up.

The duplicate-path email **carries no token**. It links to the existing
`/login/forgot-password` flow, which mints its own token for the owner. So an
attacker spamming the form cannot mail a credential to a victim - only a
notice. (Mailing a *notice* to an address on demand is already possible via
`forgot-password`; both endpoints sit behind the middleware rate limiter.)

## 3. Rejected alternatives

- **Keep auto-sign-in, branch "nicely".** Any branch on the sign-in result *is*
  the oracle, however it is dressed up. Rejected outright.
- **Keep auto-sign-in, ignore the result, always render the same screen.** The
  page output would match, but the session cookie would be set in one case
  only, so the next navigation (or the "Go to sign-in" click) still answers the
  question. It also tells a user who is already signed in to go check their
  email. Rejected: it hides the oracle rather than removing it.
- **Always redirect to `callbackUrl`.** `/dashboard` is middleware-protected,
  so the unauthenticated case bounces to `/login` and the redirect chain is the
  oracle again.
- **Mint a password-reset token and mail it on the duplicate path** (the
  "here's a sign-in link" shape). Rejected: it turns an unauthenticated
  endpoint into a credential-minting lever aimed at a third party, and adds a
  DELETE + INSERT that the creation path does not have, which is a timing and
  write-amplification asymmetry. A notice plus the existing reset flow gets the
  owner back in without either.
- **Defer account creation until the address is confirmed** (true double
  opt-in). This is the only option that also closes the residual leak in §5,
  and is the right long-term answer, but it changes the route's contract, needs
  a pending-registration store and a confirmation route, and was out of scope
  here. Recommended as follow-up.
- **Add a "does this email exist" endpoint for inline form feedback.** That is
  the oracle as a feature. Never.

## 4. Trade-off accepted

**A genuinely new user is no longer signed in by registering.** They land on
"Check your email" and sign in with the password they chose seconds earlier,
via the button on that screen or the link in the welcome email: one extra step,
roughly one extra form submission, on a once-per-account flow.

That is a real conversion cost on the funnel the register page copy is tuned
for ("Takes under 30 seconds"). It is accepted because the alternative is a
one-request probe that reveals whether a named person has an account on a
hardship-appeal platform, to anyone, at scale. The screen is not a dead end:
the sign-in link is always present and always points at the same place, so the
real user is never stranded whether or not the email arrives.

**Assumed, not measured:** the size of the drop-off from the extra step. There
is no funnel instrumentation on this page today. If it is ever measured and
judged material, the fix is double opt-in (§3), not restoring the branch.

## 5. Residual leak, NOT closed

**The inherent login oracle survives, and no page-level change can close it.**
The route creates the account on POST with the password the caller supplied.
So:

1. POST `/api/auth/register` with `victim@example.com` and a junk password.
2. Then sign in at `/login` with that same address and junk password.
3. **Success** -> the address was free (the attacker just created that account).
   **Failure** -> the address was already registered.

`authorize()` is uniform (docs/32) and leaks nothing by itself; the information
comes from the attacker's own knowledge of what they just submitted. One extra
request over the original attack, and it works regardless of what the register
page renders.

Closing it requires the address to be confirmed before any account exists -
double opt-in, per §3. Until then, registration enumeration is **mitigated at
one request and raised in cost, not eliminated**. Recorded here so it is not
mistaken for closed.

Secondary, accepted: the two code paths are not bit-identical in timing. The
creation path does one INSERT the duplicate path does not; both now pay one
email send, and both already paid the unconditional bcrypt hash (12 rounds) and
the HIBP range lookup, which dominate. **Assumed** (not measured) that the
INSERT delta stays far inside the noise of those two.

## 6. Tests

- `src/app/register/page.test.tsx` (new, 12 tests): drives the real page
  against the two 201 bodies the route can actually return (they differ only in
  `data.id`, randomised on the duplicate path) and asserts the rendered
  `innerHTML` and `textContent` are equal; that `router.push/replace/refresh`
  are never called; that `signIn` is never called; that exactly one request is
  made and the request lists are equal; that neither id is rendered. Plus the
  error paths: zod-rejected address, weak password (per-rule checklist), a
  server 400 rendered verbatim, and the generic fallback.
- `src/lib/auth.enumeration.test.ts` (extended): two tests that the send is
  symmetric (exactly one message to the submitted address on each path) and
  that the duplicate-path mail says "already have an account" while carrying no
  token. `@/lib/resend` is now mocked in that suite, as in every other suite
  that reaches it: without a key the real client throws and `retryWithBackoff`
  slept through three attempts per registration test (**verified**: suite went
  13.9s -> 0.8s).

**Verified 2026-10-15:** `npm run typecheck` clean; `next lint` clean on every
file changed here; `src/app/register/page.test.tsx` 12/12 and
`src/lib/auth.enumeration.test.ts` 47/47 pass.
