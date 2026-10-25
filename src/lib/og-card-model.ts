import { formatMoney } from '@/lib/money/format';
import type { DonationPhase } from '@/types';

/**
 * Every decision the share card makes, with no JSX and no database in it.
 *
 * It lives apart from the route for the reason `docs/107` gives: a server
 * route's logic is checked by reading it, because no unit test can reach
 * inside `ImageResponse`. Pulled out here, each rule below is executed by a
 * test - and these rules are about MONEY and about whether a card renders at
 * all, which is not a place to rely on reading.
 */

export interface OgCardInput {
  /** Raised, in the MINOR UNITS OF ITS OWN ROW'S CURRENCY (`docs/92`). */
  raisedMinor: number;
  goalMinor: number;
  /** The campaign's currency. Never assumed to be USD. */
  currency: string;
  donorCount: number;
  heroImageUrl: string | null;
  /** Absolute site origin, for resolving a stored relative hero path. */
  baseUrl: string;
  phase: DonationPhase;
}

export interface OgCardModel {
  /** Absolute image URL, or null when no usable photograph exists. */
  heroSrc: string | null;
  headline: string;
  subline: string;
  barPercent: number;
  barColor: string;
}

const PHASE_COLORS: Record<DonationPhase, string> = {
  first_believers: '#0F766E',
  the_push: '#0F766E',
  closing_in: '#D97706',
  last_donor_zone: '#8B2332',
};

/** Phases worth naming on a card a stranger reads cold. */
const URGENT_PHASES: ReadonlySet<DonationPhase> = new Set<DonationPhase>([
  'closing_in',
  'last_donor_zone',
]);

const URGENT_LABELS: Partial<Record<DonationPhase, string>> = {
  closing_in: 'Closing in',
  last_donor_zone: 'Last Donor Zone',
};

/**
 * Image media types Satori can actually decode.
 *
 * ⛔ This is an ALLOWLIST on purpose. The first version of this fix was a
 * blocklist holding only `.svg`, because `.svg` was what the two broken
 * production campaigns happened to store - and rendering the card locally
 * immediately produced `Unsupported image type: image/webp` from a fixture
 * hero. A blocklist can only ever contain the formats somebody has already
 * been burned by, and `src/lib/supabase-storage.ts:149` ACCEPTS
 * `image/webp` and `image/avif` on upload, so an organiser's own photograph
 * could have put the card straight back to a 502.
 */
export const SATORI_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
]);

/**
 * Extensions known to be undecodable, rejected without a network call.
 *
 * This is only a fast path - the content-type probe below is what actually
 * decides, because production heroes include Unsplash URLs with NO extension
 * at all (`.../photo-1486551937199-baf066858de7?w=800`), so an extension
 * allowlist would reject images that work today.
 */
const UNSUPPORTED_EXTENSIONS = ['.svg', '.webp', '.avif', '.bmp', '.tif', '.tiff'];

/**
 * Resolve the stored hero into something Satori can plausibly fetch, or
 * `null` to say "render the designed fallback instead".
 *
 * ⛔ The cases that return null were ALL 502s in production:
 *
 *  - **An SVG or other undecodable format.** Two of the fourteen live
 *    campaigns stored `/images/categories/veterans-default.svg`, and their
 *    card was an HTTP 502 - so every platform showed a text-only preview
 *    with no picture at all.
 *  - **Anything that is not http(s) after resolution** - a `data:` URI, a
 *    `supabase-private://` reference (`docs/88` F2), or an empty string.
 *
 * A relative path is NOT a failure: it is resolved against the site origin,
 * which is what the old code should have done.
 */
export function resolveHeroSrc(heroImageUrl: string | null, baseUrl: string): string | null {
  const raw = (heroImageUrl ?? '').trim();
  if (!raw) return null;

  const absolute = /^https?:\/\//i.test(raw)
    ? raw
    : raw.startsWith('/')
      ? `${baseUrl.replace(/\/+$/, '')}${raw}`
      : null;

  if (!absolute) return null;
  // Query strings are common on stock photos, so test the path, not the URL.
  const path = absolute.split('?')[0].toLowerCase();
  if (UNSUPPORTED_EXTENSIONS.some((ext) => path.endsWith(ext))) return null;
  return absolute;
}

/**
 * Ask the image what it actually is, and return it only if Satori can
 * decode it.
 *
 * ⛔ The extension cannot answer this. Production stores Unsplash URLs with
 * no extension and Supabase objects whose type is set by the uploader, and
 * `ImageResponse` does not fail gracefully on an unsupported type - it
 * throws mid-stream (`failed to pipe response`), which is the HTTP 502.
 *
 * Every failure answers `null`, which renders the designed fallback panel.
 * A share card without a photograph is a small loss; a share card that is a
 * 502 is no card at all.
 */
export async function probeHeroSrc(
  src: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2_500,
): Promise<string | null> {
  try {
    const res = await fetchImpl(src, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return SATORI_IMAGE_TYPES.has(type) ? src : null;
  } catch {
    return null;
  }
}

export function ogCardModel(input: OgCardInput): OgCardModel {
  const { raisedMinor, goalMinor, currency, donorCount, phase } = input;

  const barPercent =
    goalMinor > 0 ? Math.min(Math.round((raisedMinor / goalMinor) * 100), 100) : 0;

  const goalText = `${formatMoney(goalMinor, currency)} goal`;

  /*
    The zero state is the common case, not the edge case: every campaign on
    the platform has raised nothing (`docs/72`). Printing "$0.00 raised · 0
    donors" made the most discouraging fact about a campaign the headline of
    every share of it. The product's own wording for this state is "Be the
    first to donate" (`docs/71`), so the card says that.
  */
  if (raisedMinor <= 0) {
    return {
      heroSrc: resolveHeroSrc(input.heroImageUrl, input.baseUrl),
      headline: 'Be the first to donate',
      subline: goalText,
      barPercent: 0,
      barColor: PHASE_COLORS[phase],
    };
  }

  const donors = `${donorCount} ${donorCount === 1 ? 'donor' : 'donors'}`;
  const urgency = URGENT_PHASES.has(phase) ? `  ·  ${URGENT_LABELS[phase]}` : '';

  return {
    heroSrc: resolveHeroSrc(input.heroImageUrl, input.baseUrl),
    headline: `${formatMoney(raisedMinor, currency)} raised`,
    subline: `of ${goalText}  ·  ${donors}${urgency}`,
    barPercent,
    barColor: PHASE_COLORS[phase],
  };
}
