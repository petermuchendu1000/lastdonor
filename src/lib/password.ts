/**
 * Pepper-enhanced password hashing.
 *
 * Pre-hashes the password with HMAC-SHA256 using a server-side pepper before
 * bcrypt. This means a database-only breach is useless without the pepper,
 * which lives only in env vars (never in the database).
 *
 * HMAC-SHA256 output is 64 hex chars (64 bytes ASCII) which is within bcrypt's
 * 72-byte input limit, so no truncation occurs.
 *
 * When PASSWORD_PEPPER is not set (local dev without it configured), falls
 * back to raw bcrypt with a warning. In production, absence is a fatal error.
 */
import bcrypt from 'bcryptjs';
import { createHash, createHmac } from 'crypto';

const BCRYPT_ROUNDS = 12;

function preHash(password: string): string {
  const pepper = process.env.PASSWORD_PEPPER;

  if (!pepper) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'PASSWORD_PEPPER must be set in production. ' +
        'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    // Dev fallback: no pepper (bcrypt-only, matches legacy behaviour)
    return password;
  }

  if (pepper.length < 32) {
    throw new Error('PASSWORD_PEPPER must be at least 32 characters.');
  }

  return createHmac('sha256', pepper).update(password).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(preHash(password), BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(preHash(password), hash);
}

/**
 * Check a password against a legacy (unpeppered) bcrypt hash.
 * Used only to detect whether a user still has a pre-pepper hash so we can
 * force them through the password-reset flow.  Never used to grant access.
 */
export async function verifyLegacyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/* ── Breach checking ─────────────────────────────────────────────────────────
 *
 * Lifted out of `src/app/api/auth/register/route.ts`, where it was a private
 * module-level function, so that password RESET enforces the same bar as
 * registration. Before this, a user who had been locked out or phished could
 * reset *to* a password known to be in a public breach corpus and the platform
 * would accept it (docs/29 P3).
 */

/** How long to wait on the HIBP range API before giving up (ms). */
const HIBP_TIMEOUT_MS = 3000;

/**
 * Shown to the user when `checkPwnedPassword` returns true. Shared so the
 * register and reset-password routes cannot drift into saying different things
 * about the same rule.
 */
export const BREACHED_PASSWORD_MESSAGE =
  'This password has appeared in a data breach. Please choose a different password.';

/**
 * Check a password against HaveIBeenPwned using the k-anonymity model.
 *
 * SHA-1 the password, send only the first 5 hex characters as a range prefix,
 * and look for our suffix in the response. The full hash never leaves this
 * process and the plaintext never leaves it either.
 *
 * Fails OPEN on timeout, network error or any non-200: a third-party API being
 * down must not block a user from registering or from recovering their
 * account. The trade-off is explicit — availability over this one check.
 */
export async function checkPwnedPassword(password: string): Promise<boolean> {
  try {
    const hashHex = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    });

    if (!response.ok) return false; // Fail open - don't block the user.

    const text = await response.text();
    return text.split('\n').some((line) => line.startsWith(suffix));
  } catch {
    // Network error / timeout - fail open.
    return false;
  }
}
