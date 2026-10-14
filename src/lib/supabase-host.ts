/**
 * The hostname of our Supabase project, derived from configuration.
 *
 * Why this module exists: three call sites — `next.config.ts`
 * `images.remotePatterns`, the `layout.tsx` preconnect hints, and the image
 * allowlist in `src/lib/validators/url-allowlist.ts` — each hardcoded
 * `ntnrcedafgmeyajmzvga.supabase.co`. Verified 2026-10-14: that project is not
 * in this account (`docs/33` §1, `docs/35` §5 item 1), so every campaign image
 * would 404 and every upload URL would fail the SSRF guard.
 *
 * Deriving the host from the same variable the Supabase client already reads
 * means it cannot drift from the project the app is actually pointed at.
 */

/**
 * Used when neither variable is set — local `next build` without an env file,
 * and unit tests. Verified 2026-10-14 as the only project in this account.
 */
export const FALLBACK_SUPABASE_HOST = 'vavxdjqufxrsbyohcwdh.supabase.co';

/** Extract the hostname from a Supabase project URL. Never throws. */
export function supabaseHostFrom(url: string | undefined | null): string {
  if (!url) return FALLBACK_SUPABASE_HOST;
  try {
    return new URL(url).hostname || FALLBACK_SUPABASE_HOST;
  } catch {
    return FALLBACK_SUPABASE_HOST;
  }
}

/**
 * Static `process.env` member reads, so Next inlines the `NEXT_PUBLIC_` value
 * at build time for any client bundle that reaches this module through
 * `url-allowlist.ts`. A dynamic lookup would be `undefined` in the browser.
 */
export const SUPABASE_HOST = supabaseHostFrom(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
);

/** The public-object prefix the image optimiser is allowed to fetch. */
export const SUPABASE_PUBLIC_OBJECT_PATHNAME = '/storage/v1/object/public/**';
