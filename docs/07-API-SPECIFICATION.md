# LastDonor.org - API Specification

**Document ID**: LD-API-001
**Version**: 0.1
**Date**: March 19, 2026
**Status**: Draft
**Classification**: Internal
**Owner**: Engineering Lead
**Base URL**: `https://lastdonor.org/api`

---

## 1. API Design Principles

1. **RESTful** - Resources identified by nouns, actions by HTTP methods.
2. **JSON only** - All request and response bodies are `application/json`.
3. **Consistent error format** - Every error follows the same schema.
4. **Versioned** - `/api/v1/` prefix for all endpoints. Future breaking changes increment version.
5. **Pagination** - All list endpoints support cursor-based pagination.
6. **Rate limited** - All public endpoints enforce rate limits. Limits returned in response headers.
7. **Idempotent** - POST endpoints accept idempotency keys where applicable.

---

## 2. Authentication

### Public Endpoints
No authentication required. Rate limited by IP.

### Authenticated Endpoints
Bearer token via `Authorization: Bearer <session_token>` header, or HTTP-only session cookie (set by NextAuth).

### Admin/Editor Endpoints
Same as authenticated, with server-side role verification. Insufficient role returns `403 Forbidden`.

---

## 3. Standard Response Envelope

### Success Response
```json
{
  "ok": true,
  "data": { ... },
  "meta": {
    "cursor": "eyJpZCI6...",
    "hasMore": true
  }
}
```

### Error Response
```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Donation amount must be at least $5.00",
    "field": "amount",
    "requestId": "req_abc123"
  }
}
```

### Error Codes

| Code | HTTP Status | Meaning |
|------|:---:|---------|
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Authenticated but insufficient permissions |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Duplicate resource or state conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error (details logged, not exposed) |

---

## 4. Rate Limiting

| Endpoint Category | Limit | Window | Scope |
|-------------------|-------|--------|-------|
| Public reads (campaigns, blog) | 100 | 1 minute | Per IP |
| Donation intent creation | 10 | 1 minute | Per IP |
| Newsletter subscribe | 5 | 1 minute | Per IP |
| Authentication | 10 | 15 minutes | Per IP |
| Admin/editor endpoints | 60 | 1 minute | Per user |

**Response headers on every request:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1711324800
```

---

## 5. Endpoint Specification

---

### 5.1 Campaigns

#### `GET /api/v1/campaigns`

List active campaigns. Public.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|:---:|---------|-------------|
| `status` | string | No | `active` | Filter by status: `active`, `last_donor_zone`, `completed`, `all` |
| `category` | string | No | - | Filter by category: `medical`, `disaster`, `military`, `veterans`, `memorial`, `first-responders`, `community`, `essential-needs` |
| `sort` | string | No | `newest` | Sort order: `newest`, `oldest`, `most_funded`, `least_funded`, `closing_soon` |
| `limit` | integer | No | 10 | Results per page (max 50) |
| `cursor` | string | No | - | Pagination cursor from previous response |

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": [
    {
      "id": "camp_abc123",
      "slug": "sgt-pennington-family",
      "title": "Sgt. Pennington gave everything. His family shouldn't have to.",
      "status": "active",
      "phase": "closing_in",
      "category": "military",
      "heroImageUrl": "https://storage.lastdonor.org/campaigns/sgt-pennington-hero.webp",
      "subjectName": "Ben Pennington",
      "subjectHometown": "Glendale, KY",
      "goalAmount": 3000000,
      "raisedAmount": 2160000,
      "donorCount": 347,
      "percentFunded": 72,
      "excerpt": "Ben Pennington was 26, from Glendale, Kentucky. He gave his life supporting Operation Epic Fury.",
      "publishedAt": "2026-03-10T12:00:00Z",
      "updatedAt": "2026-03-19T08:30:00Z"
    }
  ],
  "meta": {
    "cursor": "eyJpZCI6ImNhbXBfYWJjMTIzIn0",
    "hasMore": true,
    "total": 12
  }
}
```

**Notes:**
- All monetary values are in **cents** (integer). $30,000.00 = 3000000.
- `phase` is computed server-side from `percentFunded`: 0-25 = `first_believers`, 25-60 = `the_push`, 60-90 = `closing_in`, 90-100 = `last_donor_zone`.

---

#### `GET /api/v1/campaigns/:slug`

Get single campaign with full detail. Public.

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": {
    "id": "camp_abc123",
    "slug": "sgt-pennington-family",
    "title": "Sgt. Pennington gave everything. His family shouldn't have to.",
    "status": "active",
    "phase": "closing_in",
    "category": "military",
    "heroImageUrl": "https://storage.lastdonor.org/campaigns/sgt-pennington-hero.webp",
    "subjectName": "Ben Pennington",
    "subjectHometown": "Glendale, KY",
    "goalAmount": 3000000,
    "raisedAmount": 2160000,
    "donorCount": 347,
    "percentFunded": 72,
    "storyHtml": "<p>Ben Pennington was 26, from Glendale, Kentucky...</p>",
    "impactTiers": [
      { "amount": 2500, "label": "Covers a week of groceries for the family" },
      { "amount": 5000, "label": "Travel expenses for funeral arrangements" },
      { "amount": 10000, "label": "One month of mortgage assistance" }
    ],
    "publishedAt": "2026-03-10T12:00:00Z",
    "completedAt": null,
    "lastDonor": null,
    "recentDonors": [
      {
        "name": "Sarah T.",
        "location": "Texas",
        "amount": 5000,
        "message": "Rest easy, Sergeant.",
        "phase": "closing_in",
        "createdAt": "2026-03-19T08:25:00Z",
        "isAnonymous": false
      }
    ],
    "updates": [
      {
        "id": "upd_001",
        "title": "Campaign launched",
        "bodyHtml": "<p>We've verified this story and launched the campaign...</p>",
        "imageUrl": null,
        "createdAt": "2026-03-10T12:00:00Z"
      }
    ]
  }
}
```

**Notes:**
- `recentDonors` returns last 10 by default. Anonymous donors show `name: "Anonymous"`, no location.
- `storyHtml` is sanitized server-side before storage and before response.
- `impactTiers` are in cents.

---

#### `POST /api/v1/campaigns` - **Editor/Admin only**

Create a new campaign.

**Request Body:**
```json
{
  "title": "string (required, 10-200 chars)",
  "slug": "string (required, 3-100 chars, alphanumeric-hyphens)",
  "category": "string (required, enum: medical|disaster|military|veterans|memorial|first-responders|community|essential-needs)",
  "heroImageUrl": "string (required, valid URL)",
  "subjectName": "string (required)",
  "subjectHometown": "string (optional)",
  "storyHtml": "string (required, sanitized HTML)",
  "goalAmount": "integer (required, cents, min 100000 = $1,000)",
  "impactTiers": [
    { "amount": "integer (cents)", "label": "string (max 100 chars)" }
  ],
  "status": "string (optional, default: draft, enum: draft|active)"
}
```

**Response: `201 Created`**

---

#### `PUT /api/v1/campaigns/:id` - **Editor/Admin only**

Update a campaign. Partial updates supported (send only changed fields).

**Response: `200 OK`**

---

#### `DELETE /api/v1/campaigns/:id` - **Admin only**

Soft-delete a campaign (sets status to `archived`). Only draft or completed campaigns can be deleted. Active campaigns must be archived first.

**Response: `200 OK`**

---

### 5.2 Donations

#### `POST /api/v1/donations/create-intent`

Create a Stripe PaymentIntent for a donation. Public.

**Request Body:**
```json
{
  "campaignId": "string (required, UUID)",
  "amount": "integer (required, cents, min 500 = $5.00, max 10000000 = $100,000)",
  "donorName": "string (required, 1-100 chars)",
  "donorEmail": "string (required, valid email)",
  "donorLocation": "string (optional, city/state)",
  "message": "string (optional, max 500 chars)",
  "isAnonymous": "boolean (optional, default false)",
  "isRecurring": "boolean (optional, default false)",
  "idempotencyKey": "string (optional, UUID)"
}
```

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": {
    "clientSecret": "pi_xxx_secret_xxx",
    "paymentIntentId": "pi_xxx",
    "amount": 5000,
    "campaignTitle": "Sgt. Pennington gave everything..."
  }
}
```

**Validation:**
- Campaign must exist and be `active` or `last_donor_zone`.
- Amount must be integer, minimum 500, maximum 10000000.
- Email must pass RFC 5322 validation.
- Rate limited: 10 per minute per IP.

---

#### `POST /api/v1/donations/webhook`

Stripe webhook receiver. Called by Stripe, not by our frontend.

**Verification:**
1. Read raw request body (do not parse JSON first)
2. Verify `stripe-signature` header using `STRIPE_WEBHOOK_SECRET`
3. Reject invalid signatures with `400`
4. Process event idempotently

**Handled Event Types:**

| Event | Action |
|-------|--------|
| `payment_intent.succeeded` | Create donation record, update campaign raised_amount + donor_count, check if goal met, send receipt email |
| `payment_intent.payment_failed` | Log failure, do not create donation record |
| `charge.refunded` | Update donation record, decrement campaign raised_amount, log in audit trail |
| `invoice.payment_succeeded` | Process recurring donation (same as payment_intent.succeeded) |

**Response: `200 OK`** (always, to prevent Stripe retries on handled events)

---

#### `GET /api/v1/campaigns/:slug/donors`

List recent donors for a campaign. Public.

**Query Parameters:**

| Parameter | Type | Required | Default |
|-----------|------|:---:|---------|
| `limit` | integer | No | 20 (max 50) |
| `cursor` | string | No | - |

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": [
    {
      "name": "Sarah T.",
      "location": "Texas",
      "amount": 5000,
      "message": "Rest easy, Sergeant.",
      "phase": "closing_in",
      "createdAt": "2026-03-19T08:25:00Z"
    }
  ],
  "meta": { "cursor": "...", "hasMore": true }
}
```

**Notes:**
- Anonymous donations: `name` = "Anonymous", `location` = null.
- `amount` is always visible (even for anonymous donors) to maintain social proof.

---

### 5.3 Newsletter

#### `POST /api/v1/newsletter/subscribe`

Subscribe an email to the newsletter. Public.

**Request Body:**
```json
{
  "email": "string (required, valid email)",
  "source": "string (optional: homepage|campaign|blog|footer)"
}
```

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": {
    "message": "Subscribed successfully."
  }
}
```

**Notes:**
- Duplicate emails return `200 OK` with same response (no error, no information leakage about existing subscribers).
- Rate limited: 5 per minute per IP.

---

#### `POST /api/v1/newsletter/unsubscribe`

Unsubscribe an email. Requires signed token (sent in email unsubscribe link).

**Request Body:**
```json
{
  "token": "string (required, signed unsubscribe token)"
}
```

---

### 5.4 Blog

#### `GET /api/v1/blog`

List published blog posts. Public.

**Query Parameters:**

| Parameter | Type | Required | Default |
|-----------|------|:---:|---------|
| `category` | string | No | - (`campaign_story`, `impact_report`, `news`) |
| `limit` | integer | No | 10 (max 50) |
| `cursor` | string | No | - |

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": [
    {
      "id": "post_abc",
      "slug": "why-we-built-lastdonor",
      "title": "Why We Built LastDonor",
      "excerpt": "We built LastDonor because...",
      "coverImageUrl": "https://storage.lastdonor.org/blog/why-cover.webp",
      "authorName": "Editorial Team",
      "category": "news",
      "publishedAt": "2026-03-19T12:00:00Z"
    }
  ],
  "meta": { "cursor": "...", "hasMore": false }
}
```

---

#### `GET /api/v1/blog/:slug`

Get single blog post. Public.

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": {
    "id": "post_abc",
    "slug": "why-we-built-lastdonor",
    "title": "Why We Built LastDonor",
    "bodyHtml": "<p>We built LastDonor because...</p>",
    "coverImageUrl": "...",
    "authorName": "Editorial Team",
    "authorBio": "The LastDonor editorial team verifies and publishes every story.",
    "category": "news",
    "publishedAt": "2026-03-19T12:00:00Z"
  }
}
```

---

### 5.5 Impact / Statistics

#### `GET /api/v1/stats`

Aggregate platform statistics. Public. Cached for 5 minutes.

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": {
    "totalRaised": 24700000,
    "totalDonors": 4200,
    "campaignsCompleted": 42,
    "campaignsActive": 5,
    "peopleSupported": 38
  }
}
```

---

### 5.6 Admin

All admin endpoints require `editor` or `admin` role.

#### `GET /api/v1/admin/dashboard` — REMOVED 2026-10-17 (docs/88 F10)

Deleted, not deprecated: it had no callers anywhere in the repository.
`/admin` computes the same figures server-side in its own page, so the
endpoint was a second implementation of money figures that nothing
rendered and nobody compared against the screen.

Three shapes existed at once by the end: this spec promised
`{today, thisMonth, activeCampaigns, recentDonations}`, the route
returned `{today, month, dailyDonations}`, and the page computed a
third. That is the cost of a parallel implementation with no consumer
to keep it honest.

If a 30-day donations chart is wanted (the one thing the route had that
the page does not), build it from a query module the page also calls,
not from a second endpoint. Note the route's series would have been
wrong once `REPORTING_TIMEZONE` left UTC: it bucketed with
`date_trunc('day', ...)` in the database's zone while the tiles above
it used the reporting zone (docs/88 F15), and its 30-day window was a
rolling instant rather than a day boundary, so the first bucket was
always a partial day.

---

#### `GET /api/v1/admin/news-feed`

Aggregated RSS feed items from military news sources. Editor/Admin only.

**Query Parameters:**

| Parameter | Type | Required | Default |
|-----------|------|:---:|---------|
| `source` | string | No | - (filter by: `dvids`, `stripes`, `military_times`, `defense_gov`) |
| `limit` | integer | No | 20 |
| `since` | ISO 8601 | No | 24 hours ago |

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": [
    {
      "id": "news_123",
      "title": "DoW announces death of USASMDC Soldier",
      "source": "dvids",
      "url": "https://www.dvidshub.net/...",
      "summary": "The Department of War announced the death of...",
      "publishedAt": "2026-03-09T10:00:00Z",
      "fetchedAt": "2026-03-09T16:00:00Z",
      "campaignCreated": false
    }
  ]
}
```

---

#### `GET /api/v1/admin/audit-log` - **Admin only**

Query audit trail. Admin only (editors cannot access).

**Query Parameters:**

| Parameter | Type | Required | Default |
|-----------|------|:---:|---------|
| `eventType` | string | No | - |
| `actorId` | UUID | No | - |
| `since` | ISO 8601 | No | 7 days ago |
| `until` | ISO 8601 | No | now |
| `limit` | integer | No | 50 |
| `cursor` | string | No | - |

---

### 5.7 User Profile

#### `GET /api/v1/users/me`

Get current authenticated user's profile. Requires auth.

**Response: `200 OK`**
```json
{
  "ok": true,
  "data": {
    "id": "user_abc",
    "email": "sarah@example.com",
    "name": "Sarah T.",
    "location": "Austin, TX",
    "avatarUrl": null,
    "role": "donor",
    "totalDonated": 15000,
    "campaignsSupported": 3,
    "lastDonorCount": 1,
    "badges": [
      { "type": "first_believer", "campaignSlug": "hurricane-relief", "earnedAt": "2026-02-15T..." },
      { "type": "last_donor", "campaignSlug": "sgt-pennington-family", "earnedAt": "2026-03-18T..." }
    ],
    "createdAt": "2026-01-05T..."
  }
}
```

---

#### `PUT /api/v1/users/me`

Update own profile. Requires auth.

**Allowed fields:** `name`, `location`, `avatarUrl`

---

#### `DELETE /api/v1/users/me`

Delete own account and anonymize donation records. Requires auth + confirmation.

**Process:**
1. Donations retained but donor name → "Deleted User", email → null, message → null
2. User record deleted
3. Session invalidated
4. Confirmation email sent

---

## 6. Webhook Outbound (Phase 2)

For future integrations (Slack notifications, Zapier, etc.):

| Event | Payload |
|-------|---------|
| `campaign.created` | Campaign object |
| `campaign.completed` | Campaign object + last donor info |
| `donation.received` | Donation object (PII stripped) |
| `goal.milestone` | Campaign ID + milestone (25%, 50%, 75%, 90%) |

---

## 7. OpenGraph / Meta API

#### `GET /api/v1/og/campaign/:slug`

Generate dynamic OpenGraph image for campaign social sharing. Public.

**Response:** `200 OK` with `Content-Type: image/png`

Generated image includes:
- Campaign hero image (cropped)
- Title overlay
- Progress bar
- LastDonor logo
- "lastdonor.org" watermark

Used in campaign page `<meta property="og:image">` tag.
