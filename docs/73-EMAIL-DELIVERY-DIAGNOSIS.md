# 73 — "I can't receive any emails": what is actually wrong

**Date:** 2026-10-16
**Status:** Diagnosed. **Mail delivery is not broken. Mail *sending* barely
happens.**
**Read with:** `docs/65` (no cron has ever run), `docs/67` (the email shell),
`docs/41` (mail consent and CAN-SPAM), `docs/72` (why no donation has ever
been made).

---

## The report, and what the evidence says

> "I cant receive any emails."

Four things were checked. Three of them came back healthy, which is the
useful part of the answer.

### 1. The production Resend key works

Checked from inside the running Fly machine so that the deployed value was
the one tested, and written so the key itself is never printed:

```
key_present true  len 36  prefix_ok true
GET https://api.resend.com/domains → 200
```

**This corrects an earlier conclusion in this session.** The copy of
`RESEND_API_KEY` in the sandbox environment file is invalid (`400 API key is
invalid`), and on that basis the key was first reported as the fault. It is
not: the sandbox copy is stale, and the deployed one authenticates. A secret
that cannot be read back is not evidence about the secret that is deployed —
the only way to find out was to make the deployed process use it.

### 2. The sending domain is verified

```
lastdonor.org   status: verified   sending: enabled   region: eu-west-1
```

DNS agrees (fetched 2026-10-16):

| Record | Present |
|---|---|
| `resend._domainkey.lastdonor.org` TXT (DKIM) | yes |
| `send.lastdonor.org` TXT (SPF, `~all`) | yes |
| `send.lastdonor.org` MX → `send.forge.rmta.net` | yes |
| `_dmarc.lastdonor.org` TXT | `v=DMARC1; p=none;` |

All three `from` addresses the codebase hardcodes —
`noreply@`, `receipts@`, `newsletter@lastdonor.org` — are on that domain.

### 3. Every email the platform has ever sent was delivered

The whole Resend history for this account, filtered to our domain:

| Sent (UTC) | To | Subject | Last event |
|---|---|---|---|
| 10-16 19:19 | kingstonabdizkamau@ | Reset Your Password | **delivered** |
| 10-16 19:16 | kingstonabdizkamau@ | Your account is ready | **delivered** |
| 10-16 15:34 | phdtutor0@ | Welcome to LastDonor.org | **delivered** |
| 10-16 07:51 | cosialm@ | Welcome to LastDonor.org | **delivered** |
| 10-16 07:51 | muchs335@ | Welcome to LastDonor.org | **delivered** |
| 10-15 17:57 | delivered@resend.dev | post-deploy mail check | **delivered** |
| 10-15 02:31 | delivered@resend.dev | deliverability check | **delivered** |

**Seven emails, ever. All delivered.** Two of them were my own test sends.
One went to the address that reported receiving nothing, this morning.

Note `p=none` and a `~all` SPF: both are the permissive settings, so nothing
in the DNS is causing a rejection. "Delivered" means the receiving server
accepted it, not that it landed in the Inbox tab rather than Promotions or
Spam — that is the one thing this evidence cannot settle, and the first
thing to check in Gmail for the 07:51 message above.

### 4. So the real finding: almost nothing ever sends

| Query | Result |
|---|---|
| `select count(*) from notifications` | **0** |
| `select count(*) from donations` | **0** |
| `select count(*) from users` | **5** |
| `audit_logs` cron entries | only the two jobs run by hand on 2026-10-14 |

Every outbound template in the codebase hangs off one of three triggers:

- **a donation** — `notifyCreatorDonationReceived`,
  `notifyCreatorFirstDonation`, `notifyAdminsDonationReceived`,
  `notifyCreatorCampaignCompleted`, and the donor's receipt from
  `payment-service`. There have been **zero donations**, because the
  platform cannot take one at all (`docs/72`).
- **an admin action** — approvals, suspensions, refunds, role changes,
  verification outcomes. None have occurred.
- **a scheduled job** — the newsletter and the campaign digests. **No cron
  has ever run in production** (`docs/65`), so none of these have fired
  once.

What is left is exactly the set that *did* send: registration, welcome,
password reset, newsletter signup. All four worked.

---

## What has to change, and by whom

| # | Item | Who |
|---|---|---|
| 1 | Working **Stripe keys** so donations exist at all — see `docs/72` | owner |
| 2 | Deploy the **cron Worker** (`docs/66`): needs a Cloudflare token with *Workers Scripts: Edit*. Until then the newsletter and every digest stay dead | owner |
| 3 | Set **`MAILING_POSTAL_ADDRESS`** on Fly. It is absent from the secret list, and `send-newsletter` refuses to send without it — correctly, because CAN-SPAM requires a physical address in bulk mail (`docs/41`). Even with the cron deployed, the newsletter would still not go out | owner |
| 4 | Check Gmail's Spam and Promotions tabs for the 07:51 "Welcome to LastDonor.org" | owner |

Nothing here is a code change, which is why none was made.

---

## One thing worth knowing about the Resend account

It is **shared with at least two other products**. Of the 16 most recent
emails on the account, 7 are ours and 9 are from `elopis.com` and a third
domain, including that product's password resets and sign-in codes.

This is not breaking anything today, but it means the sending reputation of
`lastdonor.org` sits in a pool with unrelated traffic, a spam complaint
against another product's mail can affect this one, and the API key in
`RESEND_API_KEY` can read and send on behalf of every domain in the account.
A separate Resend account, or at minimum a domain-scoped key, is the right
end state. Recorded rather than acted on: it is an account decision.
