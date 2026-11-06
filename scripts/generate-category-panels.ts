/**
 * Generate the branded category panels used as campaign hero images.
 *
 * ── WHY THESE EXIST ─────────────────────────────────────────────────────────
 *
 * [VERIFIED 2026-11-04 from the live listing] 8 of 10 published campaigns
 * rendered a photograph of somebody who is not the person named beside it:
 * 7 Unsplash stock photos and 1 generic category SVG. Two were plainly wrong
 * - a toddler holding a toy camera under "Keisha Wallace Fights to Keep Her
 * Four Kids Off Atlanta Streets", and a male doctor under "Help Danielle
 * Sutton Care for Her Twins While Battling Aggressive MS".
 *
 * `docs/141` §5 raised that as an owner question and it was left open.
 * Owner decision 2026-11-04: a campaign that has no photograph FROM ITS
 * ORGANISER shows a designed brand panel instead, which depicts nobody.
 *
 * ── WHY A RASTER FILE AND NOT AN SVG OR A COMPONENT ─────────────────────────
 *
 * Three constraints, each of which rules something out:
 *
 *  1. It must be an INDEXABLE IMAGE. The stated goal is that these appear in
 *     Google Images for the brand, and Google indexes images, not DOM. A
 *     CSS-drawn panel would look identical on the page and be invisible there.
 *  2. The text must not depend on an installed font. `docs/95` had to convert
 *     the BIMI wordmark to outlines for exactly this reason, and the panels
 *     these replace used `font-family="system-ui"` plus an emoji glyph - so
 *     they rendered in an arbitrary face on Linux and Android. Rasterising
 *     here bakes in the real DM Serif Display outlines.
 *  3. It must not be rendered per request. `docs/112` §7 recorded
 *     `ImageResponse` throwing mid-stream and answering HTTP 502; a listing
 *     page draws twelve of these at once, so a route per card is a
 *     twelve-fold chance of that on the busiest public surface.
 *
 * ── WHICH TOOL DOES WHICH HALF ──────────────────────────────────────────────
 *
 * `sharp` applies the duotone and Chromium sets the type. That split is
 * deliberate: a CSS `mix-blend-mode` duotone depends on headless Chromium
 * reproducing a blend mode exactly, whereas the ramp below is arithmetic that
 * can be read and checked. Chromium is here for the one thing it is the only
 * option for - laying out real DM Serif Display outlines.
 *
 * ── RUN ─────────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/generate-category-panels.ts            # all 23 x 3
 *   npx tsx scripts/generate-category-panels.ts --only medical,veterans
 *   npx tsx scripts/generate-category-panels.ts --out /tmp/preview
 *
 * Needs network access to `images.unsplash.com` on a cold run; source
 * photographs are cached under the OS temp dir, so a second run is offline.
 *
 * The category list is DERIVED from `CATEGORY_CONTENT`, so a 24th category
 * generates panels without this file being edited, and the variant count is
 * IMPORTED from the app - see `PLATE_VARIANTS` below.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CATEGORY_CONTENT } from '@/lib/category-content';
import { PLATE_VARIANTS } from '@/lib/campaign-hero';

/** Matches the OG card (`api/v1/og/page/route.tsx`) so the brand reads as one system. */
const AMBER = '#D97706';

type Rgb = readonly [number, number, number];

/**
 * Four two-point ramps from one cool family, assigned by category position.
 *
 * A duotone maps every grey value onto the line between two colours:
 * `out = dark + (light - dark) * grey/255`. So `dark` is what the shadows
 * become and `light` is what the highlights become, and the whole photograph
 * ends up inside the brand palette with nothing left of its own colour.
 *
 * ⚠️ The variation is VISUAL ONLY and encodes nothing - a reader cannot
 * decode "the bluer one means memorial", and no copy anywhere claims they
 * can. It exists because a search-results grid of identical rectangles reads
 * as one repeated image rather than a set.
 *
 * ⚠️ These are hand-picked pairs, not a mix of one tone toward black and
 * white. A uniform mix gives highlights that stay fully saturated, which
 * reads as a colour wash laid over a photo rather than a photo printed in
 * one ink.
 */
const RAMPS: readonly { readonly dark: Rgb; readonly light: Rgb }[] = [
  { dark: [6, 46, 44], light: [94, 182, 170] }, // teal
  { dark: [10, 43, 51], light: [91, 175, 196] }, // cyan
  { dark: [12, 42, 36], light: [111, 184, 154] }, // green-teal
  { dark: [18, 42, 46], light: [116, 179, 184] }, // slate-teal
];

const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const rgb = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`;

/**
 * ── THE PHOTOGRAPHIC BACKDROP (owner decision 2026-11-06) ───────────────────
 *
 * The flat-colour plates these replace were measured on the live grid: 8 of
 * 10 cards were a near-identical teal rectangle and three of them were
 * byte-identical, which reads as an unfinished site rather than a design.
 * At the 112px phone thumbnail a flat panel reads as a failed image load,
 * because nothing in it is an image.
 *
 * ⛔ THE ONE LINE THESE MAY NOT CROSS: no identifiable person. That is not
 * only `docs/170`'s trust rule - the Pexels licence says it outright
 * ("Identifiable people may not appear in a bad light or in a way that is
 * offensive", "Don't imply endorsement of your product by people or brands
 * on the imagery"), so the portraits `docs/170` removed were never licensed
 * either. Every image below was inspected at 420px and again zoomed; three
 * candidates were REJECTED for exactly this - two had people in boats and
 * on a rock that the contact sheet was too small to show.
 *
 * ⚠️ And no signage. A hospital reception shot was rejected because its
 * Spanish wayfinding ("PISO 1", "BANCO DE SANGRE") stayed legible through
 * the duotone - a literal photograph carries specifics that can contradict
 * the appeal it sits above.
 *
 * ⚠️ The pool is SHARED across categories rather than illustrating each one.
 * A field at dawn is honest under Medical, Memorial or Education alike; a
 * picture that tries to depict the category is what drags in the signage and
 * the specifics. The category is carried by the WORD, not the photograph.
 *
 * Unsplash grants "download, copy, modify, distribute, perform, and use"
 * [https://unsplash.com/license, read 2026-11-06], so the treatment below is
 * licensed. Attribution is appreciated and not required; the plates are
 * nonetheless captioned, because the caption is what tells a reader the
 * picture is not of this campaign.
 */
const MOOD_POOL = [
  'photo-1418065460487-3e41a6c84dc5', // mist over conifers
  'photo-1428592953211-077101b2021b', // rain on water
  'photo-1434725039720-aaad6dd32dfe', // grass plain at first light
  'photo-1439853949127-fa647821eba0', // still lake under cliffs
  'photo-1441974231531-c6227db76b6e', // sunlight down a forest path
  'photo-1444927714506-8492d94b4e3d', // blue ridges in haze
  'photo-1447752875215-b2761acb3c5d', // boardwalk into trees
  'photo-1458668383970-8ddd3927deed', // peaks above cloud
  'photo-1470071459604-3b5ec3a7fe05', // escarpment at sunset
  'photo-1475924156734-496f6cac6ec1', // shoreline at dusk
  'photo-1500382017468-9049fed747ef', // wheat field, low sun
  'photo-1501854140801-50d01698950b', // green hills
  'photo-1506744038136-46273834b3fb', // river valley in mist
] as const;

/**
 * One line at the foot of every plate.
 *
 * ⛔ The disclosure and the brand mark share a line ON PURPOSE. The claim
 * being made is *LastDonor says this photograph is illustrative*, and putting
 * the two on separate lines invites somebody to drop the second one later as
 * clutter. A reader cannot see this at the 112px thumbnail - nobody can, it
 * is 4px there - and that is fine: the mistake it guards against (reading the
 * picture as this family's own) is only available on a surface big enough to
 * look at the picture.
 *
 * ⚠️ The alt text does NOT repeat it. `resolveCampaignHero` names a panel
 * "LastDonor <Category> campaign", which already says the image is the
 * platform's, so adding "illustrative photo" there would describe the file
 * rather than the thing in it.
 */
const FOOTER = 'lastdonor.org · illustrative photo';

const WIDTH = 1200;
const HEIGHT = 675;

/**
 * ⛔ THE COMPOSITION IS CENTRED BECAUSE THE IMAGE GETS CROPPED TO A SQUARE.
 *
 * `CampaignsListClient` renders a **112px square** thumbnail with
 * `object-cover`, which keeps the middle and throws away the sides. The
 * first version of these panels was left-aligned like the OG card, and at
 * that size the words read "dical", "erans", "ntial Needs", "mily",
 * "morial" - the start of every label cropped off.
 *
 * The OG card can be left-aligned because it is a fixed 1200x630 that
 * nothing ever crops. These are not, so everything that must survive lives
 * inside the central square: 675px wide, less a margin.
 */
const SAFE_WIDTH = 620;

const ROOT = resolve(__dirname, '..');

function fontDataUrl(file: string): string {
  const buf = readFileSync(join(ROOT, 'public', 'fonts', file));
  return `data:font/truetype;base64,${buf.toString('base64')}`;
}

/**
 * Where source photographs are cached between runs.
 *
 * Cached rather than committed: 13 full-resolution JPEGs are ~4MB of binaries
 * that only this script ever reads, and the plates it produces ARE committed,
 * so a checkout needs no network to build or serve the site. Only
 * regenerating does.
 */
const CACHE_DIR = join(tmpdir(), 'lastdonor-mood-pool');

/** Twice the panel, so the browser downscales rather than upscales. */
const SRC_WIDTH = WIDTH * 2;
const SRC_HEIGHT = HEIGHT * 2;

/**
 * Convert a photograph to a two-colour print of itself.
 *
 * ⚠️ `toColourspace('b-w')` is load-bearing, not decoration: `greyscale()`
 * alone leaves THREE equal channels, so a one-byte-per-pixel read of that
 * buffer walks three times as fast as the image and produces stripes. The
 * channel count is asserted rather than assumed.
 *
 * Emits JPEG, not PNG: a duotone is one hue with a luminance ramp, so it has
 * no hard edges to artifact, and a 2400x1350 PNG data URL is several
 * megabytes of base64 handed to `setContent` 69 times.
 */
async function duotoneDataUrl(src: Buffer, ramp: { dark: Rgb; light: Rgb }): Promise<string> {
  const { data: grey, info } = await sharp(src)
    .resize(SRC_WIDTH, SRC_HEIGHT, { fit: 'cover', position: 'attention' })
    .greyscale()
    /*
      ⚠️ `.normalise()` BELONGS HERE AND IS DELIBERATELY ABSENT. The two
      dullest plates look flat, and stretching each photograph's histogram is
      the obvious fix - it is a no-op on this pool. [MEASURED: all four
      sources checked already span grey 0..255, and normalising leaves the
      standard deviation unchanged to one decimal while moving the mean pixel
      by 1.6/255.] The flatness is the SCRIM, which is the legibility
      guarantee, not the photograph. Lighten the scrim if more texture is
      wanted, and re-check contrast against the ramp's light end when you do.
    */
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 1) {
    throw new Error(`expected 1 channel from b-w colourspace, got ${info.channels}`);
  }

  const out = Buffer.alloc(grey.length * 3);
  for (let i = 0, p = 0; i < grey.length; i += 1, p += 3) {
    const t = grey[i] / 255;
    out[p] = Math.round(ramp.dark[0] + (ramp.light[0] - ramp.dark[0]) * t);
    out[p + 1] = Math.round(ramp.dark[1] + (ramp.light[1] - ramp.dark[1]) * t);
    out[p + 2] = Math.round(ramp.dark[2] + (ramp.light[2] - ramp.dark[2]) * t);
  }

  const jpeg = await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** Largest size tried; the fit loop in `main` steps down from here. */
const MAX_LABEL_PX = 128;
const MIN_LABEL_PX = 54;

function panelHtml(
  label: string,
  ramp: { dark: Rgb; light: Rgb },
  photo: string,
  serif: string,
  sans: string,
  labelPx: number,
): string {
  /*
    The scrim is the legibility guarantee, and it is sized against the WORST
    CASE rather than against the photograph in hand: a plate whose highlights
    all land on the light end of the ramp. Two layers compose - a centred
    ellipse behind the word, and a vertical wash that weights the foot of the
    plate where the disclosure sits - and both are mixed from the ramp's own
    dark end, so the scrim can never introduce a colour the duotone does not
    already contain.
  */
  const d = ramp.dark;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'DM Serif Display'; src: url('${serif}') format('truetype'); font-weight: 400; }
  @font-face { font-family: 'DM Sans'; src: url('${sans}') format('truetype'); font-weight: 500; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    background: ${rgb(d)};
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 0 60px;
  }
  .photo {
    position: absolute; inset: 0;
    background-image: url('${photo}');
    background-size: cover;
    background-position: center;
  }
  .scrim {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 60% 54% at 50% 44%, ${rgba(d, 0.8)} 0%, ${rgba(d, 0.46)} 60%, ${rgba(d, 0.14)} 100%),
      linear-gradient(to bottom, ${rgba(d, 0.26)} 0%, ${rgba(d, 0.1)} 38%, ${rgba(d, 0.62)} 100%);
  }
  .stripe { position: absolute; top: 0; left: 0; right: 0; height: 8px; background: ${AMBER}; }
  .label {
    font-family: 'DM Serif Display', serif;
    font-size: ${labelPx}px;
    line-height: 1.08;
    color: #FFFFFF;
    position: relative;
    letter-spacing: -0.01em;
    white-space: nowrap;
    text-align: center;
    text-shadow: 0 2px 18px ${rgba(d, 0.55)};
  }
  .rule { width: 112px; height: 6px; background: ${AMBER}; margin-top: 32px; position: relative; }
  .foot {
    position: absolute; bottom: 48px; left: 0; right: 0; text-align: center;
    font-family: 'DM Sans', sans-serif; font-size: 24px;
    color: rgba(255,255,255,0.82); letter-spacing: 0.01em;
  }
  .foot span { display: inline-block; }
</style></head>
<body>
  <div class="photo"></div>
  <div class="scrim"></div>
  <div class="stripe"></div>
  <div class="label" id="label">${label}</div>
  <div class="rule"></div>
  <div class="foot"><span id="foot">${FOOTER}</span></div>
</body></html>`;
}

async function main() {
  const argv = process.argv.slice(2);
  const onlyArg = argv.indexOf('--only');
  const outArg = argv.indexOf('--out');
  const only =
    onlyArg >= 0 ? new Set(argv[onlyArg + 1].split(',').map((s) => s.trim())) : null;
  const outDir = outArg >= 0 ? resolve(argv[outArg + 1]) : join(ROOT, 'public', 'images', 'categories');

  mkdirSync(outDir, { recursive: true });

  const serif = fontDataUrl('DMSerifDisplay-Regular.ttf');
  const sans = fontDataUrl('DMSans-Medium.ttf');

  const targets = CATEGORY_CONTENT.filter((c) => !only || only.has(c.slug));
  if (targets.length === 0) {
    console.error('No categories matched --only');
    process.exit(1);
  }

  /*
    `PW_CHROMIUM_EXECUTABLE` is this repo's existing convention for pointing
    Playwright at a browser it did not install itself (CLAUDE.md records it
    for the E2E suite). Unset on a normal machine, where the pinned
    @playwright/test has its own download.
  */
  const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  // deviceScaleFactor 2 then a downscale in sharp: supersampling, so the
  // serif edges are clean at the 112px thumbnail the dashboard list uses.
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  });

  /*
    Fetch every source photograph once, before any rendering, so a network
    failure stops the run with nothing half-written. Cached by id, so the
    second run of the day is offline.
  */
  mkdirSync(CACHE_DIR, { recursive: true });
  const sources = new Map<string, Buffer>();
  for (const id of MOOD_POOL) {
    const cached = join(CACHE_DIR, `${id}.jpg`);
    if (existsSync(cached)) {
      sources.set(id, readFileSync(cached));
      console.log(`cache  ${id}`);
      continue;
    }
    const url = `https://images.unsplash.com/${id}?w=${SRC_WIDTH}&q=85&fm=jpg&fit=max`;
    const res = await page.request.get(url, { timeout: 60_000 });
    if (!res.ok()) {
      throw new Error(`${id}: HTTP ${res.status()} from images.unsplash.com`);
    }
    const body = Buffer.from(await res.body());
    writeFileSync(cached, body);
    sources.set(id, body);
    console.log(`fetch  ${id}  ${Math.round(body.length / 1024)}KB`);
  }

  /*
    Each category takes `PLATE_VARIANTS` consecutive photographs from the
    pool, starting one stride further along than the category before it.
    Two SEPARATE properties have to hold, and they are checked separately
    because they fail at different pool sizes and the obvious fix for one is
    not the fix for the other.
  */
  const photoIdFor = (categoryIndex: number, variant: number) =>
    MOOD_POOL[(categoryIndex * PLATE_VARIANTS + variant - 1) % MOOD_POOL.length];

  const signatures = new Set<string>();
  for (let c = 0; c < CATEGORY_CONTENT.length; c += 1) {
    const chosen = Array.from({ length: PLATE_VARIANTS }, (_, v) => photoIdFor(c, v + 1));
    signatures.add([...chosen].sort().join('|'));

    /*
      ⛔ WITHIN a category the variants must be different photographs. That is
      the whole reason variants exist: `medical` appears three times on the
      live listing, and three cards carrying one picture is the defect, not
      the fix. Consecutive indices mod the pool size are distinct exactly
      while the pool is at least as large as the variant count.
    */
    if (new Set(chosen).size !== PLATE_VARIANTS) {
      throw new Error(
        `${CATEGORY_CONTENT[c].slug}: ${new Set(chosen).size} distinct photo(s) across ${PLATE_VARIANTS} variants - MOOD_POOL has ${MOOD_POOL.length}, which must be at least PLATE_VARIANTS (${PLATE_VARIANTS})`,
      );
    }
  }

  /*
    ⛔ ACROSS categories the sets must not all be the same one. This is a
    DIFFERENT failure from the row above and the row above cannot see it: at
    a pool of exactly `PLATE_VARIANTS` every category still gets three
    distinct photographs, and they are the same three every time, so the
    whole site reads as one set of three pictures. It bites whenever the
    stride divides the pool, which is why the fix is a pool size coprime with
    `PLATE_VARIANTS` rather than merely a bigger one.
  */
  if (CATEGORY_CONTENT.length > 1 && signatures.size === 1) {
    throw new Error(
      `every category draws the same ${PLATE_VARIANTS} photographs - MOOD_POOL (${MOOD_POOL.length}) shares a factor with PLATE_VARIANTS (${PLATE_VARIANTS}); pick a pool size coprime with it`,
    );
  }

  /** Duotoned backdrops are reused across categories, so cache per (id, ramp). */
  const backdrops = new Map<string, string>();
  const backdropFor = async (id: string, rampIndex: number): Promise<string> => {
    const key = `${id}:${rampIndex}`;
    const hit = backdrops.get(key);
    if (hit) return hit;
    const made = await duotoneDataUrl(sources.get(id)!, RAMPS[rampIndex]);
    backdrops.set(key, made);
    return made;
  };

  let written = 0;
  for (const cat of targets) {
    const categoryIndex = CATEGORY_CONTENT.indexOf(cat);
    const rampIndex = categoryIndex % RAMPS.length;
    const ramp = RAMPS[rampIndex];

    for (let variant = 1; variant <= PLATE_VARIANTS; variant += 1) {
      const photoId = photoIdFor(categoryIndex, variant);
      const photo = await backdropFor(photoId, rampIndex);

      /*
        Size the label to FIT inside the crop-safe width, MEASURED against the
        real font rather than counted from the string. `docs/112` §9: `M`
        advances 2.8x `i` in DM Serif Display, so a character-count rule is
        wrong by that much. Text width scales linearly with font-size, so one
        measurement gives the answer; the loop is a guard, not a search.
      */
      let labelPx = MAX_LABEL_PX;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await page.setContent(panelHtml(cat.label, ramp, photo, serif, sans, labelPx), {
          waitUntil: 'load',
        });
        await page.evaluate(() => document.fonts.ready);
        const measured = await page.evaluate(
          () => document.getElementById('label')!.getBoundingClientRect().width,
        );
        if (measured <= SAFE_WIDTH || labelPx <= MIN_LABEL_PX) break;
        labelPx = Math.max(MIN_LABEL_PX, Math.floor(labelPx * (SAFE_WIDTH / measured)));
      }

      const { labelWidth, footWidth } = await page.evaluate(() => ({
        labelWidth: document.getElementById('label')!.getBoundingClientRect().width,
        footWidth: document.getElementById('foot')!.getBoundingClientRect().width,
      }));

      // Would be cropped in the square thumbnail; better to fail loudly.
      if (labelWidth > SAFE_WIDTH) {
        throw new Error(
          `${cat.slug}: label is ${Math.round(labelWidth)}px at the ${MIN_LABEL_PX}px floor, over the ${SAFE_WIDTH}px safe width`,
        );
      }
      /*
        The footer is measured too, and not only for tidiness: it carries the
        "illustrative photo" disclosure, and a disclosure whose ends are
        cropped off is a disclosure that no longer says what it meant.
      */
      if (footWidth > SAFE_WIDTH) {
        throw new Error(
          `footer is ${Math.round(footWidth)}px, over the ${SAFE_WIDTH}px safe width - shorten FOOTER or drop its font-size`,
        );
      }

      const png = await page.screenshot({ type: 'png' });

      const webp = await sharp(png)
        .resize(WIDTH, HEIGHT, { fit: 'fill' })
        .webp({ quality: 82 })
        .toBuffer();

      const dest = join(outDir, `${cat.slug}-panel-${variant}.webp`);
      writeFileSync(dest, webp);
      console.log(
        `${`${cat.slug}-${variant}`.padEnd(22)} ramp${rampIndex}  ${photoId}  ` +
          `${String(labelPx).padStart(3)}px  ${String(Math.round(labelWidth)).padStart(3)}w  ` +
          `${String(Math.round(webp.length / 1024)).padStart(3)}KB`,
      );
      written += 1;
    }
  }

  await browser.close();
  console.log(`\n${written} plate(s) written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
