/**
 * Unsubscribe tokens — single source of truth for **both** kinds.
 *
 * ## Why this module exists
 *
 * The newsletter mint/verify pair was duplicated: `createUnsubscribeToken`
 * lived in `src/app/api/v1/cron/send-newsletter/route.ts` and a byte-compatible
 * `verifyUnsubscribeToken` lived in
 * `src/app/api/v1/newsletter/unsubscribe/route.ts`, with a comment in the
 * latter noting that extracting it needed a new `src/lib/` module. This is
 * that module. Any site that sends marketing mail must be able to mint a
 * working unsubscribe link without copying crypto.
 *
 * Both newsletter copies are now gone: the cron mints through
 * `createUnsubscribeToken` here (224e069) and the unsubscribe route verifies
 * through `verifyUnsubscribeToken` here (2026-10-15).
 *
 * The **campaign** pair moved here on 2026-10-15 as well, for the same reason
 * and after the duplication caused a live defect: the verifier was private to
 * `src/app/api/v1/campaigns/[slug]/subscribe/route.ts`, so no send site could
 * mint the token the route demanded, and the campaign-update footer links in
 * `src/lib/email-adaptive.ts` shipped with no `token` at all. Every such link
 * already in a donor's inbox answered 403 — a dead unsubscribe in commercial
 * mail (CAN-SPAM §316.5, GDPR Art. 7(3)), not a cosmetic bug. Minting and
 * verifying now live in one place so a send site cannot forget the token.
 *
 * ## Two formats, one module (both unchanged — links already in inboxes keep working)
 *
 * ### 1. Newsletter, a **subscriber-id** token
 *
 *   token = `<subscriberId>.<hex hmac-sha256(NEWSLETTER_UNSUBSCRIBE_SECRET, subscriberId)>`
 *
 * The signature covers the bare `newsletter_subscribers.id` and nothing else —
 * no purpose string, no version tag, no expiry claim, hex digest, `.`
 * separator located with `lastIndexOf`. The format issued for new links and
 * the format verified for old ones are the same format; there is no legacy
 * variant to carry, because the route's private verifier removed on 2026-10-15
 * signed over byte-identical input with the same algorithm and the same env
 * var.
 *
 * `NEWSLETTER_UNSUBSCRIBE_SECRET` is required. There is deliberately no
 * fallback to `NEXTAUTH_SECRET`: reusing the session secret for a public,
 * never-expiring, emailed token widens its blast radius.
 *
 * ### 2. Campaign updates, a **bare digest over a versioned message**
 *
 *   message = `campaign-unsubscribe:v1:<campaignId>:<normalised email>`
 *   token   = hex hmac-sha256(secret, message)
 *   secret  = CAMPAIGN_UNSUBSCRIBE_SECRET, else NEWSLETTER_UNSUBSCRIBE_SECRET
 *
 * Note `campaignId` — the UUID, never the slug. The signature binds the token
 * to one (campaign, address) pair, so it authorises exactly one unsubscribe
 * and nothing else.
 *
 * ### The two formats stay distinct
 *
 * Co-locating the code does **not** merge the formats, and that is deliberate:
 * neither verifier accepts the other's tokens. The newsletter token carries
 * `<id>.` framing and signs an opaque id; the campaign token is a bare digest
 * over a purpose- and version-prefixed message. The purpose prefix is what
 * makes sharing `NEWSLETTER_UNSUBSCRIBE_SECRET` as the campaign fallback safe:
 * a signature minted for one flow is not a valid signature for the other. A
 * dedicated `CAMPAIGN_UNSUBSCRIBE_SECRET` is still preferred. Do not "unify"
 * the wire formats — the earlier header comment's warning about that stands;
 * what changed is only that both now live in one module instead of three.
 *
 * ## Shared properties
 *
 * Neither format carries an expiry and neither is single-use. Both are
 * deliberate and already documented on the two routes: an unsubscribe link
 * that stops working is itself a compliance defect, and single-use redemption
 * state needs a migration (frozen — see CLAUDE.md). Replay is harmless because
 * the operation is idempotent and terminal, and the tokens grant nothing else.
 *
 * Both verifiers **fail closed** when their secret is unset: a missing secret
 * must never degrade into "accept anything". Both compare with
 * `timingSafeEqual`.
 */
import { createHmac, timingSafeEqual } from 'crypto';

/** Mailbox already published platform-wide; used as the no-token fallback. */
export const SUPPORT_MAILBOX = 'support@lastdonor.org';

/**
 * ## CAN-SPAM sender identity
 *
 * The sender's valid physical postal address is a required element of every
 * commercial message (15 U.S.C. §7704(a)(5)(A)(iii)). It is read from
 * `MAILING_POSTAL_ADDRESS` and there is **deliberately no default**: the
 * newsletter footer previously hardcoded `1234 Main St, Suite 100,
 * Washington, DC 20001`, a placeholder presented as the sender's real address,
 * which is an affirmative false statement about the operator. Per CLAUDE.md
 * ("never add a claim the platform cannot substantiate", cf. the 501(c)(3)
 * disclaimer removed in 13a2726), a send site with no configured address must
 * refuse to send rather than invent one.
 */
export function mailingPostalAddress(): string | null {
  return process.env.MAILING_POSTAL_ADDRESS?.trim() || null;
}

/** Message used when a send is refused for want of a postal address. */
export const MISSING_POSTAL_ADDRESS_REASON =
  'MAILING_POSTAL_ADDRESS is not set. Commercial email requires the sender\'s real physical postal address (CAN-SPAM 15 U.S.C. §7704(a)(5)(A)(iii)); refusing to send rather than printing a placeholder address.';

/** Constant-time compare of two hex strings. */
function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * The canonical signing key: `NEWSLETTER_UNSUBSCRIBE_SECRET`, trimmed.
 *
 * A whitespace-only value is treated as unset, so it fails closed on both mint
 * and verify rather than signing with a blank-ish key.
 */
function secret(): string | null {
  return process.env.NEWSLETTER_UNSUBSCRIBE_SECRET?.trim() || null;
}

/**
 * The raw, **untrimmed** env value — returned only when it differs from the
 * canonical key, i.e. only when the configured secret has surrounding
 * whitespace.
 *
 * ## Why this exists (2026-10-15)
 *
 * The two implementations this module consolidated were identical in every
 * respect that reaches the wire — algorithm, signed input, digest encoding,
 * framing, env var — with exactly one difference: the private verifier in
 * `newsletter/unsubscribe/route.ts` (and the cron minter before 224e069) used
 * `process.env.NEWSLETTER_UNSUBSCRIBE_SECRET` raw, while this module trims it.
 *
 * With a cleanly set secret the two are bit-for-bit the same and this function
 * returns `null`. If the deployed secret ever carried a trailing newline (a
 * `fly secrets set` from a pipe, say), the raw and trimmed keys differ and the
 * links minted by the pre-224e069 cron are signed under the raw one. Rejecting
 * those would 400 one-click unsubscribes that are already in real inboxes,
 * which is a CAN-SPAM §316.5 defect, not a cosmetic one. So verification
 * accepts a signature under either normalisation of the operator's own secret.
 *
 * This widens nothing: forging still requires the secret. Minting always uses
 * the canonical trimmed key, so the raw variant is verify-only and the whole
 * branch disappears the moment a whitespace-padded secret is re-set cleanly.
 */
function legacyUntrimmedSecret(): string | null {
  const raw = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || raw === trimmed) return null;
  return raw;
}

/**
 * Mint `<subscriberId>.<signature>`.
 *
 * Throws when the secret is unset — a send site must fail rather than ship
 * mail with a dead unsubscribe link.
 */
export function createUnsubscribeToken(subscriberId: string): string {
  const key = secret();
  if (!key) {
    throw new Error(
      'NEWSLETTER_UNSUBSCRIBE_SECRET is not set - cannot generate unsubscribe tokens. Do not reuse NEXTAUTH_SECRET for this purpose.',
    );
  }
  const signature = createHmac('sha256', key).update(subscriberId).digest('hex');
  return `${subscriberId}.${signature}`;
}

/** Mint a token, or return `null` when the secret is unset. Never throws. */
export function tryCreateUnsubscribeToken(subscriberId: string): string | null {
  try {
    return createUnsubscribeToken(subscriberId);
  } catch {
    return null;
  }
}

/**
 * Verify a subscriber-id token `<subscriberId>.<signature>` and return the
 * subscriber id, or `null`.
 *
 * This is the only verifier for newsletter unsubscribe links; the unsubscribe
 * route imports it rather than keeping its own copy (2026-10-15).
 *
 * Fails closed on a missing secret: an unset secret must never degrade into
 * "accept anything". Comparison is timing-safe.
 */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  if (!token) return null;

  const key = secret();
  if (!key) {
    console.error('[unsubscribe-tokens] NEWSLETTER_UNSUBSCRIBE_SECRET is not set; rejecting all tokens.');
    return null;
  }

  const separator = token.lastIndexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;

  const subscriberId = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = createHmac('sha256', key).update(subscriberId).digest('hex');
  if (hexEquals(signature, expected)) return subscriberId;

  // Compatibility with links minted before the secret was trimmed — see
  // `legacyUntrimmedSecret`. `null` (the normal case) skips this entirely.
  const legacyKey = legacyUntrimmedSecret();
  if (legacyKey) {
    const legacyExpected = createHmac('sha256', legacyKey).update(subscriberId).digest('hex');
    if (hexEquals(signature, legacyExpected)) return subscriberId;
  }

  return null;
}

/** Public base URL for emailed links. */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://lastdonor.org').replace(/\/+$/, '');
}

/** The one-click unsubscribe URL for a token. */
export function unsubscribeUrlForToken(token: string): string {
  return `${appBaseUrl()}/api/v1/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** The one-click unsubscribe URL for a subscriber id, or `null` without a secret. */
export function unsubscribeUrlForSubscriber(subscriberId: string): string | null {
  const token = tryCreateUnsubscribeToken(subscriberId);
  return token ? unsubscribeUrlForToken(token) : null;
}

/**
 * What a send site needs to put an honest opt-out on a message.
 *
 * `url` is an https one-click endpoint when we hold a `newsletter_subscribers`
 * row for the address; otherwise it is a `mailto:` to the published support
 * mailbox. RFC 8058 one-click (`List-Unsubscribe-Post`) is only advertised for
 * the https form, because a mail client must not POST to a mailto.
 */
export type UnsubscribeMechanism = {
  /** Href for the footer link. */
  url: string;
  /** Headers to merge into the Resend `headers` option. */
  headers: Record<string, string>;
  /** True when a signed one-click https endpoint was available. */
  oneClick: boolean;
};

export function mailtoUnsubscribeMechanism(
  mailbox = SUPPORT_MAILBOX,
  subject = 'Unsubscribe',
): UnsubscribeMechanism {
  const url = `mailto:${mailbox}?subject=${encodeURIComponent(subject)}`;
  return { url, headers: { 'List-Unsubscribe': `<${url}>` }, oneClick: false };
}

export function oneClickUnsubscribeMechanism(url: string): UnsubscribeMechanism {
  return {
    url,
    headers: {
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    oneClick: true,
  };
}

/**
 * Best available mechanism for an address.
 *
 * Pass the `newsletter_subscribers.id` when one exists for the address; pass
 * `null` to get the mailto fallback. Never throws.
 */
export function unsubscribeMechanism(subscriberId: string | null | undefined): UnsubscribeMechanism {
  if (subscriberId) {
    const url = unsubscribeUrlForSubscriber(subscriberId);
    if (url) return oneClickUnsubscribeMechanism(url);
  }
  return mailtoUnsubscribeMechanism();
}

// ─── Campaign-update unsubscribe tokens ─────────────────────────────────────
//
// Moved here from `src/app/api/v1/campaigns/[slug]/subscribe/route.ts` on
// 2026-10-15, byte-for-byte: same version string, same signing input, same
// secret resolution order, same hex digest, same timing-safe compare, same
// fail-closed behaviour. The route now imports `verifyCampaignUnsubscribeToken`
// instead of keeping a private copy, and the send sites in
// `src/lib/email-adaptive.ts` can finally mint what the route checks.

/** Purpose + version prefix. Domain-separates the signature; do not change. */
export const CAMPAIGN_TOKEN_VERSION = 'campaign-unsubscribe:v1';

/**
 * The campaign signing key.
 *
 * `CAMPAIGN_UNSUBSCRIBE_SECRET` is preferred; `NEWSLETTER_UNSUBSCRIBE_SECRET`
 * is accepted as a fallback so a deployment that set only one secret still
 * mints working links. Sharing the newsletter secret is safe here *because of*
 * `CAMPAIGN_TOKEN_VERSION`: a newsletter signature covers a bare subscriber
 * id, so it can never be replayed as a campaign token, and vice versa.
 *
 * A whitespace-only value is treated as unset, exactly as `secret()` does, so
 * both mint and verify fail closed rather than signing with a blank-ish key.
 */
export function campaignUnsubscribeSecret(): string | null {
  return (
    process.env.CAMPAIGN_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.NEWSLETTER_UNSUBSCRIBE_SECRET?.trim() ||
    null
  );
}

/**
 * Normalise an address the way the campaign-subscribe route does before it
 * verifies (`parsed.data.email.trim().toLowerCase()`).
 *
 * Minting must apply the identical normalisation or the signature will not
 * match the one the route recomputes, and that mismatch is precisely the class
 * of bug this consolidation exists to prevent.
 */
export function normalizeUnsubscribeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Mint a campaign-unsubscribe token for an exact (campaignId, email) pair.
 *
 * `campaignId` is the campaigns table UUID, never the slug: the route resolves
 * the slug to an id and verifies against the id.
 *
 * The inputs are signed verbatim, so callers that will hand the token to the
 * route must pass an already-normalised address (see
 * `normalizeUnsubscribeEmail`, which `campaignUnsubscribeMechanism` applies).
 *
 * Throws when no secret is configured. Send sites that must not throw should
 * use `tryCreateCampaignUnsubscribeToken` or `campaignUnsubscribeMechanism`.
 */
export function createCampaignUnsubscribeToken(campaignId: string, email: string): string {
  const key = campaignUnsubscribeSecret();
  if (!key) {
    throw new Error(
      'Neither CAMPAIGN_UNSUBSCRIBE_SECRET nor NEWSLETTER_UNSUBSCRIBE_SECRET is set - cannot generate campaign unsubscribe tokens.',
    );
  }
  return createHmac('sha256', key)
    .update(`${CAMPAIGN_TOKEN_VERSION}:${campaignId}:${email}`)
    .digest('hex');
}

/** Mint a campaign token, or return `null` when no secret is set. Never throws. */
export function tryCreateCampaignUnsubscribeToken(
  campaignId: string,
  email: string,
): string | null {
  try {
    return createCampaignUnsubscribeToken(campaignId, email);
  } catch {
    return null;
  }
}

/**
 * Verify a campaign-unsubscribe token against (campaignId, email).
 *
 * Fails closed on a missing secret. Comparison is timing-safe. The token is
 * trimmed before comparison because it arrives from a query string or a JSON
 * body, where a stray newline is a transport artefact rather than a forgery.
 */
export function verifyCampaignUnsubscribeToken(
  token: string | null | undefined,
  campaignId: string,
  email: string,
): boolean {
  if (!token) return false;

  const key = campaignUnsubscribeSecret();
  if (!key) {
    // Fail closed. A missing secret must never degrade into "accept anything".
    console.error(
      '[unsubscribe-tokens] neither CAMPAIGN_UNSUBSCRIBE_SECRET nor ' +
      'NEWSLETTER_UNSUBSCRIBE_SECRET is set; rejecting all campaign unsubscribe tokens.',
    );
    return false;
  }

  const expected = createHmac('sha256', key)
    .update(`${CAMPAIGN_TOKEN_VERSION}:${campaignId}:${email}`)
    .digest('hex');

  return hexEquals(token.trim(), expected);
}

/**
 * The campaign unsubscribe URL: the `/unsubscribe` page, which `DELETE`s the
 * campaign-subscribe route on the donor's behalf. Returns `null` when no
 * secret is configured, because a link without a token answers 403.
 *
 * `baseUrl` defaults to `appBaseUrl()`; the email templates pass their own
 * `BASE_URL` so this change does not silently move which host emailed links
 * point at.
 */
export function campaignUnsubscribeUrl(p: {
  campaignId: string;
  campaignSlug: string;
  email: string;
  baseUrl?: string;
}): string | null {
  const email = normalizeUnsubscribeEmail(p.email);
  const token = tryCreateCampaignUnsubscribeToken(p.campaignId, email);
  if (!token) return null;

  const base = (p.baseUrl ?? appBaseUrl()).replace(/\/+$/, '');
  const query = new URLSearchParams({
    email,
    campaign: p.campaignSlug,
    token,
  });
  return `${base}/unsubscribe?${query.toString()}`;
}

/**
 * The honest opt-out mechanism for a campaign-update email.
 *
 * With a secret: a signed `/unsubscribe` link that works with no login.
 * Without one: a `mailto:` to the published support mailbox, naming the
 * campaign so the request can be actioned. A mailto is a legitimate
 * List-Unsubscribe mechanism (RFC 8058 §1, RFC 2369), and it is the honest
 * choice here; the alternative is emitting a link that promises one-click
 * unsubscribe and then answers 403, which is the defect being fixed.
 *
 * `oneClick` is **always false**, even for the signed link. `/unsubscribe` is
 * a browser page that needs JavaScript to issue the `DELETE`; it is not a
 * POST-able RFC 8058 endpoint, so `List-Unsubscribe-Post` must not be
 * advertised for it. Never throws.
 */
export function campaignUnsubscribeMechanism(p: {
  campaignId: string;
  campaignSlug: string;
  email: string;
  baseUrl?: string;
}): UnsubscribeMechanism {
  const url = campaignUnsubscribeUrl(p);
  if (url) {
    return { url, headers: { 'List-Unsubscribe': `<${url}>` }, oneClick: false };
  }
  return mailtoUnsubscribeMechanism(
    SUPPORT_MAILBOX,
    `Unsubscribe from campaign updates: ${p.campaignSlug}`,
  );
}
