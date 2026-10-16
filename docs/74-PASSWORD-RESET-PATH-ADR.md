# 74 — The password reset path: tested end to end, and the two silent branches

**Date:** 2026-10-16
**Status:** Implemented
**Amends:** `docs/67` (two templates it missed), `docs/39` (extends the same
both-branches pattern to reset), `docs/32` (the enumeration constraint is
preserved, not reopened).

---

## The test that prompted all of this

Run against **production**, 2026-10-16, with a throwaway account at
`delivered@resend.dev` (Resend's always-accepts test address, so no real
person received anything). The account was deleted afterwards and the
`users` count is back to 5.

| Step | Result |
|---|---|
| `POST /api/auth/register` | **201** |
| → "Your LastDonor.org account is ready" | **delivered** (23:04:01Z) |
| `POST /api/v1/auth/forgot-password` | **200** |
| → "Reset Your Password - LastDonor.org" | **delivered** (23:04:06Z, 5s later) |
| Token row created, 1h TTL | yes, `still_valid: true` |
| `GET /login/reset-password?token=…&email=…` | **200** |
| `POST /api/v1/auth/reset-password` | **200**, "Password has been reset successfully" |
| Token row after use | **0 rows** — consumed |
| Replay of the same token | **400** "Invalid or expired reset link" |
| `password_hash` after reset | 60-char bcrypt, changed |

**The whole path works.** Send, delivery, link, consumption, single-use
enforcement.

---

## So why could the owner not get one?

Because neither of their addresses can produce a reset email, and the route
told them nothing either way.

```sql
select email, (password_hash is not null) as has_password from users
 where email ilike '%cosialm%';
-- cosialm22@gmail.com | false     ← Google sign-in, no password
-- (cosialm@gmail.com)             ← no row at all
```

`forgot-password` returned early on both:

```ts
// Only send if user exists and has a password (not OAuth-only)
if (!user?.passwordHash) {
  return successResponse;          // ...and send nothing
}
```

and answered, on both:

> "If an account with that email exists, a password reset link has been sent."

Which was **not true of any inbox**. The response was written to protect
against enumeration (`docs/32`) and it does that correctly — but protecting
the response was treated as licence to send nothing, and those are different
things.

### Who this failed hardest

A real account holder who signed up with Google, forgot *how* they signed
up, and clicked "forgot password". They got silence. Not an error, not an
explanation — silence, every time, with no path out of it except guessing.
That is the single worst state an auth flow can leave a legitimate user in,
and this one could stay in it forever.

---

## What changed: three outcomes, three emails, one response

`POST /api/v1/auth/forgot-password` now always sends exactly one email:

| Branch | Email | Says |
|---|---|---|
| has a password | `passwordResetEmail` | the reset link, one use, one hour |
| no account | `passwordResetNoAccountEmail` | there is no account here; create one |
| provider only | `passwordResetOauthOnlyEmail` | you sign in with **Google**; here is the sign-in button |

**This is exactly the shape `/register` already uses** (`docs/39`): identical
HTTP response on every branch, with the truth delivered only to whoever owns
the mailbox.

### The enumeration oracle stays closed

Rejected alternative: **report the OAuth case in the HTTP response.** It is
the obvious fix and it reopens the oracle `docs/32` closed — anyone could
then probe addresses and learn which have accounts and which use Google. The
whole point of the email channel is that it answers only the one party
entitled to the answer.

Three things keep it shut, and a test asserts each:

1. The response body and status are **byte-for-byte identical** on all three
   branches (asserted by comparing the actual responses, not by inspection).
2. The body names no branch — no "google", no "not found".
3. The call shape is identical on all three — one `sendEmailOnly`, no extra
   round trip — so **response time does not encode the outcome** either.

The provider lookup on the OAuth branch is one extra `select`, which is the
one asymmetry. It is a single indexed read on a path that already does one,
and it runs before the send, whose network latency dominates it by orders of
magnitude. Noted rather than hidden.

### Why the provider is named in the email

"You have no password" is useless; "you sign in with Google" is the entire
answer. The recipient already owns the mailbox, so naming it discloses
nothing they could not discover by trying to sign in.

---

## The second finding: two templates never got the docs/67 shell

`docs/67` moved **44** templates onto one email shell. Two sends were missed,
because they were not in `email-templates.ts` at all — they were inline
template literals inside route handlers:

| Where | What it is |
|---|---|
| `auth/forgot-password/route.ts` | the password reset — an account-takeover credential |
| `services/payment-service.ts` | the donor's receipt — a record of money |

**The two most consequential emails this platform sends were the only two
without the shell.** No doctype, no Outlook table scaffolding (Outlook lays
out through Word and needs them), no derived preheader, no CAN-SPAM footer —
and both declared `font-family: 'DM Sans'`, a web font Gmail strips, so they
rendered in whatever the client defaulted to.

Both now render through `renderEmail`. 25 tests pin the shell contract for
them so neither can regress to a hand-rolled `div`.

### And the receipt had an escaping hole

```ts
<p>Dear ${meta.isAnonymous ? 'Donor' : meta.donorName},</p>
<p>…donation to <strong>${campaign.title}</strong>…</p>
```

`donorName` is **free text the donor types into the checkout form**, carried
through Stripe metadata and written into the email's HTML **unescaped**.
Every other template in `email-templates.ts` had been running everything
through `esc()`; this one was outside the file and outside the habit.

Severity, stated honestly: mail clients strip `<script>`, so this is not
remote code execution in a modern inbox. It is markup injection into an
email that LastDonor sends and signs with its own DKIM key — enough to break
the layout, and enough to inject an arbitrary `<a href>` into a message the
recipient has every reason to trust. On a receipt for money that is not
acceptable at any severity. Every interpolated value is escaped now, with
tests driving a hostile string through the donor name, the campaign title
and the transaction id.

### One more thing in the receipt

The date was `new Date().toLocaleDateString('en-US', …)` — computed on the
**server**, so the receipt was stamped in the container's locale and
timezone with no zone printed. A date on a financial record that cannot be
tied to a timezone cannot be reconciled against anything. It is now an
explicit `YYYY-MM-DD (UTC)`.

---

## Not changed

- **The reset token still travels in the query string.** The existing
  comment in the route explains the two mitigations (Sentry scrubbing,
  `robots: noindex`) and correctly calls moving it to a POST body or a
  one-time exchange cookie the real fix. That needs a change to the reset
  page too, so it stays a follow-up rather than being half-done here.
- **Rate limiting on this route.** It now sends mail on *every* submission
  rather than only for accounts with passwords, which widens the unsolicited
  mail an attacker can trigger. Checked rather than assumed:
  `getLimiterTier` in `src/lib/rate-limit.ts:299` maps `/api/v1/auth/*` to
  the `auth` tier, **10 requests per 60 s, keyed per IP**, and
  `src/middleware.ts:204` applies it before the handler runs. `/register`
  has had exactly this property since `docs/39` without issue, so this is
  the same accepted trade-off — recorded here so it is a decision rather
  than an oversight.
