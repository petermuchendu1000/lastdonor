# LastDonor.org - Security & Compliance Design Document

**Document ID**: LD-SEC-001
**Version**: 0.1
**Date**: March 19, 2026
**Status**: Draft
**Classification**: Internal - Confidential
**Owner**: Engineering Lead
**Reviewers**: CTO, Legal Counsel, Board of Directors

---

## 1. Document Purpose

This document defines the security architecture, threat model, data classification policy, authentication and authorization design, incident response procedures, and regulatory compliance requirements for the LastDonor.org platform. All engineering decisions must comply with the policies defined herein.

---

## 2. Security Principles

1. **Defense in depth** - No single layer of security is sufficient. Multiple overlapping controls at every tier.
2. **Least privilege** - Every user, service, and process operates with the minimum permissions required.
3. **Zero trust** - No implicit trust based on network location. Verify every request.
4. **Secure by default** - All new features ship with security controls enabled. Developers must explicitly opt out (with review).
5. **Fail closed** - On error, deny access. Never fail open.
6. **Audit everything** - Every state-changing operation is logged with actor, action, target, and timestamp.

---

## 3. Data Classification

### 3.1 Classification Tiers

| Tier | Label | Description | Examples |
|------|-------|-------------|----------|
| **T1** | **Restricted** | Data that, if exposed, causes legal liability, financial loss, or severe reputational damage | Payment credentials (handled exclusively by Stripe - never stored), donor SSNs (never collected), admin credentials |
| **T2** | **Confidential** | Data limited to authorized personnel | Donor email addresses, donation amounts tied to identifiers, campaign subject family contact info, internal editorial notes |
| **T3** | **Internal** | Operational data not meant for public consumption | Draft campaigns, admin dashboard metrics, RSS feed aggregation data, internal communications |
| **T4** | **Public** | Data intended for public access | Published campaigns, blog posts, aggregate impact statistics, transparency reports |

### 3.2 Data Handling Requirements Per Tier

| Requirement | T1 Restricted | T2 Confidential | T3 Internal | T4 Public |
|-------------|:---:|:---:|:---:|:---:|
| Encryption at rest | Required | Required | Required | Optional |
| Encryption in transit (TLS) | Required | Required | Required | Required |
| Access logging | Required | Required | Recommended | Not required |
| Backup encryption | Required | Required | Required | Optional |
| Retention limit | Minimum viable | 3 years | 1 year | Indefinite |
| Deletion on request | Within 30 days | Within 30 days | Best effort | N/A |
| Access control | Named individuals only | Role-based | Role-based | None |

### 3.3 Data We Never Collect or Store

- Payment card numbers, CVVs, or bank account details (Stripe handles all payment data)
- Social Security Numbers
- Government-issued ID numbers
- Biometric data
- Health records (even for injury-related campaigns - we reference public reports only)
- Precise geolocation of donors (city-level only, from self-reported data)

---

## 4. Threat Model

### 4.1 STRIDE Analysis

| Threat | Category | Attack Vector | Impact | Likelihood | Mitigation |
|--------|----------|--------------|--------|:---:|------------|
| TM-01 | **Spoofing** | Attacker creates fake admin account | Full platform compromise | Low | Email verification, MFA for admin accounts, invitation-only admin registration |
| TM-02 | **Spoofing** | Attacker impersonates a campaign subject or family | Fraudulent campaign, reputational destruction | Medium | Editorial verification process, multi-source fact checking, approval workflow |
| TM-03 | **Tampering** | Attacker modifies donation amounts in transit | Financial discrepancy | Low | Stripe server-side validation, webhook signature verification, amount reconciliation |
| TM-04 | **Tampering** | Attacker modifies campaign content via XSS | Malicious content displayed to donors | Medium | React auto-escaping, CSP headers, HTML sanitization on CMS input, no `dangerouslySetInnerHTML` without sanitization |
| TM-05 | **Repudiation** | Admin denies modifying campaign or disbursing funds | No accountability | Medium | Immutable audit log for all admin actions with timestamp, actor ID, IP, and action detail |
| TM-06 | **Information Disclosure** | Database breach exposes donor PII | Legal liability, loss of trust | Low | Encryption at rest (Supabase), minimal PII collection, field-level access control |
| TM-07 | **Information Disclosure** | API endpoint returns excessive data | PII leakage | Medium | Explicit field selection in all queries, separate public/admin API response schemas |
| TM-08 | **Denial of Service** | Volumetric DDoS on site or API | Site unavailable during active campaigns | Medium | Cloudflare DDoS protection, Vercel edge network, rate limiting on API routes |
| TM-09 | **Denial of Service** | Donation spam (small automated donations) | Processing fees exceed value, skews campaign data | Medium | Minimum donation amount ($5), reCAPTCHA or Turnstile on donation form, Stripe Radar |
| TM-10 | **Elevation of Privilege** | Donor account gains admin access | Full platform compromise | Low | Role-based access control enforced server-side, admin routes behind middleware, no client-side role checks |

### 4.2 Attack Surface Map

```
EXTERNAL ATTACK SURFACE
│
├── Public Web (lastdonor.org)
│   ├── Campaign pages (SSG/ISR - static, low risk)
│   ├── Donation form (Stripe Elements - card data never touches our server)
│   ├── Newsletter signup (email input - validate, rate limit)
│   ├── Blog (static content - low risk)
│   └── Contact form (if implemented - validate, rate limit, CAPTCHA)
│
├── API Routes (/api/*)
│   ├── /api/donations/create-intent (creates Stripe PaymentIntent)
│   │   └── Risk: abuse for card testing → Mitigate: rate limit, Stripe Radar
│   ├── /api/donations/webhook (Stripe webhook receiver)
│   │   └── Risk: forged webhooks → Mitigate: signature verification
│   ├── /api/newsletter/subscribe (email capture)
│   │   └── Risk: spam signups → Mitigate: rate limit, email validation
│   └── /api/admin/* (all admin endpoints)
│       └── Risk: unauthorized access → Mitigate: auth middleware, role check
│
├── Third-Party Integrations
│   ├── Stripe (outbound API calls + inbound webhooks)
│   ├── Supabase (database + auth + storage)
│   ├── Resend (outbound email)
│   ├── Plausible (client-side analytics script)
│   └── RSS feeds (inbound data from military news sources)
│       └── Risk: malicious content in RSS → Mitigate: sanitize all parsed content
│
└── Admin Dashboard (auth-gated, internal)
    ├── Campaign CRUD
    ├── Donation management
    ├── User management
    └── News feed monitor
```

---

## 5. Authentication & Authorization

### 5.1 Authentication Architecture

| User Type | Auth Method | Session | MFA |
|-----------|-----------|---------|-----|
| **Donor (guest)** | No auth required for donation (Stripe handles identity) | None | N/A |
| **Donor (registered)** | Email + password, or Google OAuth | HTTP-only secure cookie, 7-day expiry, sliding window | Optional (Phase 2) |
| **Editor** | Email + password (invitation-only) | HTTP-only secure cookie, 24-hour expiry | Required |
| **Admin** | Email + password (invitation-only) | HTTP-only secure cookie, 8-hour expiry | Required |

### 5.2 Password Policy (Registered Users)

| Rule | Requirement |
|------|------------|
| Minimum length | 10 characters |
| Complexity | At least 1 uppercase, 1 lowercase, 1 digit |
| Hashing | bcrypt with cost factor 12 |
| Breach check | Validate against HaveIBeenPwned API (k-anonymity model) on registration |
| Reset | Email-based token, 1-hour expiry, single-use |
| Lockout | 5 failed attempts → 15-minute lockout → email notification |

### 5.3 Authorization Model (RBAC)

```
ROLE HIERARCHY
│
├── admin
│   ├── All editor permissions
│   ├── User management (invite, deactivate, change roles)
│   ├── Financial data access
│   ├── Disbursement approval
│   ├── System configuration
│   └── Audit log access
│
├── editor
│   ├── Campaign CRUD (create, edit, publish, archive)
│   ├── Blog post CRUD
│   ├── Campaign update posting
│   ├── News feed monitoring
│   ├── Donor message moderation
│   └── Image upload
│
├── donor (registered)
│   ├── View own donation history
│   ├── View own badges and profile
│   ├── Update own profile
│   ├── Manage notification preferences
│   └── Delete own account
│
└── public (unauthenticated)
    ├── View published campaigns
    ├── View published blog posts
    ├── Make donations (via Stripe)
    ├── Subscribe to newsletter
    └── View transparency reports
```

### 5.4 Server-Side Enforcement

Every API route enforces authorization server-side. Client-side UI hiding is cosmetic only.

```typescript
// Example middleware pattern (pseudocode)
async function requireRole(request: Request, allowedRoles: Role[]) {
  const session = await getServerSession(request);
  if (!session) throw new UnauthorizedError();
  if (!allowedRoles.includes(session.user.role)) throw new ForbiddenError();
  return session;
}

// Usage in API route
export async function POST(request: Request) {
  const session = await requireRole(request, ['admin', 'editor']);
  // ... proceed with authorized action
}
```

---

## 6. Payment Security

### 6.1 PCI DSS Compliance

LastDonor achieves PCI compliance through **SAQ A** (Self-Assessment Questionnaire A) by fully delegating card data handling to Stripe:

| Requirement | How We Comply |
|-------------|--------------|
| Card data never enters our servers | Stripe Elements (client-side JS) collects card data directly to Stripe |
| No card data in logs | No card fields in any form that posts to our API |
| No card data in database | Only Stripe PaymentIntent IDs and charge IDs stored |
| Stripe.js loaded from Stripe CDN | `js.stripe.com` - never self-hosted |
| HTTPS everywhere | Vercel enforces HTTPS; HSTS header enabled |

### 6.2 Donation Integrity

| Control | Implementation |
|---------|---------------|
| Amount validation | Server-side: amount must match PaymentIntent amount. Frontend amounts are suggestions only. |
| Duplicate prevention | Idempotency keys on PaymentIntent creation. Webhook deduplication by event ID. |
| Reconciliation | Nightly cron job compares Stripe dashboard totals with database totals. Alert on discrepancy > $1. |
| Refund policy | Refunds processed through Stripe within 30 days of request. Requires admin approval. Logged in audit trail. |
| Fraud detection | Stripe Radar enabled. Block high-risk payments. Review medium-risk manually. |

### 6.3 Stripe Webhook Security

```
1. Webhook endpoint: /api/donations/webhook
2. Verify signature using stripe.webhooks.constructEvent() with STRIPE_WEBHOOK_SECRET
3. Reject any request with invalid or missing signature (HTTP 400)
4. Process event idempotently - check if event.id already processed
5. Return HTTP 200 immediately, process asynchronously if needed
6. Log all received webhook events (event type, ID, timestamp)
7. Alert if webhook delivery failures exceed threshold (Stripe dashboard monitoring)
```

---

## 7. Infrastructure Security

### 7.1 Network Security

| Layer | Control |
|-------|---------|
| **Edge** | Cloudflare: DDoS mitigation, WAF rules, bot detection, SSL termination |
| **CDN** | Vercel Edge Network: automatic HTTPS, geographic distribution |
| **Application** | Next.js API routes: rate limiting via middleware, input validation |
| **Database** | Supabase: connection pooling via PgBouncer, Row Level Security (RLS) policies, SSL-only connections |
| **Storage** | Supabase Storage: signed URLs with expiry for non-public assets |

### 7.2 HTTP Security Headers

All responses include:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self' js.stripe.com plausible.io; style-src 'self' 'unsafe-inline'; img-src 'self' data: *.supabase.co dvidshub.net; connect-src 'self' api.stripe.com *.supabase.co; frame-src js.stripe.com; font-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")
```

**Amended 2026-10-15 (docs/46):** the `payment` directive read `payment=(self)`
until this date. That is too narrow to be correct: the Payment Request API that
renders Apple Pay and Google Pay runs inside Stripe's cross-origin
`js.stripe.com` iframe, not in our document, so `(self)` disabled the wallet
buttons and the browser console logged `Potential permissions policy violation:
payment is not allowed in this document` on every page loading Stripe.js
(observed live 2026-10-15). `camera`, `microphone` and `geolocation` are
unchanged and still denied to every origin including our own. The emitted value
is pinned by `test/security/csp-headers.test.ts`. **Not verified end to end:**
the deployed publishable key is empty, so no wallet payment has been exercised
against this header.

The `Content-Security-Policy` line above is also the original 2026 design, not
what ships; the live value is in `next.config.ts` and is pinned by the same
test file.

### 7.3 Secret Management

| Secret | Storage | Rotation |
|--------|---------|----------|
| Database connection string | Vercel encrypted env vars | On compromise or annually |
| Stripe API keys | Vercel encrypted env vars | On compromise |
| Stripe webhook secret | Vercel encrypted env vars | On compromise |
| NextAuth secret | Vercel encrypted env vars | On compromise or annually |
| Resend API key | Vercel encrypted env vars | On compromise |
| Supabase service role key | Vercel encrypted env vars | On compromise |

**Rules:**
- No secrets in source code, ever
- No secrets in client-side bundles (NEXT_PUBLIC_ prefix used only for non-sensitive values)
- `.env` files in `.gitignore`
- Secrets differ between preview/staging and production environments

---

## 8. Input Validation & Sanitization

### 8.1 Validation Rules

| Input | Validation |
|-------|-----------|
| Email addresses | RFC 5322 regex + DNS MX record check on registration |
| Donation amounts | Integer (cents), minimum 500 ($5.00), maximum 10000000 ($100,000), server-side validation matches Stripe PaymentIntent |
| Campaign slugs | Alphanumeric + hyphens only, 3-100 characters |
| User-submitted text (donor messages) | Max 500 characters, strip HTML, no URLs |
| Campaign story HTML (editor input) | Allowlist-based HTML sanitizer (DOMPurify or sanitize-html). Allowed tags: p, h2, h3, strong, em, a, img, blockquote, ul, ol, li |
| File uploads (images) | Max 5MB, allowed MIME types: image/jpeg, image/png, image/webp. Reprocess through Sharp to strip EXIF and potential payloads. |
| Search/filter parameters | Parameterized queries only. No interpolation. |

### 8.2 Output Encoding

- All dynamic content rendered through React (auto-escaped by default)
- Campaign story HTML rendered via sanitized `dangerouslySetInnerHTML` with DOMPurify on server
- API JSON responses use `Content-Type: application/json` - no HTML interpretation
- RSS feed content from external sources sanitized before storage

---

## 9. Audit Logging

### 9.1 What We Log

| Category | Events Logged |
|----------|--------------|
| **Authentication** | Login success, login failure, password reset request, password change, MFA enrollment, MFA verification, session expiry, logout |
| **Authorization** | Access denied events (role insufficient), admin route access |
| **Campaign lifecycle** | Created, edited (diff logged), published, status changed, archived, deleted |
| **Donations** | PaymentIntent created, webhook received, donation recorded, refund processed |
| **Disbursements** | Disbursement created, approved, executed, receipt uploaded |
| **User management** | User invited, role changed, account deactivated, account deleted |
| **Content** | Blog post created, edited, published, unpublished |
| **System** | Deployment, configuration change, error rate spike |

### 9.2 Log Entry Schema

```json
{
  "timestamp": "2026-03-19T14:30:00.000Z",
  "event_type": "campaign.published",
  "actor_id": "uuid-of-editor",
  "actor_role": "editor",
  "actor_ip": "203.0.113.42",
  "target_type": "campaign",
  "target_id": "uuid-of-campaign",
  "action": "publish",
  "details": { "campaign_slug": "sgt-pennington", "previous_status": "draft" },
  "severity": "info"
}
```

### 9.3 Log Retention

| Log Type | Retention Period | Storage |
|----------|-----------------|---------|
| Authentication events | 1 year | Database (audit_logs table) |
| Financial events (donations, disbursements) | 7 years (IRS requirement) | Database + encrypted backup |
| Content events | 1 year | Database |
| System/application logs | 90 days | Sentry + Vercel logs |

### 9.4 Log Access

- Audit logs are **append-only**. No update or delete operations permitted.
- Only admin role can view audit logs via dashboard.
- Audit log access itself is logged (meta-logging).

---

## 10. Incident Response Plan

### 10.1 Severity Levels

| Level | Definition | Response Time | Examples |
|-------|-----------|---------------|---------|
| **SEV-1 (Critical)** | Data breach, payment compromise, site completely down | 30 minutes | Donor PII exposed, Stripe credentials leaked, database compromised |
| **SEV-2 (High)** | Major feature broken, donation processing failing, security vulnerability discovered | 2 hours | Donations not recording, webhook failures, XSS vulnerability found |
| **SEV-3 (Medium)** | Degraded performance, non-critical feature broken | 24 hours | Slow page loads, email delivery delays, broken image on campaign |
| **SEV-4 (Low)** | Minor visual bugs, non-urgent improvements | 1 week | Typo, minor layout issue, analytics gap |

### 10.2 Incident Response Procedure

```
DETECTION
  ├── Automated: Sentry alert, Stripe webhook failure alert, uptime monitor
  ├── Manual: User report, team observation
  └── Third-party: HackerOne report (Phase 2), security researcher disclosure
        │
        ▼
TRIAGE (within response time SLA)
  ├── Assign severity level
  ├── Assign incident owner
  └── Notify stakeholders (board for SEV-1)
        │
        ▼
CONTAINMENT
  ├── SEV-1: Immediately disable affected system/endpoint. Rotate compromised credentials.
  ├── SEV-2: Deploy hotfix or feature flag to disable affected feature.
  └── SEV-3/4: Schedule fix in normal development cycle.
        │
        ▼
RESOLUTION
  ├── Root cause analysis
  ├── Fix deployed and verified
  └── Affected users notified (if data breach: within 72 hours per GDPR, per state breach notification laws)
        │
        ▼
POST-MORTEM
  ├── Written post-mortem document (blameless)
  ├── Identify process/architecture improvements
  ├── Update runbooks if applicable
  └── Archive in incident log
```

### 10.3 Data Breach Notification Requirements

| Jurisdiction | Requirement | Timeline |
|-------------|------------|----------|
| US Federal | No single federal law - state laws govern | Varies |
| California (CCPA) | Notify affected California residents | "Expedient" - typically 45 days |
| New York (SHIELD Act) | Notify affected NY residents | "Most expeditious time possible" |
| Other states | 50 states have individual breach notification laws | Varies: 30-90 days |
| GDPR (if EU donors) | Notify supervisory authority | 72 hours |

**Policy**: In the event of a confirmed data breach involving donor PII, we will notify all affected individuals within **30 days**, regardless of jurisdiction. Transparency is the brand. We don't wait for legal minimums.

---

## 11. Regulatory Compliance Matrix

| Regulation | Applicability | Status | Owner |
|-----------|--------------|--------|-------|
| **PCI DSS (SAQ A)** | Payment card processing | Compliant via Stripe delegation | Engineering |
| **CCPA** | California donor data | Compliant: privacy policy, deletion rights, no data sale | Legal + Engineering |
| **CAN-SPAM** | Email communications | Compliant: unsubscribe in all emails, physical address in footer | Engineering |
| **ADA / Section 508** | Website accessibility | WCAG 2.1 AA target (see Accessibility doc) | Engineering + Design |
| **IRS 501(c)(3)** | Tax-exempt status | Pending application | Legal |
| **State charity solicitation** | Fundraising in each state | Registered in home state; phased rollout | Legal |
| **COPPA** | Children under 13 | Not applicable - minimum donor age 18 (enforced in terms of service) | Legal |
| **GDPR** | EU donors (if any) | Phase 2 - implement consent management if EU traffic detected | Legal + Engineering |

---

## 12. Security Review Cadence

| Activity | Frequency | Owner |
|----------|-----------|-------|
| Dependency vulnerability scan (npm audit, Snyk) | Every CI/CD build + weekly | Engineering (automated) |
| Code review (security-focused) | Every pull request | Engineering (peer review) |
| Secret rotation | Annually + on any compromise | Engineering |
| Access review (who has admin/editor roles) | Quarterly | Admin + Board |
| Penetration test (external) | Annually (Phase 2, when budget allows) | External vendor |
| Security header audit | Quarterly | Engineering |
| Stripe security review | Annually | Engineering + Finance |
| Privacy policy review | Annually | Legal |
| Incident response drill | Annually | All team |

---

## 13. Appendix: Security Checklist for Every Pull Request

- [ ] No secrets or credentials in code or comments
- [ ] All user input validated server-side
- [ ] All database queries use parameterized statements (Drizzle ORM)
- [ ] New API endpoints have appropriate auth middleware
- [ ] New API endpoints have rate limiting if public-facing
- [ ] No new `dangerouslySetInnerHTML` without DOMPurify sanitization
- [ ] File uploads validated for type and size, reprocessed to strip metadata
- [ ] Error messages do not leak internal state or stack traces to client
- [ ] New environment variables documented and added to deployment config
- [ ] npm audit shows no HIGH or CRITICAL vulnerabilities introduced
