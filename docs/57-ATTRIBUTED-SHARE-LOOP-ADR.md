# 57 — The attributed share loop

Decided 2026-10-16. Closes the half of `docs/30` §1.1 that `docs/47` §4
explicitly left open.

`docs/30` ranks this **first** among parity gaps and is blunt about why:
a plain share button **is not parity**. Nothing it produces can be counted,
so an organizer can never tell which supporter actually reached anyone. The
share control added in `docs/47` was placement only; this is the mechanism.

**Why this one and not another homepage section:** it is the only item on the
benchmark list GoFundMe cannot retrofit. They have ~1M existing campaign
pages whose shares were never attributed, and no way to go back and record
provenance they never captured — the same argument `docs/30` §2.2 makes
about a disbursement ledger.

---

## 1. The loop

```
mintShareLink()  ->  /s/<token>  ->  cookie  ->  Stripe metadata  ->  donations.share_link_id
```

1. A verified donation mints the donor a link, `/s/<token>`.
2. `/s/<token>` resolves it, counts the visit, sets a 7-day cookie, redirects
   to the campaign.
3. `create-checkout` reads the cookie and puts the token on the Stripe
   metadata.
4. The webhook resolves it and writes `donations.share_link_id` **in the same
   INSERT as the donation**.

Stripe metadata is the carrier deliberately: `CLAUDE.md` records it as the
disaster-recovery substrate, so attribution survives anything that can be
rebuilt from Stripe alone.

---

## 2. Decisions

### Tokens are random, not signed

16 bytes of `randomBytes`, base64url, 22 characters. Every use looks up a
row, so a signature would add verification cost and buy nothing.

This is deliberately **the opposite** of `unsubscribe-tokens.ts` (`docs/40`),
which is HMAC'd because it must be verifiable with no row to check against.
Two token systems, two different jobs; they are not inconsistent.

### `/s/<token>` is a Route Handler outside `/api`

Only a handler can set a cookie and redirect in one response — a Server
Component can do neither. Putting it at `/s/` rather than `/api/s/` keeps it
outside the default-deny middleware matcher, so it needs no
`PUBLIC_API_ROUTES` entry. It is a public link by definition.

### Unknown tokens redirect, they do not 404

Someone followed a link a friend sent them. A stale or mistyped token lands
them on `/campaigns` and loses only the attribution. The same is true if the
lookup throws.

### Attribution can never break a donation

`create-checkout` wraps the whole lookup in `try/catch`, and
`request.cookies` is read optionally. A cookie-less request object or a
database hiccup costs the **sharer their credit**, never the **campaign its
donation**. This was not hypothetical: the first version used
`request.cookies.get(...)` unguarded and turned three checkout tests into
500s, which is exactly what it would have done to a real donation from a
runtime that passes a plain `Request`.

### The link is minted only on a Stripe-verified success

Two reasons. Every mint writes a row, so minting on render would create one
per page view rather than one per donor. And `docs/42` established that
nothing may be rendered from an unverified `?donation=success`; a link
reading "anyone who gives through this is credited to you" is a claim about
a donation, so it is held to the receipt's bar. Minting is best-effort and
degrades to the plain campaign URL.

### Idempotent per (campaign, signed-in user)

A signed-in donor who shares twice keeps one countable link instead of
splitting their own total. Guests get a fresh link each time: with no
identity there is nothing to deduplicate against.

### The cookie is campaign-checked at redemption

`resolveShareLinkForCampaign` requires the token to belong to **this**
campaign. Without it, a cookie left over from campaign A would credit A's
sharer for a donation to campaign B.

### Window: 7 days

Long enough that "saw it Friday, gave on Sunday" credits the sharer; short
enough that a shared device does not attribute a stranger's donation months
later. **Not a measured figure** — no attribution window ever is — so it is
one named constant rather than a scatter of literals.

---

## 3. A fabricated statistic, removed

The existing post-donation share block told every donor:

> **"One share brings an average of two new donors."**

That number appears in **no document, no analysis and no data source** in
this repository. It was invented.

On a platform whose `CLAUDE.md` opens its claims section with *"Never add a
claim the platform cannot substantiate"*, and which already has an incident
on record for forged attribution and invented quotes (`docs/36`), a made-up
conversion statistic shown to someone who has just handed over money is not
a small thing. It is the same failure mode, in the donor's face, at the
moment they are most trusting.

Replaced with something true and better: *"This link is yours. Anyone who
gives through it is credited to you."*

---

## 4. Schema

`campaign_share_links` (id, campaign_id, token, user_id, click_count,
created_at) plus `donations.share_link_id`.

Migration `0001_ordinary_electro.sql` in `migrations-v2/`, per `docs/34`.
**Purely additive** — new table, nullable column, FKs, indexes; no
destructive statement. **Dry-run against production inside
`BEGIN … ROLLBACK`: 9 statements, no errors, and `campaign_share_links`
confirmed absent afterwards.**

This is the first migration after the baseline, so it is also the first real
exercise of the `migrations-v2` lineage `docs/34` established.

---

## 5. A bug this shipped, and how it was caught

The first deploy redirected every share link to
**`https://0.0.0.0:3000/campaigns/...`** — a dead host.

`request.nextUrl.origin` is the container's internal bind address behind
Fly's proxy, not the public origin. Now `appBaseUrl()`, the same canonical
origin the unsubscribe links already use.

**No unit test could have caught it as written**, because the bug only
exists once something is proxying in front. It was caught by the production
smoke test, which followed a real minted link with `curl -D -` and read the
`location` header. A regression test now pins it by asserting the redirect
target is the canonical origin and explicitly `not.toContain('0.0.0.0')`,
from a request whose own origin is the bind address.

The lesson generalises: **anything that constructs an absolute URL from the
incoming request is wrong on this deployment**, and the smoke test has to
look at headers, not just status codes. A 302 alone looked fine.

---

## 6. Not built yet

- **Organizer-facing per-link stats.** The data is being captured now
  (`click_count`, and donations joined on `share_link_id`), but nothing
  surfaces it. That is the half an organizer actually sees, and it is the
  next increment.
- **Co-organizer roles.** `docs/30` §1.4 covers beneficiary and co-organizer
  payout roles; per-link donor counts for co-organizers depend on that and
  are out of scope here.
- **Click deduplication.** `click_count` counts visits, not unique visitors.
  Honest as labelled, and it should be labelled that way wherever it is
  eventually shown.
