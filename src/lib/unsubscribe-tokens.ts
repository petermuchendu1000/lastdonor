/**
 * Newsletter unsubscribe tokens — single source of truth.
 *
 * ## Why this module exists
 *
 * The mint/verify pair was duplicated: `createUnsubscribeToken` lived in
 * `src/app/api/v1/cron/send-newsletter/route.ts` and a byte-compatible
 * `verifyUnsubscribeToken` lived in
 * `src/app/api/v1/newsletter/unsubscribe/route.ts`, with a comment in the
 * latter noting that extracting it needed a new `src/lib/` module. This is
 * that module. Any site that sends marketing mail must be able to mint a
 * working unsubscribe link without copying crypto.
 *
 * ## Token format (unchanged — links already in inboxes keep working)
 *
 *   token = `<subscriberId>.<hex hmac-sha256(NEWSLETTER_UNSUBSCRIBE_SECRET, subscriberId)>`
 *
 * The format carries no expiry and is not single-use. Both are deliberate and
 * already documented on the unsubscribe route: an unsubscribe link that stops
 * working is itself a compliance defect, and single-use redemption state needs
 * a migration (frozen — see CLAUDE.md). Replay is harmless because the
 * operation is idempotent and terminal.
 *
 * `NEWSLETTER_UNSUBSCRIBE_SECRET` is required. There is deliberately no
 * fallback to `NEXTAUTH_SECRET`: reusing the session secret for a public,
 * never-expiring, emailed token widens its blast radius.
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

function secret(): string | null {
  return process.env.NEWSLETTER_UNSUBSCRIBE_SECRET?.trim() || null;
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
 * Verify `<subscriberId>.<signature>` and return the subscriber id.
 *
 * Fails closed on a missing secret: an unset secret must never degrade into
 * "accept anything".
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
  return hexEquals(signature, expected) ? subscriberId : null;
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

export function mailtoUnsubscribeMechanism(mailbox = SUPPORT_MAILBOX): UnsubscribeMechanism {
  const url = `mailto:${mailbox}?subject=Unsubscribe`;
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
