/**
 * Generate the brand explainer graphics.
 *
 * ── WHAT THESE ARE FOR ──────────────────────────────────────────────────────
 *
 * Images ABOUT LASTDONOR - how giving works, how a campaign is reviewed, what
 * the fee is - as opposed to the per-campaign panels in
 * `generate-category-panels.ts` (`docs/170`). The goal is that a search for
 * the brand, on the web or in Google Images, returns something that explains
 * the product rather than a stock photograph.
 *
 * ⛔ AN IMAGE ON NO PAGE IS NEVER INDEXED. `docs/170` §0: Google Images
 * indexes images on pages it has crawled, so each graphic here must be
 * rendered by a real page with real surrounding text. A file sitting in
 * `public/` reaches nobody.
 *
 * ── EVERY LINE OF COPY IS A CLAIM ───────────────────────────────────────────
 *
 * CLAUDE.md: *never add a claim the platform cannot substantiate*. These are
 * published, machine-readable assertions about a platform that handles other
 * people's money, so each `fact` below carries the thing that makes it true
 * and `brand-graphics-claims.test.ts` holds the dangerous ones to the code.
 *
 * Two claims are DELIBERATELY ABSENT and must not be added back:
 *
 *  - **Anything about paying by card.** [VERIFIED `docs/161`] `create-checkout`
 *    answers 503 for every campaign on dead Stripe credentials, so "pay by
 *    card" is false today on every live campaign.
 *  - **"The family receives it."** [VERIFIED `docs/121`, `docs/113`] money has
 *    never left this platform - 0 withdrawals, 0 Connect accounts - and the
 *    payout rail is the same dead Stripe. The RELEASE GATE is real and is what
 *    step 3 states; the completed payout is not, so it is not drawn.
 *
 * ── RUN ─────────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/generate-brand-graphics.ts
 *   npx tsx scripts/generate-brand-graphics.ts --only how-giving-works
 *   npx tsx scripts/generate-brand-graphics.ts --out /tmp/preview
 *
 * In this sandbox, prefix `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Shared with the OG card and the category panels so the brand reads as one system. */
const TEAL = '#0F766E';
const TEAL_DEEP = '#134E4A';
const AMBER = '#D97706';

/**
 * 1200x1200.
 *
 * ⚠️ SQUARE, not the 1200x630 the OG card uses. A share card is rendered in a
 * fixed-ratio slot by the platform showing it; a Google Images result is a
 * tile in a grid, where a square carries noticeably more pixels than a wide
 * strip of the same width. These are also read at full size, which an OG card
 * never is.
 */
const SIZE = 1200;

const ROOT = resolve(__dirname, '..');

function fontDataUrl(file: string): string {
  const buf = readFileSync(join(ROOT, 'public', 'fonts', file));
  return `data:font/truetype;base64,${buf.toString('base64')}`;
}

interface Step {
  title: string;
  body: string;
  /** What makes this true. Not rendered - it is the record, and the test reads it. */
  fact: string;
}

interface Graphic {
  slug: string;
  eyebrow: string;
  headline: string;
  steps: Step[];
  /** Rendered bottom-right. Must be as defensible as every other line. */
  kicker: string;
}

export const BRAND_GRAPHICS: Graphic[] = [
  {
    slug: 'how-giving-works',
    eyebrow: 'HOW IT WORKS',
    headline: 'What happens when you give',
    kicker: '0% platform fee',
    steps: [
      {
        title: 'You give in seconds',
        body: 'Pay with M-Pesa. There is no account to create.',
        fact: 'payhero/initiate collects for a listed campaign; the M-Pesa rail creates guests (docs/122), and the form asks only for amount, phone and email (docs/151).',
      },
      {
        title: 'A person has already read it',
        body: 'Every campaign is reviewed before it goes live.',
        fact: 'docs/78 + docs/79 gate both creation paths to under_review; docs/169 §8.6 verified 10 published == 10 approved.',
      },
      {
        title: 'The organiser proves who they are',
        body: 'An ID check before any funds can be released.',
        fact: 'withdraw/route.ts refuses anything but fully_verified, which only the Didit + document review path reaches (docs/110, docs/121).',
      },
      {
        title: 'We take 0%',
        body: 'LastDonor receives no part of your donation.',
        fact: 'No code deducts a platform fee: create-checkout sets unit_amount with no application_fee, and payment-service credits raisedAmount + amount (docs/116 §5).',
      },
    ],
  },
];

function graphicHtml(g: Graphic, serif: string, sans: string): string {
  const steps = g.steps
    .map(
      (s, i) => `
      <li class="step">
        <div class="badge">${i + 1}</div>
        <div class="text">
          <div class="stitle">${s.title}</div>
          <div class="sbody">${s.body}</div>
        </div>
      </li>`,
    )
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'DM Serif Display'; src: url('${serif}') format('truetype'); font-weight: 400; }
  @font-face { font-family: 'DM Sans'; src: url('${sans}') format('truetype'); font-weight: 500; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${SIZE}px; height: ${SIZE}px; }
  body {
    background: linear-gradient(158deg, ${TEAL} 0%, ${TEAL_DEEP} 100%);
    position: relative; overflow: hidden;
    display: flex; flex-direction: column;
    padding: 86px 84px 72px;
    font-family: 'DM Sans', sans-serif;
  }
  .stripe { position: absolute; top: 0; left: 0; right: 0; height: 10px; background: ${AMBER}; }
  .glow {
    position: absolute; inset: 0;
    background: radial-gradient(circle at 88% 8%, rgba(255,255,255,0.09) 0%, transparent 46%);
  }
  .eyebrow {
    position: relative; font-size: 24px; letter-spacing: 0.17em;
    color: ${AMBER}; font-weight: 500;
  }
  /*
    WARNING: max-width here is doing TYPOGRAPHY, not layout. At the full 920px
    "What happens when you give" broke after "you" and left "give" alone on
    line two. Constraining the measure forces the balanced break.

    No backticks in any comment below this point: this whole block is inside a
    template literal, so one would end the string (docs/138's comment trap,
    one layer over).
  */
  .headline {
    position: relative; font-family: 'DM Serif Display', serif;
    font-size: 74px; line-height: 1.07; color: #fff; margin-top: 20px;
    letter-spacing: -0.012em; max-width: 740px;
  }
  .rule { position: relative; width: 104px; height: 6px; background: ${AMBER}; margin-top: 34px; }

  /*
    The steps DISTRIBUTE through the space left between the rule and the
    footer rather than stacking from the top - a fixed margin left ~100px of
    dead canvas above the footer, which reads as an unfinished graphic.
  */
  .steps {
    position: relative; list-style: none; margin-top: 48px; flex: 1;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  /* Behind the badges, running centre to centre (36px = badge radius). */
  .steps::before {
    content: ''; position: absolute; left: 35px; top: 36px; bottom: 36px;
    width: 2px; background: rgba(255,255,255,0.18);
  }
  .step { position: relative; display: flex; gap: 30px; align-items: flex-start; }
  .badge {
    position: relative; flex: 0 0 72px; width: 72px; height: 72px; border-radius: 50%;
    background: ${AMBER}; color: #1b2b2a;
    display: flex; align-items: center; justify-content: center;
    font-size: 34px; font-weight: 500; line-height: 1;
  }
  .text { padding-top: 7px; }
  .stitle { font-size: 40px; color: #fff; line-height: 1.18; letter-spacing: -0.005em; }
  .sbody { font-size: 27px; color: rgba(255,255,255,0.72); line-height: 1.38; margin-top: 9px; max-width: 790px; }

  .foot {
    position: relative; display: flex; justify-content: space-between; align-items: baseline;
    border-top: 1px solid rgba(255,255,255,0.16); padding-top: 28px; margin-top: 44px;
  }
  .mark { font-size: 28px; color: rgba(255,255,255,0.74); }
  .kicker { font-size: 26px; color: ${AMBER}; }
</style></head>
<body>
  <div class="stripe"></div>
  <div class="glow"></div>
  <div class="eyebrow">${g.eyebrow}</div>
  <div class="headline" id="headline">${g.headline}</div>
  <div class="rule"></div>
  <ul class="steps">${steps}</ul>
  <div class="foot">
    <div class="mark">lastdonor.org</div>
    <div class="kicker">${g.kicker}</div>
  </div>
</body></html>`;
}

async function main() {
  const argv = process.argv.slice(2);
  const onlyArg = argv.indexOf('--only');
  const outArg = argv.indexOf('--out');
  const only = onlyArg >= 0 ? new Set(argv[onlyArg + 1].split(',').map((s) => s.trim())) : null;
  const outDir =
    outArg >= 0 ? resolve(argv[outArg + 1]) : join(ROOT, 'public', 'images', 'explainers');

  mkdirSync(outDir, { recursive: true });

  const serif = fontDataUrl('DMSerifDisplay-Regular.ttf');
  const sans = fontDataUrl('DMSans-Medium.ttf');

  const targets = BRAND_GRAPHICS.filter((g) => !only || only.has(g.slug));
  if (targets.length === 0) {
    console.error('No graphics matched --only');
    process.exit(1);
  }

  const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  // Supersampled, as the panels are: read at full size AND as a grid thumbnail.
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 2,
  });

  for (const g of targets) {
    await page.setContent(graphicHtml(g, serif, sans), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    /*
      ⛔ Refuse to emit a graphic whose content overflows its canvas. A clipped
      final step is invisible in the file and obvious to a reader, and this
      script is the only thing between the copy and a published image.
    */
    const overflow = await page.evaluate(() => ({
      h: document.body.scrollHeight,
      w: document.body.scrollWidth,
    }));
    if (overflow.h > SIZE || overflow.w > SIZE) {
      throw new Error(
        `${g.slug}: content is ${overflow.w}x${overflow.h}, larger than the ${SIZE}px canvas - it would be clipped`,
      );
    }

    const png = await page.screenshot({ type: 'png' });
    const webp = await sharp(png).resize(SIZE, SIZE, { fit: 'fill' }).webp({ quality: 90 }).toBuffer();

    const dest = join(outDir, `${g.slug}.webp`);
    writeFileSync(dest, webp);
    console.log(`${g.slug.padEnd(22)} ${String(Math.round(webp.length / 1024)).padStart(3)}KB  ${dest}`);
  }

  await browser.close();
  console.log(`\n${targets.length} graphic(s) written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
