/**
 * The share card's decisions.
 *
 * Two of these rules were HTTP 502s in production and one was a money bug
 * waiting for the first KES campaign, so they are executed here rather than
 * read - `docs/107` is the doc about an admin page whose query nothing ran.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { ogCardModel, probeHeroSrc, resolveHeroSrc } from '@/lib/og-card-model';

/**
 * `Intl.NumberFormat` separates a multi-character currency symbol with a
 * NON-BREAKING space (U+00A0), so `'Ksh 12,500'` typed here is not the
 * string it produces. Normalised rather than pasted invisibly, so the
 * assertion stays readable.
 */
const norm = (s: string) => s.replace(/\u00a0/g, ' ');

const BASE = 'https://lastdonor.org';

const card = (over: Partial<Parameters<typeof ogCardModel>[0]> = {}) =>
  ogCardModel({
    raisedMinor: 0,
    goalMinor: 3_500_000,
    currency: 'USD',
    donorCount: 0,
    heroImageUrl: 'https://img.example/photo.jpg',
    baseUrl: BASE,
    phase: 'first_believers',
    ...over,
  });

describe('resolveHeroSrc - the two shapes that answered 502', () => {
  it('⛔ refuses an SVG, which Satori cannot render through <img>', () => {
    // harold-jennings and david-l-jones, 2 of 14 live campaigns, 2026-10-25.
    expect(resolveHeroSrc('/images/categories/veterans-default.svg', BASE)).toBeNull();
    expect(resolveHeroSrc('https://cdn.example/x.SVG', BASE)).toBeNull();
  });

  it('⛔ refuses every format Satori cannot decode, not just the one that bit us', () => {
    /*
      The first version of this fix blocked `.svg` alone, because `.svg` was
      what the two broken campaigns stored. Rendering the card locally then
      produced `Unsupported image type: image/webp` from a fixture hero -
      and uploads ACCEPT webp and avif (`supabase-storage.ts:149`), so an
      organiser's own photograph could have restored the 502.
    */
    for (const ext of ['webp', 'avif', 'bmp', 'tif', 'tiff']) {
      expect(resolveHeroSrc(`https://cdn.example/photo.${ext}`, BASE), ext).toBeNull();
    }
  });

  it('resolves a relative path against the site origin instead of failing', () => {
    expect(resolveHeroSrc('/campaign-photos/a.jpg', BASE))
      .toBe('https://lastdonor.org/campaign-photos/a.jpg');
  });

  it('does not double the slash when the base carries one', () => {
    expect(resolveHeroSrc('/a.jpg', 'https://lastdonor.org/'))
      .toBe('https://lastdonor.org/a.jpg');
  });

  it('passes an absolute https URL through untouched', () => {
    const u = 'https://images.unsplash.com/photo-1486551937199-baf066858de7?w=800';
    expect(resolveHeroSrc(u, BASE)).toBe(u);
  });

  it('judges the PATH, not the URL, so a query string cannot hide the type', () => {
    // `...photo.jpg?w=800` must survive; `...thing.svg?v=2` must not.
    expect(resolveHeroSrc('https://c/photo.jpg?w=800', BASE)).toBe('https://c/photo.jpg?w=800');
    expect(resolveHeroSrc('https://c/thing.svg?v=2', BASE)).toBeNull();
  });

  it('refuses anything that is not http(s) after resolution', () => {
    expect(resolveHeroSrc('', BASE)).toBeNull();
    expect(resolveHeroSrc('   ', BASE)).toBeNull();
    expect(resolveHeroSrc(null, BASE)).toBeNull();
    // A private storage reference, the `docs/88` F2 shape.
    expect(resolveHeroSrc('supabase-private://media/doc.pdf', BASE)).toBeNull();
    expect(resolveHeroSrc('data:image/png;base64,AAAA', BASE)).toBeNull();
  });
});

describe('probeHeroSrc - the extension cannot answer this', () => {
  const head = (status: number, type: string | null) =>
    (async () => ({
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? type : null) },
    })) as unknown as typeof fetch;

  it('accepts a JPEG served from an extensionless URL', async () => {
    // The real Unsplash shape: .../photo-1486551937199-baf066858de7?w=800
    const u = 'https://images.unsplash.com/photo-148655?w=800';
    await expect(probeHeroSrc(u, head(200, 'image/jpeg'))).resolves.toBe(u);
  });

  it('⛔ rejects a WebP that no extension would have revealed', async () => {
    await expect(probeHeroSrc('https://cdn/x', head(200, 'image/webp'))).resolves.toBeNull();
  });

  it('tolerates a charset parameter and odd casing on the type', async () => {
    const u = 'https://cdn/x';
    await expect(probeHeroSrc(u, head(200, 'IMAGE/PNG; charset=binary'))).resolves.toBe(u);
  });

  it('answers null rather than throwing when the image is unreachable', async () => {
    const boom = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(probeHeroSrc('https://cdn/x', boom)).resolves.toBeNull();
    await expect(probeHeroSrc('https://cdn/x', head(404, 'image/jpeg'))).resolves.toBeNull();
    await expect(probeHeroSrc('https://cdn/x', head(200, null))).resolves.toBeNull();
  });
});

describe('the zero state, which is every live campaign', () => {
  it('never prints a zero amount or a zero donor count', () => {
    const m = card({ raisedMinor: 0, donorCount: 0 });

    expect(m.headline).toBe('Be the first to donate');
    expect(m.subline).toBe('$35,000 goal');
    // The failure being prevented: "$0.00 raised · 0 donors" on every share.
    expect(`${m.headline} ${m.subline}`).not.toMatch(/\$0|0 donors/);
    expect(m.barPercent).toBe(0);
  });
});

describe('money is the row\'s own currency, never dollars by assumption', () => {
  it('renders a KES campaign in shillings', () => {
    // docs/92: every amount column is in the MINOR units of its row's
    // currency. The old card called `centsToDollars`, which hardcodes USD.
    const m = card({ currency: 'KES', goalMinor: 5_000_000, raisedMinor: 1_250_000, donorCount: 3 });

    // `formatMoney` renders KES with the Kenyan symbol, not the ISO code.
    expect(norm(m.headline)).toBe('Ksh 12,500 raised');
    expect(m.headline).not.toContain('$');
    expect(m.subline).not.toContain('$');
  });

  it('renders whole units, not cents, on a round goal', () => {
    // "$0.00 of $35,000.00" was what production printed.
    expect(card().subline).toBe('$35,000 goal');
  });
});

describe('a funded campaign states what it has', () => {
  it('leads with the amount raised and names the goal and donors', () => {
    const m = card({ raisedMinor: 1_470_000, goalMinor: 3_500_000, donorCount: 86, phase: 'the_push' });

    expect(m.headline).toBe('$14,700 raised');
    expect(m.subline).toBe('of $35,000 goal  ·  86 donors');
    expect(m.barPercent).toBe(42);
  });

  it('says "1 donor", not "1 donors"', () => {
    expect(card({ raisedMinor: 5_000, donorCount: 1 }).subline).toContain('1 donor');
    expect(card({ raisedMinor: 5_000, donorCount: 1 }).subline).not.toContain('1 donors');
  });

  it('names urgency only when it means something to a cold reader', () => {
    // "First Believers" tells a stranger nothing; "Last Donor Zone" does.
    const quiet = card({ raisedMinor: 100, phase: 'first_believers' });
    const push = card({ raisedMinor: 100, phase: 'the_push' });
    const near = card({ raisedMinor: 3_400_000, phase: 'closing_in' });
    const last = card({ raisedMinor: 3_490_000, phase: 'last_donor_zone' });

    expect(quiet.subline).not.toMatch(/Believers|Push/);
    expect(push.subline).not.toMatch(/Believers|Push/);
    expect(near.subline).toContain('Closing in');
    expect(last.subline).toContain('Last Donor Zone');
  });
});

describe('the progress bar cannot produce an impossible width', () => {
  it('caps at 100 when a campaign is over its goal', () => {
    expect(card({ raisedMinor: 9_000_000, goalMinor: 3_500_000 }).barPercent).toBe(100);
  });

  it('is 0 rather than NaN or Infinity when the goal is zero', () => {
    // A width of `NaN%` or `Infinity%` is what reaches the renderer.
    const m = card({ raisedMinor: 1_000, goalMinor: 0 });
    expect(m.barPercent).toBe(0);
    expect(Number.isFinite(m.barPercent)).toBe(true);
  });
});
