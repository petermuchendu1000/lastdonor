# 111 — Campaign collaborators (team fundraising)

**Status:** BUILT (invite, accept, revoke, team panel). NOT DEPLOYED.
⛔ A collaborator cannot yet reach a screen to use their capabilities — see §5a.
**Date:** 2026-10-25.

GoFundMe's team-fundraising loop, asked for by the owner: a family in crisis
has one cousin running the page, another posting updates, and three more
pushing it to their own networks. This doc records what a collaborator may do,
what one may never do, and the traced reason the line sits where it does.

---

## 1. ⛔ The decision: content capabilities only. Money and identity are never delegated

A collaborator row grants an enumerated set of **content** capabilities and
nothing else. It cannot authorise a payout, change where money is sent, upload
identity documents, delete a campaign, change a campaign's status, or invite
further collaborators.

**This is not caution. The obvious implementation — "treat a co-organizer as
an owner" — misdirects money, silently.**

[VERIFIED 2026-10-25, by reading the handler]
`src/app/api/v1/user-campaigns/[id]/withdraw/route.ts:146-154` resolves the
payout destination like this:

```ts
const [user] = await db
  .select({ stripeConnectAccountId: users.stripeConnectAccountId, … })
  .from(users)
  .where(eq(users.id, session.user.id))     // ← the CALLER, not the creator
  .limit(1);
```

and hands it to `createTransfer(amount, currency, user.stripeConnectAccountId, …)`
at line 405-408.

**Falsification attempted:** is there a later re-check that the destination
belongs to the creator? `sed -n '155,405p' … | grep -E "creatorId|users\.id|session\.user\.id"`
returns **nothing**. Not falsified.

So the invariant *"the credited account belongs to the person the funds are
owed to"* is held up by **one line**: the ownership comparison at
`withdraw/route.ts:138`, eight lines earlier. Widen ownership and the
invariant breaks with no error anywhere — a family's crisis funds land in the
cousin's bank account.

**Identity is excluded for a different reason.**
`verification/documents/route.ts:63` is creator-gated, and the platform's
claim is that a person has checked who the **organiser** is. A helper
uploading their own ID makes that claim false while every status column still
reads verified. That is the same reasoning `docs/108` used to refuse
`fully_verified` for an institutional vouch: a third party's act must not
become the platform's assertion about somebody else.

**A collaborator cannot invite.** The trust root is the creator. One
compromised helper account must not grow the blast radius without the
organiser seeing it — `docs/108`'s "no self-serve signup" argument, one level
down.

### Rejected alternatives

- **A role column with `co_organizer` / `beneficiary` / `viewer`.** Rejected
  for v1: two of the three would have had no surface behind them, which is
  what `docs/76`, `docs/77` and `docs/81` are each about. One kind of
  collaborator, with capabilities named in code. A role column can be added
  the day a second kind is genuinely different.
- **Delegating withdrawal to a collaborator who has their own verified
  Connect account.** Rejected: it does not fix the misdirection, it
  *formalises* it. The money is owed to the campaign's beneficiary, not to
  whoever on the team happens to have finished Stripe onboarding.
- **Reusing `verification_tokens` for the invite.** Rejected: it is keyed
  `(identifier, token)` with a composite primary key (`schema.ts:921-931`) and
  has nowhere to hang a campaign, an inviter or an accepted-at. Exactly the
  reasoning `docs/85` used for `phone_verification_codes`.

---

## 2. What was built

| Piece | File |
|---|---|
| Table | `campaign_collaborators`, `migrations-v2/0010_familiar_frightful_four.sql` |
| Capability lists (pure) | `src/lib/collaborators/capabilities.ts` |
| The check | `src/lib/collaborators/can-collaborate.ts` |
| Module boundary | `src/lib/collaborators/collaborator-boundary.test.ts` |
| Call-site boundary | `src/lib/collaborators/collaborator-call-sites.test.ts` |
| Constraints, real Postgres | `src/lib/collaborators/collaborators.integration.test.ts` |

`DELEGATABLE` is `['post_update', 'edit_content']`. Both are wired to routes
that already exist, and a test asserts each named route is on disk.

⚠️ **`reply_to_message` is deliberately absent.** [VERIFIED] There is no
organiser message-reply route at all: `campaigns/[slug]/messages/route.ts` is
the public wall with no ownership check, and moderation is admin/editor only.
A capability for it would name nothing.

### Why `edit_content` is safe to delegate

[VERIFIED by reading the handler] `user-campaigns/[id]` **PUT** applies an
explicit allowlist at `[id]/route.ts:151-163` — title, category,
heroImageUrl, galleryImages, subjectHometown, story — and writes no `status`,
`goalAmount`, `slug` or `subjectName`.

This was checked because `updateCampaignSchema = createCampaignSchema.partial()`
(`validators/campaign.ts:56`) **does** include `status: z.enum(['draft','active'])`,
which would have been a route straight through the `docs/78`/`docs/79` review
gate. The route uses a different schema (`updateUserCampaignSchema`) and an
allowlist, so it is not. The concern was raised and **disproved**; it is
recorded here because the next person reading `updateCampaignSchema` will have
the same concern.

### ⚠️ `requireOwner` takes the capability per call site

`GET`, `PUT` and `DELETE` share one `requireOwner` helper in
`user-campaigns/[id]/route.ts`. The capability is passed as an argument at each
call site — `'edit_content'` for GET and PUT, **nothing** for DELETE — rather
than being baked into the helper. A single shared widening would have handed
collaborators the delete path too, which is the kind of accident `docs/109`
is about. A test parses the three call sites out of the source and asserts
DELETE's argument list is empty.

---

## 3. The two tests, and why there are two

`collaborator-boundary.test.ts` proves the collaborator **module** cannot
write money: it reads the directory's `.update()`/`.insert()` targets and
fails the build on anything but `campaign_collaborators` / `audit_logs`, and
on any mention of a money, payout, verification or status column.

That is necessary and **not sufficient**. The module could be perfectly sealed
while somebody calls `canCollaborate` from the withdrawal route — delegating
money without touching the sealed directory at all. So
`collaborator-call-sites.test.ts` is the other half: it asserts six sealed
routes do not consult `canCollaborate`, that the withdrawal route still
compares `creatorId`, and that nothing outside two declared surfaces consults
it (found by walking `src/app` and `src/components`, because `docs/110` §9.3
is the lesson that two correct assertions and one unswept surface read exactly
like coverage).

It also carries a **tripwire on the premise**: an assertion that the payout
destination is still read from `session.user.id`. If someone changes the
withdrawal route to resolve it from the creator instead, that assertion fails
— and whoever sees it should come back and re-read whether money could then be
delegated safely. The rule is pinned to the fact that justifies it, not just
asserted.

**Both proven by injection.** Making `withdraw` delegatable fails 3 of 11
boundary tests; adding a `db.update(users)` to the module fails 2; adding
`canCollaborate` to the withdrawal route fails 2 call-site tests; widening
DELETE fails 1.

---

## 4. Database guarantees, proven against real Postgres

`docs/101` is the doc about a money guard that passed unit tests, a text
ratchet and typecheck while being silently inert. Every safety property of
this table is a constraint, so all of them are exercised against a real
Postgres (13 tests):

- `campaign_collaborators_email_lower` — a mixed-case email is **refused**.
  Without it `alice@x.com` and `Alice@x.com` are two live rows for one person
  and revoking one leaves the other granting access, which the unique index
  cannot see.
- `campaign_collaborators_accepted_has_user` — an accepted row with a null
  user is **refused**. Such a row matches nothing in `canCollaborate`, so it
  would read as granted while granting nothing.
- `idx_campaign_collaborators_live` — partial unique on
  `(campaign_id, invited_email) WHERE revoked_at is null`. One live invite per
  person per campaign; **re-invite after revoke is allowed** and the revoked
  row stays as history. Same idiom as `institution_vouches` (`docs/108`).
- `ON DELETE cascade` — deleting a campaign takes its collaborators.

And `canCollaborate` itself requires **both** `accepted_at is not null` and
`revoked_at is null`. Neither is redundant: without the first, *sending* an
invite would grant access before the invitee clicked anything; without the
second, revocation would do nothing at all. Both are tested, including the
pending case.

⚠️ `clearDatabase` does not name this table, but its `TRUNCATE … CASCADE` of
`campaigns` reaches it — confirmed from the Postgres NOTICE. The integration
file truncates it explicitly anyway, so the suite does not depend on that
cascade surviving a reordering of `clearDatabase`'s list.

---

## 5. The invitation flow

An organiser invites by email, the invitee accepts from a link, and the
organiser can remove anybody at any time.

| Route | Who |
|---|---|
| `GET/POST /api/v1/user-campaigns/[id]/collaborators` | **creator only** |
| `DELETE …/collaborators/[collaboratorId]` | **creator only** |
| `POST /api/v1/collaborators/accept` | any signed-in user, with the token |

⛔ Staff are **not** admitted to the team routes either. An admin managing
somebody else's team is a different feature with different consent questions,
and admins already have `/admin/campaigns`.

### Tokens

32 bytes from `randomBytes`, SHA-256 at rest. The raw token is in the email
and nowhere else, so a database leak yields no working invitations. ⚠️ A plain
digest and **not** the HMAC used for phone codes, deliberately: a six-digit
code has a million possibilities and must be peppered or the space is
precomputable, while 256 bits is not brute-forceable and a pepper would add a
deployment dependency for nothing. `docs/85` makes the opposite call for the
opposite reason.

### ⚠️ The rate-limit tier, and why it is a predicate

The invite route sends email from `lastdonor.org`. Without its own tier it
sits in the generic `default` bucket (60/60 s), which lets one account mail
sixty addresses a minute from our domain. So there is a `collab` tier at
5/60 s.

It is matched by a **predicate**, `isCollaboratorInvite`, not by a prefix.
The path is `/api/v1/user-campaigns/<uuid>/collaborators` with the id in the
**middle**, which `startsWith` cannot describe — and matching
`/api/v1/user-campaigns` alone would put **the withdrawal route** into a
five-a-minute email bucket, a denial of service on payouts introduced while
adding a feature about invitations. A test asserts it does not.

POST only. Listing and revoking cost us nothing and must not share the send
budget: the SMS tier shipped matching every verb and 429'd a person typing a
code we had just texted them (`docs/85`).

⚠️ **Both lookups are pinned by test.** `getLimiterTier` (distributed) and
`ROUTE_LIMITS`/`getConfig` (in-memory fallback) are separate code paths, and
only the second runs when Upstash is unreachable — which is also when an
abuser would most like to be sending mail. Removing the in-memory entry while
leaving the distributed tier correct fails 2 tests; widening the predicate to
the whole prefix fails 3.

### The real abuse control is the cap, not the limit

`MAX_LIVE_COLLABORATORS = 10` per campaign. The IP limit bounds how fast one
address can send; the per-campaign cap bounds how many an **account** can send
at all, which is what stops a campaign being used as a mailing list. Same
division of labour as `docs/85`, where the per-code attempt counter is the
control that works and the IP limit only bounds the spray.

### ⚠️ The invitation page does not accept on load

`/collaborate/accept` renders a **button**. Mail clients, link scanners and
anti-virus proxies fetch the URLs in an email before a person sees it, so
accepting on GET would hand the membership to whichever machine opened the
message first, or burn the invitation before the invitee clicked. A GET must
not mutate.

It exists in the same change as the email that links to it. `docs/109` is the
doc about a flow pointing at something that could not render; shipping the
mail first would have been that defect on purpose.

### Races, closed by the database rather than by reading first

- **Two simultaneous invitations to one address** → the partial unique index
  decides; exactly one survives. A check-then-insert would let both through.
- **Two simultaneous accepts of one invitation** → the UPDATE is keyed on
  `accepted_at IS NULL`, so the second updates zero rows. **Proven by
  injection:** removing that guard makes both accounts gain access.
- **A duplicate invite** is a 409 from the constraint, not a 500, and not a
  prior SELECT.

### What the invitee is told, and where

The email and the accept screen both say, in the body and not in small
print: *"You will not be able to touch the money. Only the person who started
the campaign can ask for a payout or change where it goes."* Somebody invited
to "help with a fundraiser" will reasonably assume it includes the money
unless told plainly, and the honest answer shapes whether they accept at all.

The organiser's panel says the same thing before they invite anybody.

---

## 5b. ✅ The loop, exercised in a browser 2026-10-25

Driven through the real UI against a production build (`next start`, not
`next dev` - `docs/63`/`64`: our CSP blocks `unsafe-eval`, so in dev no client
component hydrates and this panel would have been silently inert).

Captured, each state asserted before the shot so it cannot show something
else: empty -> typed -> sent -> **duplicate refused as a 409** -> **rate
limiter fires** -> at the cap -> removal frees a slot -> the invitee signs in,
accepts from the emailed link, lands on `/dashboard/campaigns?joined=1`, and
the organiser's panel flips to "Helping now". 0 console errors.

⚠️ **The `collab` tier was observed firing for the first time outside a unit
test**: the sixth invite in a minute answered `POST 429`, and the panel
surfaced *"Too many requests. Please try again later."* The limiter is the
thing most likely to be wired to nothing (it lives in middleware, two lookups
away from this route), so seeing the real status code matters more than the
unit tests passing.

⚠️ **One screenshot had to be thrown away**, and it is the reason this section
exists. A first capture of the rate-limited state matched `[role="alert"]`
page-wide, found an empty element elsewhere, and photographed the button
mid-flight at "Sending…" with no error at all - a picture that would have been
filed as proof of a refusal that it did not show. Scoping the selector inside
the panel and waiting for the request to finish produced the real one. A
screenshot asserts nothing by itself; **assert the state, then photograph it.**

⛔ Still no automated coverage: this was a one-off harness, deleted
afterwards. Making it repeatable needs the signed-in E2E fixture `docs/99`
records as missing - the organiser password here was set ad hoc.

---

## 5a. ⛔ Still not done

1. **A collaborator cannot REACH a screen to use their capabilities.** The API
   admits them to `post_update` and `edit_content`, but
   `/dashboard/campaigns/[id]` and the edit page are gated on
   `creatorId === session.user.id || staff`. So the capability is wired and
   unusable from the UI — the `docs/83` shape, recorded rather than
   half-fixed, because widening several dashboard pages is its own change with
   its own review.
2. **`/dashboard/campaigns` does not list campaigns you only help with.** Its
   query is `eq(campaigns.creatorId, session.user.id)`.
3. **No E2E coverage.** `docs/99` records the missing signed-in fixture, which
   is the same gap as everywhere else.

---

## 6. The growth loop was ALREADY COMPLETE, and nobody was told

[VERIFIED] `campaign_share_links` (`schema.ts:629-647`) is **already
per-person**: `campaign_id` + a nullable `user_id`, a unique token and a
`click_count`. `donations.share_link_id` (`schema.ts:565`) attributes
donations to a link, and `docs/58` already built a "your impact" dashboard on
top of it. The mint route `campaigns/[slug]/share-link/route.ts:74` requires
only `auth()` — **not ownership**.

### ⚠️ CORRECTION, same day

An earlier draft of this section said the loop "has no door in the UI for
anyone but the organiser". **That was wrong**, and it was wrong in the
direction that would have had me rebuild something that already works.

[VERIFIED] `SidebarShareButton` is mounted on the public campaign page via
`SidebarDonationSummary.tsx:115`, checks `isAuthenticated`
(`SidebarShareButton.tsx:64`), and for a signed-in sharer resolves and shares
`/s/<token>` rather than the plain URL (lines 69-94), falling back to the
plain URL on any failure. `/dashboard/impact` then renders each link with its
clicks, donors brought and amount brought.

So **the growth loop is complete and needs nothing built.** Three cousins can
each press Share today and each see what they brought in.

What was actually missing is only that **nobody is told.** A helper who joins
a campaign never learns that pressing Share gives them their own link, or
that an impact page exists. So the whole of step 4 is one paragraph in the
team panel pointing at both — which is what shipped.

The lesson is the cheap one: the gap was discoverability, and reading the
component before believing my own summary of it is what found that.
