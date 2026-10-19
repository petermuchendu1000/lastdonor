# 95 — Corporate email: Cloudflare gives addresses, not mailboxes

**Date:** 2026-10-19
**Status:** ⛔ Not yet actioned — needs one owner decision (the destination inbox) and a dashboard step
**Why now:** docs/73 amendment — `lastdonor.org` has no MX, so all ten published addresses bounce

---

## The question

Owner, 2026-10-19: *"Where can we get corporate emails — can cloudflare provide them?"*

## The short answer

**Partly, and free.** Cloudflare Email Routing gives you *addresses at your
domain that forward somewhere else*. It does **not** give you mailboxes, and
you cannot reply as `support@lastdonor.org` from it.

So Cloudflare fixes the urgent problem — mail to our published addresses
currently bounces — at zero cost, today. Being able to *reply* as
`support@` is a second, separate decision.

---

## What is actually broken

**Verified 2026-10-19:** `lastdonor.org` has **no MX record**. Ten addresses
are published across `src/`, `support@` in 69 places, and every one of them
bounces. `privacy@lastdonor.org` is named in the privacy policy as the route
to exercise GDPR/CCPA rights "within 30 days".

Sending is fully configured and unaffected (Resend DKIM, SPF via
`send.lastdonor.org`, DMARC `p=none`). Full detail in the docs/73 amendment.

---

## Cloudflare Email Routing — verified against their docs, 2026-10-19

| | |
|---|---|
| What it does | Receives mail at your domain and **forwards** it to a verified destination inbox, or hands it to a Worker |
| Cost | Free, on Free and Paid plans |
| Routing rules | **200 per domain** |
| Destination addresses | **200 per account**, shared across domains, all must be verified |
| Max inbound message | **25 MiB** |
| Domains per zone | 30, shared with Email Sending |
| Sending | **Not included.** "Email Sending" is a **separate product, in beta, requiring Workers Paid**; arbitrary-recipient sending needs the paid plan |

Cloudflare's own framing is that Email Routing "processes incoming emails
with Workers or forwards them to destination addresses". Incoming. That is
the whole product.

**We already run DNS for `lastdonor.org` on Cloudflare**, so this is the
lowest-friction option available to us by some distance.

### The catch, stated plainly

A donor emails `support@lastdonor.org`. It lands in whatever personal inbox
we forward to. We reply — and the reply comes **from that personal
address**, not from `support@lastdonor.org`. For a platform asking strangers
to trust it with money, that is not a good look, and it leaks a personal
address to every person who writes in.

---

## Options

| Option | Receive | Send as `support@` | Cost | Notes |
|---|---|---|---|---|
| **Cloudflare Email Routing** | ✅ | ❌ | Free | DNS already here. ~10 minutes. **Verified** above |
| Cloudflare Routing **+ Gmail "Send mail as"** over Resend SMTP | ✅ | ✅ | Free | Gmail sends through our existing Resend credentials. More moving parts; Resend account is shared (docs/73) |
| **Zoho Mail** | ✅ | ✅ | Free tier, or ~$1/user/mo | *Third-party figures, not verified against Zoho:* free tier reported as 5 users / 5 GB, **webmail only, no IMAP/POP** |
| **Google Workspace** | ✅ | ✅ | *Reported* ~$7/user/mo annual | Everyone knows how to use it. Most expensive |
| Resend | ❌ | ✅ (already) | — | Sending only. Not a mailbox provider |

The Zoho and Google figures came from third-party comparison sites, not the
vendors' own pricing pages. **Confirm before committing** — vendor pricing
drifts and docs/90 is the standing reminder about trusting a number nobody
checked at the source.

---

## Recommendation

**Do both, in this order.**

1. **Today — turn on Cloudflare Email Routing.** It is free, the DNS is
   already here, and it stops a GDPR commitment and 69 support links
   bouncing. Even if we later move to real mailboxes, nothing here is
   wasted: the MX records just get repointed.

2. **Then decide on mailboxes.** Once mail is arriving we will know the
   actual volume, and the choice between "forwarding is fine" and "we need
   to reply as support@" becomes an informed one instead of a guess. My
   expectation is that a platform handling other people's money needs to
   reply from its own domain, which means Zoho or Google — but that is worth
   deciding on real volume.

### Rejected

**Changing the copy to remove the addresses.** The addresses should start
working; a crowdfunding platform that publishes no way to reach a human is
worse than one whose mail bounces. The only copy that needs touching is the
`privacy@` 30-day promise, and only if routing is *not* set up promptly.

**Cloudflare Email Sending to cover replies.** It is in beta and needs
Workers Paid, and docs/81 is explicit about not shipping a path we have not
exercised. Resend already sends, is verified, and works (docs/73).

**A Worker that parses inbound mail into the app.** Interesting later —
support tickets as rows — but it is a product feature, not the fix for a
bouncing address, and it would be the only thing standing between a donor
and a human.

---

## What the owner has to do

Claude cannot complete this: the `CF_API_TOKEN` in this session **cannot see
the `lastdonor.org` zone** (verified — the zones lookup returns no result,
the same scoping that hid the Workers in docs/65), and enabling routing
requires verifying a destination address by clicking a link in an email only
the owner receives.

In the Cloudflare dashboard → `lastdonor.org` → **Email** → Email Routing:

1. Enable it. Cloudflare adds the MX and SPF records itself.
2. Add the destination inbox and click the verification link it emails.
3. Create rules for at least `support@`, `privacy@`, `legal@`, `contact@`,
   `editorial@` and `receipts@`, or one catch-all.
4. Leave `noreply@` and `deleted@` unrouted — they are send-only by intent.

Then tell me, and I will verify the MX from here and confirm delivery end to
end rather than assuming it worked.

---

## Read this before

- Publishing any new `@lastdonor.org` address — check it can receive first
- Touching the Resend setup: the `send.` subdomain records are the sending
  path and are **not** the inbound fix
- Believing docs/73's title: it is about outbound mail only
