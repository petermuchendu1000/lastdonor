import { z } from 'zod';
import { ACCOUNT_REFERENCE_RANDOM_CHARS, MAX_ACCOUNT_REFERENCE } from '@/lib/palpluss';
import { LASTDONOR_REFERENCE_PREFIX } from '@/lib/payhero';

/**
 * The exact shape `mintAccountReference()` produces: `LD-` plus
 * `ACCOUNT_REFERENCE_RANDOM_CHARS` base32 characters.
 *
 * ⛔ DERIVED from the minting constants, not written out. The length exists
 * only because Palpluss documents `accountReference` as
 * `MAX_ACCOUNT_REFERENCE` characters (`docs/182` §3.1), so a literal `{9}`
 * here would silently stop matching the day that limit moves — and a schema
 * that no longer matches what we mint refuses every real poll.
 */
const REFERENCE_PATTERN = new RegExp(
  `^${LASTDONOR_REFERENCE_PREFIX}[A-Z2-7]{${ACCOUNT_REFERENCE_RANDOM_CHARS}}$`,
);

/**
 * The query of `GET /api/v1/donations/palpluss/status`.
 *
 * ── Why this is not `payheroStatusQuerySchema` ────────────────────────────
 *
 * The *principle* is identical and is stated there: a caller may ask only
 * about OUR reference, resolved against a row this platform wrote. What
 * differs is the shape. A PayHero reference is `LD-<uuid>`, so that schema
 * bounds the length and nothing more; a Palpluss reference is exactly
 * `MAX_ACCOUNT_REFERENCE` characters because the gateway documents that
 * limit, so the whole value can be pinned.
 *
 * ⛔ And pinning it is worth doing rather than reusing a looser schema. This
 * reference carries only **45 bits** (`docs/182` §3.1) — forced by that
 * 12-character limit, not chosen — so the cheapest possible refusal of
 * anything that is not one of ours is wanted, before a database lookup and
 * well before any outbound call. A value that cannot have been minted here
 * is answered 400 without touching a row.
 *
 * ⛔ Palpluss's own transaction id is never accepted. It is the key to
 * `GET /v1/transactions/{id}` on a tenant that may be shared with another
 * product, and a blank or traversing id reads that whole ledger with HTTP 200
 * (`docs/180` finding 1). The poll resolves our reference to a row and reads
 * the gateway id from it, so a caller can only ever ask about its own
 * payment.
 */
export const palplussStatusQuerySchema = z.object({
  reference: z
    .string()
    .trim()
    .length(MAX_ACCOUNT_REFERENCE, 'That is not a payment reference')
    .regex(REFERENCE_PATTERN, 'That is not a payment reference'),
});

export type PalplussStatusQuery = z.infer<typeof palplussStatusQuerySchema>;
