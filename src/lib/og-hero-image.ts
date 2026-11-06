import sharp from 'sharp';
import { CARD_HEIGHT, HERO_WIDTH } from '@/lib/og-card-metrics';

/**
 * The organiser's photograph, prepared so the share card draws it the way a
 * browser would.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * A phone photographs in one orientation and stores the pixels in another,
 * recording the difference as an EXIF `Orientation` tag. Honouring that tag
 * is the VIEWER's job, and the two viewers this product has disagreed:
 *
 *   [VERIFIED 2026-11-06 on `help-maksym-…`, the campaign reported]
 *   stored object  : 3264x2448, EXIF orientation 8   (landscape pixels)
 *   `/_next/image` : 2448x3264, EXIF absent          (rotation BAKED IN)
 *   the share card : drawn from the stored object    (sideways)
 *
 * So the campaign page showed a father and his son upright, and every share
 * of that page showed them lying on their side. Satori fetches the URL given
 * to `<img src>` and paints the bytes; it reads no EXIF. The page was never
 * wrong - only the card.
 *
 * ⛔ WHY THE FIX IS HERE AND NOT AT THE UPLOAD. Normalising on upload is the
 * deeper fix and it does NOT close this: it cannot reach the photographs
 * already stored, and re-encoding somebody's original on the way in is a
 * write-path change on a live system for a rendering bug. Handing the
 * renderer pixels that need no EXIF fixes every photograph, old and new, and
 * touches nothing anyone has stored. The upload question is recorded in
 * `docs/177` as a separate decision, not silently made here.
 *
 * ⚠️ `.rotate()` WITH NO ARGUMENT is the whole mechanism: it applies the EXIF
 * orientation and strips the tag. [VERIFIED] that yields 2448x3264 with no
 * orientation - byte-for-byte the same geometry `/_next/image` produces, so
 * the card and the page agree by construction rather than by coincidence.
 * ⛔ `.rotate(90)` is a DIFFERENT function - it turns every image a quarter
 * turn whether or not it needs it.
 *
 * ── A SECOND THING THIS BUYS ────────────────────────────────────────────────
 *
 * Satori used to fetch the full-resolution original: [MEASURED] 1,684KB for
 * this one photograph, decoded in full to fill a 456x630 box. It now receives
 * 40KB already cropped to that box.
 */

/** Matches `probeHeroSrc`: a slow photograph must not hold up the card. */
const FETCH_TIMEOUT_MS = 4_000;

/**
 * JPEG quality for the embedded photograph.
 *
 * Deliberately NOT `CARD_JPEG_QUALITY`. That one governs the FINAL card, and
 * this image is re-encoded a second time when the card itself is written, so
 * compressing hard here would compound. 92 is high enough that the second
 * pass is what decides the result.
 */
const HERO_JPEG_QUALITY = 92;

/**
 * Fetch a photograph and return it as a data URL the renderer can draw
 * without consulting EXIF, or `null`.
 *
 * ⛔ EVERY failure answers `null`, which renders the designed fallback panel.
 * That is the same direction `resolveHeroSrc` and `probeHeroSrc` already fail
 * in, and the same direction `resolveCampaignHero` fails in (`docs/170`): a
 * campaign losing its photograph is a small loss, a card that throws
 * mid-stream is the HTTP 502 of `docs/112` §7 and means no card at all.
 */
export async function heroPixels(
  src: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const res = await fetchImpl(src, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;

    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .rotate()
      .resize(HERO_WIDTH, CARD_HEIGHT, { fit: 'cover' })
      .jpeg({ quality: HERO_JPEG_QUALITY })
      .toBuffer();

    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    /*
      sharp throws on anything it cannot decode, so this also catches the
      formats `probeHeroSrc` guards against by content type - a second,
      independent refusal rather than a duplicated one.
    */
    return null;
  }
}
