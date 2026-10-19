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
| **Zoho Mail** | ✅ | ✅ | per user — **see the correction below before buying** | One mailbox carries **30 aliases**, so one user can hold every address |
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

---

## Correction, 2026-10-19: I published vendor pricing I had not verified

The first version of this doc put two numbers in front of the owner —
"free tier reported as 5 users / 5 GB" and "~$1/user/mo" — sourced from
third-party comparison sites, flagged as unverified, and **wrong enough
to cost money**. The owner bought Zoho on the strength of them and got
one mailbox for one user.

Flagging a number as unverified does not undo the fact that it anchors a
decision. This project's own rule is explicit: *"Vendor limits drift;
undated numbers rot silently and are worse than no number."* I should
have verified at the vendor, or given no figure at all and said which
page to look at. The hedge was not a substitute for the check.

It is the same failure docs/90 records about GNews and docs/86 about
TalkNTalk — a capability taken from a secondary source instead of the
primary one — except those two were caught before anything was bought.

### What is actually true, verified at Zoho's own limits page (2026-10-19)

| | |
|---|---|
| Aliases per mailbox | **30** — "29 additional aliases plus 1 primary address" |
| Does the alias limit vary by plan? | **No.** The page states the limit applies to "All users" |
| Extra cost per alias | **None.** The page lists no per-alias charge |
| Domains, free/trial | **1** — "Limited to single domain" |
| Domains, paid | **30** per organization |

Deliberately **not** restated here: the per-user price and the free
tier's user count. I have not verified either at Zoho's own pricing page,
and that is exactly what caused this. Read them off Zoho's pricing page
at the time of purchase.

### The practical consequence: one paid mailbox is enough

LastDonor publishes **ten** addresses. All ten fit inside the 30-alias
limit of the **single** mailbox already paid for, at no extra cost, and
Zoho can send *as* an alias — so replies come from `support@lastdonor.org`
rather than a personal address, which was the whole reason to prefer a
mailbox over Cloudflare forwarding.

What aliases do **not** give you is a separate login per address. If
`legal@` or `editorial@` ever needs its own person with their own
password, that is a second user. For a one-person operation it is not.

This also changes the recommendation above: **Cloudflare Email Routing is
now optional, not the first step.** With Zoho holding the domain's MX and
all ten addresses as aliases, routing adds nothing. Keep Cloudflare
Routing in mind only if addresses later need to land in *different*
people's existing inboxes.

### Rule for next time

Do not put a vendor's price, tier or quota in front of the owner unless
it was read from that vendor's own page in the same session. If it has
not been checked there, name the page and say it needs checking — do not
supply the number with a hedge attached.

---

## Second pass, 2026-10-19: after the Zoho account was created as "Personal"

Zoho's sign-up offers **Personal** or **Business**, and only Business attaches
a custom domain. **Verified** on Zoho's own login-help page: Zoho Mail provides
the service for *business accounts* to get "custom domain-based email
addresses"; a Personal account gets a Zoho-supplied address. This compounds the
alias finding above — Zoho's admin docs say aliases exist only for users whose
**domain is configured in Zoho Mail**, never on an `@zoho.com` address. So the
Personal branch gives neither the domain nor the ten addresses.

The owner asked for a different provider. Everything below was read from the
vendor's own page on 2026-10-19, per the rule recorded above.

### ⚠️ Gmail "Send mail as" is not a foundation to build on

The obvious free trick — Cloudflare forwards in, Gmail sends as
`support@lastdonor.org` over an SMTP relay — has two problems, both from
**Google's own support page**:

1. The custom-SMTP step is documented **for work or school accounts**. The page
   does not say a personal Gmail account can use its own SMTP server.
2. **"Starting January 2027, 'Send as' will no longer support third-party
   addresses such as Yahoo or Outlook."** Google Workspace aliases and other
   Gmail addresses are stated as unaffected.

Whether a custom-domain address relayed through our own SMTP counts as
"third-party" is **not stated** — so it is an open risk, roughly two months
out, on the one feature the whole arrangement depends on. Recorded as a reason
not to build the support desk on it, not as a confirmed breakage.

### Migadu — verified at migadu.com/pricing, 2026-10-19

The distinguishing feature is that **pricing is flat per account, not per
mailbox or per domain** — the page says so in those words. That is the exact
trap that cost money here.

| Plan | Yearly | Monthly | Incoming/day | Outgoing/day | Storage |
|---|---|---|---|---|---|
| Micro | **$19** | not offered | 200 | 20 | 5 GB |
| Mini | $90 | $9 | 1,000 | 100 | 30 GB |
| Standard | $290 | $29 | 3,000 | 500 | 100 GB |

Addresses are **unlimited** on these plans with no extra cost per address, and
domains are unlimited on Mini and above (Micro has no enforced cap but heavy
use may prompt an upgrade). There is a **"Try for Free" sign-up with "No credit
card required"**; the page does not state the trial length. The old free plan
is discontinued.

Micro's limits are the ones to sanity-check against our actual volume, and they
are comfortable: the platform has taken **zero donations** (docs/72) and sent
**seven emails in its lifetime** (docs/73). The 20/day outgoing cap applies
only to human replies typed from the mailbox — **all application mail keeps
going through Resend**, which is already verified and untouched by any of this.

### Recommendation

1. **Start the Migadu free trial** (no card). Point the MX at it, add all ten
   addresses, send a test to `support@` and reply from it.
2. **Pay the $19/year only once that round-trip works.** Nothing here has been
   proven against our domain yet, and this doc's whole correction history is
   about paying before proving.

Kept as the zero-cost fallback: **Cloudflare Email Routing** for receiving,
with replies sent from a desktop or mobile mail client configured against
`smtp.resend.com` (**verified**: ports 465/2465 implicit TLS, 25/587/2587
STARTTLS, username `resend`, password = the Resend API key, domain already
verified). This avoids Gmail's send-as restriction entirely because it is not
Gmail. It is free and uses only infrastructure already working, at the cost of
a mail client to configure.

Also still true, and cheapest of all if the owner is willing: the existing Zoho
purchase works if an **organization** account is created on the same login. The
owner has asked to move on, and that is recorded rather than argued with.
