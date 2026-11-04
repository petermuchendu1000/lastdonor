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
 * ── RUN ─────────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/generate-category-panels.ts            # all 23
 *   npx tsx scripts/generate-category-panels.ts --only medical,veterans
 *   npx tsx scripts/generate-category-panels.ts --out /tmp/preview
 *
 * The category list is DERIVED from `CATEGORY_CONTENT`, so a 24th category
 * generates a panel without this file being edited.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATEGORY_CONTENT } from '@/lib/category-content';

/** Matches the OG card (`api/v1/og/page/route.tsx`) so the brand reads as one system. */
const AMBER = '#D97706';

/**
 * Four deep tones from one family, assigned by position.
 *
 * ⚠️ The variation is VISUAL ONLY and encodes nothing - a reader cannot
 * decode "teal-800 means memorial", and no copy anywhere claims they can.
 * It exists because a search-results grid of identical rectangles reads as
 * one repeated image rather than a set.
 */
const TONES = ['#0F766E', '#115E59', '#134E4A', '#0E7490'];

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

/** Largest size tried; the fit loop in `main` steps down from here. */
const MAX_LABEL_PX = 128;
const MIN_LABEL_PX = 54;

function panelHtml(
  label: string,
  tone: string,
  serif: string,
  sans: string,
  labelPx: number,
): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'DM Serif Display'; src: url('${serif}') format('truetype'); font-weight: 400; }
  @font-face { font-family: 'DM Sans'; src: url('${sans}') format('truetype'); font-weight: 500; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    background: ${tone};
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 0 60px;
  }
  .stripe { position: absolute; top: 0; left: 0; right: 0; height: 8px; background: ${AMBER}; }
  .glow {
    position: absolute; inset: 0;
    background: radial-gradient(circle at 78% 18%, rgba(255,255,255,0.08) 0%, transparent 54%);
  }
  .label {
    font-family: 'DM Serif Display', serif;
    font-size: ${labelPx}px;
    line-height: 1.08;
    color: #FFFFFF;
    position: relative;
    letter-spacing: -0.01em;
    white-space: nowrap;
    text-align: center;
  }
  .rule { width: 112px; height: 6px; background: ${AMBER}; margin-top: 32px; position: relative; }
  .mark {
    position: absolute; bottom: 52px; left: 0; right: 0; text-align: center;
    font-family: 'DM Sans', sans-serif; font-size: 26px;
    color: rgba(255,255,255,0.62); letter-spacing: 0.01em;
  }
</style></head>
<body>
  <div class="stripe"></div>
  <div class="glow"></div>
  <div class="label" id="label">${label}</div>
  <div class="rule"></div>
  <div class="mark">lastdonor.org</div>
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

  let written = 0;
  for (const cat of targets) {
    const tone = TONES[CATEGORY_CONTENT.indexOf(cat) % TONES.length];
    /*
      Size the label to FIT inside the crop-safe width, MEASURED against the
      real font rather than counted from the string. `docs/112` §9: `M`
      advances 2.8x `i` in DM Serif Display, so a character-count rule is
      wrong by that much. Text width scales linearly with font-size, so one
      measurement gives the answer; the loop is a guard, not a search.
    */
    let labelPx = MAX_LABEL_PX;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.setContent(panelHtml(cat.label, tone, serif, sans, labelPx), {
        waitUntil: 'load',
      });
      await page.evaluate(() => document.fonts.ready);
      const measured = await page.evaluate(
        () => document.getElementById('label')!.getBoundingClientRect().width,
      );
      if (measured <= SAFE_WIDTH || labelPx <= MIN_LABEL_PX) break;
      labelPx = Math.max(MIN_LABEL_PX, Math.floor(labelPx * (SAFE_WIDTH / measured)));
    }

    const fitted = await page.evaluate(
      () => document.getElementById('label')!.getBoundingClientRect().width,
    );
    if (fitted > SAFE_WIDTH) {
      // Would be cropped in the square thumbnail; better to fail loudly.
      throw new Error(
        `${cat.slug}: label is ${Math.round(fitted)}px at the ${MIN_LABEL_PX}px floor, over the ${SAFE_WIDTH}px safe width`,
      );
    }

    const png = await page.screenshot({ type: 'png' });

    const webp = await sharp(png)
      .resize(WIDTH, HEIGHT, { fit: 'fill' })
      .webp({ quality: 88 })
      .toBuffer();

    const dest = join(outDir, `${cat.slug}-panel.webp`);
    writeFileSync(dest, webp);
    console.log(`${cat.slug.padEnd(18)} ${tone}  ${String(labelPx).padStart(3)}px  ${String(Math.round(fitted)).padStart(3)}w  ${String(Math.round(webp.length / 1024)).padStart(3)}KB`);
    written += 1;
  }

  await browser.close();
  console.log(`\n${written} panel(s) written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
