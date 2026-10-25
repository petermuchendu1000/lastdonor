# 111 — Campaign collaborators (team fundraising)

**Status:** safety core BUILT, NOT REACHABLE (no route creates a row yet).
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

## 5. ⛔ Not built yet, and the feature is inert until it is

**No route creates a collaborator row.** The capability check is wired, the
table exists, and there is no way to populate it, so this change grants
nobody anything today. That is deliberate — it makes the safety core
reviewable on its own.

Still to build:

1. **Invite / accept / revoke routes.** ⚠️ The invite route **sends email**,
   so it needs its own rate-limit tier: `/api/v1/user-campaigns/*` currently
   falls through to the `default` 60/60s bucket in both lookups
   (`getLimiterTier` and `ROUTE_LIMITS`), which would let one account mail 60
   addresses a minute from `lastdonor.org`. It also needs a per-campaign cap.
   Note the `docs/85` ordering trap: a more specific tier placed **after** a
   broader prefix never fires, and the two lookups must agree.
2. **A cap on collaborators per campaign**, for the same abuse reason.
3. **UI**: a team list on the campaign's dashboard page, and the accept screen.
4. **Surfacing the existing per-person share link** — see §6.

---

## 6. The growth loop mostly exists already, and nothing can reach it

[VERIFIED] `campaign_share_links` (`schema.ts:629-647`) is **already
per-person**: `campaign_id` + a nullable `user_id`, a unique token and a
`click_count`. `donations.share_link_id` (`schema.ts:565`) attributes
donations to a link, and `docs/58` already built a "your impact" dashboard on
top of it. The mint route `campaigns/[slug]/share-link/route.ts:74` requires
only `auth()` — **not ownership**.

So *"three cousins each blast it to their networks and each sees what they
brought in"* — the actual ask — is largely built, needs **no campaign
authority at all**, and has no door in the UI for anyone but the organiser.

That is the `docs/83` shape a third time: a working mechanism nobody can
reach. It may be most of the value in this request, and it is the cheapest
item on the list.
