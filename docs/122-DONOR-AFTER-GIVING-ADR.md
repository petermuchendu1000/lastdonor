# 122 — The donor after giving: told nothing, and unable to leave

**Date:** 2026-10-27
**Scope:** what happens to a person after they give money — receipt, updates,
messages, refund, and stopping contact.
**Status:** six findings fixed and tested; thirteen reported and not changed (§8).

---

## 1. Why this journey, and what production says

| | |
|---|---|
| donations | **2**, both PayHero/KES, KES 100 total |
| `donations.refunded` | 0 |
| `donor_campaign_subscriptions` | **0 rows** |
| `campaign_updates` | **46** |
| …of those, on a campaign that has donors | **0** |
| `campaign_messages` | 4 |
| `newsletter_subscribers` | 5 |
| users with `email_verified` set | **0 of 9** |

Both real donations are the owner's own gateway test on an archived campaign,
so no member of the public has given yet. That makes this the right moment to
walk it.

---

## 2. ⛔ A refund on the live rail told the donor nothing

`PATCH /api/v1/admin/donations/[id]` branches on `donation.provider !==
'stripe'`, corrects the ledger, and **returned** — roughly sixty lines above
`notifyDonationRefund`.

So refunding a donation on any rail but Stripe:

- marked it `refunded`, dropped `campaigns.raised_amount`, decremented
  `donor_count`, wrote a `donation.refunded` audit row carrying
  `gatewayRefund: 'NOT ISSUED - this gateway has no refund API'`;
- called **no gateway at all**, because PayHero has none;
- and told the donor **nothing** — no email, no notification row, no money.

Both donations this platform has ever taken are `payhero`. That was every real
donor.

⛔ **It could not simply reuse `donationRefundedEmail`.** That template opens
*"We sent your money back"* and promises arrival *"in 5 to 10 working days"* —
both false when nothing was called. A new `manualRefundPendingEmail` says what
is true: the gift is cancelled, **a person sends the money back by hand**, it
has not moved yet, and here is an address if it does not arrive. No turnaround
is quoted, because none can be substantiated.

### 2.1 And the admin was told the opposite

The confirm dialog said the donation would be refunded **"via Stripe"** —
hardcoded, and wrong for every donation this platform has taken. The success
handler then discarded the route's own honest `manualRefundRequired` /
`message` fields and fired `toast.success('Refund processed')`.

So an administrator read "via Stripe", pressed confirm, saw "Refund
processed", and the shilling stayed in the wallet with only an audit row
recording that anyone owed it. The API was honest; both ends of it were not.

Both now tell the truth, and the toast is a warning rather than a success when
the money still has to be sent by hand.

### 2.2 The figure was in the wrong currency

The in-app title was `` `Donation of $${(p.amount / 100).toFixed(2)} refunded` ``.
A KES 50 refund read **"$0.50"**. `currency` is now a required parameter, so
`tsc` named the one call site; four known currencies are zero-decimal, where
`/ 100` understates by 100x (`docs/92`).

---

## 3. ⛔ A donor could not stop hearing from us

`renderEmail`'s footer (`email-shell.ts:361`) points **every** template at
`/settings` under "Manage your notifications", and no caller in `src/` passes
`footerLinks`. That route was:

```ts
export default function SettingsPage() {
  redirect('/dashboard/settings');
}
```

— which lives behind the authenticated dashboard layout. **The only opt-out
link in the product's outgoing mail was a login wall**, and the M-Pesa form
takes a phone and an email and creates no account, so a guest is the default
and only shape of donor on the rail that works.

`/settings` now serves a signed-out reader: it names the support address, says
a person will take them off the list, and offers sign-in for anyone who does
have an account.

⛔ **It deliberately does not offer a one-click button.** There is no stored
suppression for an address with no `newsletter_subscribers` row and no
`donor_campaign_subscriptions` row — `unsubscribeMechanism(null)` already
reaches the same conclusion and returns a `mailto:`. A button here would be a
claim the platform cannot keep.

⚠️ **Not closed, and reported in §8:** the three opt-out stores are
independent, `sendEmailOnly` (the guest path) applies **no suppression at
all**, and `notifyCampaignStatusChange` mails every un-refunded real donor
with no subscription or preference check. A guest cannot be suppressed by any
stored mechanism today. That is a `docs/41` CAN-SPAM question and larger than
a link.

---

## 4. ⛔ Nobody can opt into updates, and the updates notify nobody anyway

Two shut gates, and opening either alone changes nothing:

1. **Nobody can subscribe at the moment of giving.**
   `MpesaDonationForm.tsx:168` hardcodes `subscribedToUpdates: false` and
   never asks; `DonationForm` has no such field, so the validator's
   `.default(false)` applies. The flag is otherwise plumbed end to end —
   validator → metadata → column → settlement → the insert at
   `payment-service.ts:386` — and asked by nobody.
   ⚠️ `donations.subscribed_to_updates` is a **dead column**: the donation
   insert does not list it, so it always takes its default regardless of what
   the form sends. The real opt-in lives in `donor_campaign_subscriptions`.
2. **The one subscribe door is invisible to a guest.** `SubscribeButton`
   returned `null` unless authenticated, and `POST
   /api/v1/campaigns/[slug]/subscribe` requires a session.
3. **And the dominant writer of updates does not notify.** All 46 production
   updates came from the `update-phases` cron, which never calls
   `notifyCampaignUpdateDigest`. The organiser and admin routes do.

Fixed here: `SubscribeButton` now uses **`useAuthState`** rather than
`useSession` (CLAUDE.md, `docs/44`), so a rate-limited or failed session read
renders as *unknown* — the skeleton — instead of silently removing the only
subscribe control in the product with no error shown.

⛔ Adding the opt-in checkbox to the donation forms is reported, not done
(§8.1): it is the highest-leverage change in this trace and it is a product
decision about what to ask for at the moment of payment.

---

## 5. ⛔ Three promises the product cannot keep

| Where | Said | Reality |
|---|---|---|
| `DonationForm`, above the pay button | *"Monthly donations can be cancelled before the next billing date."* | No cancellation path exists. `stripe.subscriptions.retrieve` is a read; nothing calls `.cancel`; no screen offers it. |
| `/register` | *"Save campaigns and get updates as they close."* | No saved-campaigns column and no route. |
| `/register` | *"One-tap checkout next time you give."* | Neither donate form reads the session; `MpesaDonationForm` initialises every field empty. No saved instrument on either rail. |

All three replaced with what an account actually does. CLAUDE.md: never add a
claim the platform cannot substantiate.

---

## 6. Corrections to earlier claims, mine and the docs'

- ⚠️ **I said "no donor on this platform has ever been offered campaign
  updates." Too strong.** A `SubscribeButton` exists on the campaign page for
  signed-in readers. The accurate statement is that the *donation flow* never
  offers it and a *guest* cannot reach the one that exists.
- ⚠️ **I began concluding that guest donations produce no audit row or
  organiser notification**, from production showing 2 donations and 1 of each.
  **Refuted by reading**: the audit insert in `payment-service.ts:314` is not
  user-gated. The first donation simply predates a code change between the two
  pushes that day (`docs/92`: "one donation per push").
- ⚠️ **`docs/115` says "the live PayHero path sends no mail at all." Wrong.**
  The PayHero path reaches the same `sendDonationReceipt` the Stripe path
  does, and `donorEmail` is required on that rail, so the receipt genuinely
  fires. What `docs/115` got right is that the *adaptive* receipt family
  (`notifyAdaptiveDonationReceipt` and five siblings) has zero callers; the
  plain receipt lives in `payment-service.ts`, not `notifications.ts`, and is
  invisible to a sweep of notify functions.
- ⚠️ **`docs/115` says `formatCents` now requires a currency.** True of
  `email-adaptive.ts`; **not** of `email-templates.ts:56`, which still
  defaults to `'USD'`.

---

## 7. Checks

- `npm run lint` — clean (one pre-existing unused-arg warning).
- `npm run typecheck` — clean.
- `npm run test:unit` — see the commit message for exact counts.
- `donor-is-told.test.ts` — 7 tests, each proven by injection: removing the
  notify from the branch, restoring the unconditional redirect, and restoring
  the hardcoded dollar each fail exactly their own rule, with a verified clean
  restore between.
- The email ratchets (`email-plain-language`, `email-dark-mode`) pass on the
  new template.

---

## 8. Reported, not changed

1. ⛔ **Neither donation form offers the updates opt-in**, although it is
   plumbed end to end. One checkbox in `MpesaDonationForm` replacing the
   literal at `:168` is the highest-leverage change in this trace. It is a
   product decision about what to ask at the moment of payment, and it should
   land with the §4.3 fix or it still delivers nothing.
2. ⛔ **The `update-phases` cron writes updates and never notifies.** 46 of 46
   production updates came from it. Fixing the opt-in without this changes
   nothing.
3. ⛔ **A guest cannot be suppressed by any stored mechanism.**
   `sendEmailOnly` applies no suppression; `notifyCampaignStatusChange` mails
   every un-refunded real donor with no subscription or preference check; the
   three opt-out stores (`newsletter_subscribers`, per-campaign
   `donor_campaign_subscriptions`, `users.preferences`) are independent, so
   there is no "stop all contact" switch. `docs/41` CAN-SPAM territory.
4. ⚠️ **`email-shell.ts:177` documents a `commercial` flag that "adds the
   unsubscribe and postal-address block"; `:364` adds only the postal
   address**, and no non-test caller passes it. `email-templates.ts` contains
   the word "unsubscribe" zero times.
5. ⛔ **`cancel/route.ts:248-250` tells the admin "The ledger is corrected"**
   on the non-Stripe branch, while `:311-319` only calls `applyRefundInTx` for
   `status === 'completed'`, so it is not. The single-donation route does
   correct it — the two paths disagree.
6. ⛔ **The admin refund guard reads `provider`, not `source`.** A seed
   donation defaults to `provider: 'stripe'` with a `seed_…` reference, so
   pressing Refund on one calls `stripe.refunds.create` with that reference
   and 502s. The bulk path is immune because it filters `source = 'real'`.
7. ⛔ **Batch retries notify nobody**, on either rail.
8. ⛔ **`/dashboard/updates` and `/dashboard/supported` are orphan routes**,
   referenced by nothing. `/dashboard/updates` is the only donor-facing
   surface that shows campaign updates **without** needing a subscription —
   the one thing that would work, behind no door. `docs/83` shape.
9. ⛔ **`/dashboard/updates:79` links `/campaigns/<slug>` unguarded** — it does
   not select the status, so it cannot call `hasPublicPage`. A donor whose
   campaign later moved to `draft` or `under_review` gets a 404 from their own
   history. `docs/118` rule; the fourth sweep gap found for it.
10. ⚠️ **`/dashboard/impact` filters on `userId` only** while five sibling
    surfaces match `or(userId, donorEmail)`. A guest who later registers with
    the same address sees their gift in Finances and zero in Impact.
    Relatedly: that retroactive recovery works and **nothing tells anybody it
    exists** — the receipt carries no link of any kind.
11. ⚠️ **`formatCents` still defaults to `'USD'`** in `email-templates.ts:56`,
    so `donationRefundedEmail`, `donationRefundReversedEmail` and
    `campaignCancelledRefundEmail` render KES as dollars. Unreachable today
    only because of §2's early return, which this pass has now removed from
    the notification path — so this is newly armed for the Stripe branch.
12. ⚠️ **The receipt says "The rest goes to the campaign"**, implying a
    deduction. `docs/116` §5 established that nothing deducts a processing fee:
    `payment-service.ts` credits `raisedAmount + amount` in full. Not in
    `fee-claims.test.ts`'s prohibited set, so no test catches it.
13. ⚠️ **`users.email_verified` is NULL for all 9 production users and is read
    by nothing** — a dead column. Harmless today; a trap for anyone who
    assumes it gates something.
