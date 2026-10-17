/**
 * Phone numbers, normalised once so everything downstream can trust them.
 *
 * Written ahead of the Africa's Talking integration because every
 * capability it offers - SMS, OTP, USSD, mobile money - sends to an E.164
 * number, and this codebase did not have one. `users.phone` is free text
 * that only an admin can edit, has never been validated or normalised, and
 * is read by nothing. Sending to it would be sending to whatever somebody
 * typed. See `docs/82`.
 *
 * ── Why a library ─────────────────────────────────────────────────────────
 *
 * `libphonenumber-js`, not a regex. African numbering plans are not
 * uniform: Kenya is 9 digits after +254 with a leading 0 locally, Nigeria
 * is 10 after +234, and both have operator prefixes that move. A regex that
 * looks right for Kenya silently accepts nonsense for Uganda. Spot-checked
 * against the library on 2026-10-17:
 *
 *   0712345678      + region KE  -> +254712345678  (KE)
 *   +254712345678                -> +254712345678  (KE)
 *   +2348012345678               -> +2348012345678 (NG)
 *   '0712 345 678'  + region KE  -> +254712345678  (KE)
 *   +254712345                   -> INVALID (too short)
 *   +15551234567                 -> INVALID (555 is a reserved US range)
 *
 * That last one is worth keeping: the library is strict enough to reject a
 * number that *looks* well-formed, which a length check would have passed.
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * The region used to read a number typed without a country code.
 *
 * Configurable, and defaulting to Kenya because that is where the SMS
 * provider operates. Noted rather than hidden: the Organization schema in
 * `src/app/layout.tsx` says `areaServed: United States`, so a US-facing
 * platform is acquiring a Kenyan-default phone pipeline. A number typed as
 * `0712345678` is Kenyan here and would be nothing in the US. That tension
 * is real and belongs to whoever decides which markets this serves - this
 * constant is where it gets resolved, not somewhere in a form handler.
 */
export const DEFAULT_REGION = (process.env.SMS_DEFAULT_REGION ?? 'KE') as CountryCode;

export interface NormalisedPhone {
  /** `+254712345678`. The only form anything should store or send to. */
  e164: string;
  /** ISO country, for reporting and for knowing which rules apply. */
  country: CountryCode | undefined;
}

/**
 * Normalise anything a person typed into E.164, or `null`.
 *
 * `null` rather than a throw: an unusable number is an ordinary outcome of
 * a text input, not an exceptional one, and every caller has to handle it
 * anyway.
 */
export function normalisePhone(
  input: string | null | undefined,
  region: CountryCode = DEFAULT_REGION,
): NormalisedPhone | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  let parsed;
  try {
    // A number already carrying `+` is read on its own terms; the region
    // is only a fallback for a locally-typed one.
    parsed = parsePhoneNumberFromString(trimmed, trimmed.startsWith('+') ? undefined : region);
  } catch {
    // The library throws on some malformed input rather than returning
    // undefined. Both mean the same thing here.
    return null;
  }

  if (!parsed || !parsed.isValid()) return null;

  return { e164: parsed.number, country: parsed.country };
}

/** True when the input normalises to a number worth sending to. */
export function isSendablePhone(
  input: string | null | undefined,
  region: CountryCode = DEFAULT_REGION,
): boolean {
  return normalisePhone(input, region) !== null;
}

/**
 * `+254712345678` -> `+254 7•• ••• 678`, for logs, admin screens and
 * support conversations.
 *
 * A phone number is personal data. It appears in audit rows and error logs
 * that are read by people who do not need the whole thing, so there is one
 * masking function rather than each call site inventing a slice. Keeps the
 * country code and the last three digits: enough for a human to confirm
 * "yes, that is my number", not enough to dial it.
 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';

  const match = /^(\+\d{1,3})(\d+)$/.exec(e164.trim());
  if (!match) return '•••';

  const [, cc, rest] = match;
  if (rest.length <= 3) return `${cc}${'•'.repeat(rest.length)}`;

  const tail = rest.slice(-3);
  const hidden = '•'.repeat(rest.length - 3);
  return `${cc} ${hidden}${tail}`;
}
