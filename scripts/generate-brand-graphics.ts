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
 * indexes images on pages it has crawled, so each graphic here is rendered by
 * a real page with real surrounding text (`src/lib/brand-graphics.ts` holds
 * the placement, and `sitemap.ts` advertises them). A file sitting in
 * `public/` reaches nobody.
 *
 * ── EVERY LINE OF COPY IS A CLAIM ───────────────────────────────────────────
 *
 * CLAUDE.md: *never add a claim the platform cannot substantiate*. These are
 * published, machine-readable assertions about a platform that handles other
 * people's money, so every graphic carries a `facts` list recording what
 * makes its copy true, and `brand-graphics-claims.test.ts` holds the
 * dangerous ones to the code rather than to my memory.
 *
 * Claims DELIBERATELY ABSENT, which must not be added back:
 *
 *  - **Anything about paying by card.** [VERIFIED `docs/161`] `create-checkout`
 *    answers 503 for every campaign on dead Stripe credentials, so "pay by
 *    card" is false today on every live campaign.
 *  - **"The family receives it", or any completed payout.** [VERIFIED
 *    `docs/121`, `docs/113`] money has never left this platform - 0
 *    withdrawals, 0 Connect accounts - and the payout rail is that same dead
 *    Stripe. The release GATE is real and is what the graphics state; the
 *    completed payout is not, so it is never drawn.
 *  - **A competitor's fee, or any percent-plus-fixed rate.** `docs/116` §5
 *    banned those outright and `fee-claims.test.ts` enforces it over `src/`.
 *    An image is harder to audit than a sentence, so the rule is kept here by
 *    hand rather than exploited for living outside that glob.
 *  - **Impact updates as a thing donors receive.** [VERIFIED] `impact_updates`
 *    holds 0 rows; `docs/142` already had to delete that claim from
 *    `llms.txt`.
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
import { CATEGORY_CONTENT } from '@/lib/category-content';
import { BRAND_GRAPHICS as PUBLISHED } from '@/lib/brand-graphics';

/** Shared with the OG card and the category panels so the brand reads as one system. */
const TEAL = '#0F766E';
const TEAL_DEEP = '#134E4A';
const AMBER = '#D97706';

/**
 * 1200x1200.
 *
 * SQUARE, not the 1200x630 the OG card uses. A share card is rendered in a
 * fixed-ratio slot by the platform showing it; a Google Images result is a
 * tile in a grid, where a square carries noticeably more pixels than a wide
 * strip of the same width. These are also read at full size, which an OG card
 * never is. Verified legible at 180/240/320px tiles.
 */
const SIZE = 1200;

const ROOT = resolve(__dirname, '..');

function fontDataUrl(file: string): string {
  const buf = readFileSync(join(ROOT, 'public', 'fonts', file));
  return `data:font/truetype;base64,${buf.toString('base64')}`;
}

/** Escape anything interpolated into the markup. Copy is ours, but the habit is cheap. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Item {
  title: string;
  body: string;
}

interface LedgerRow {
  label: string;
  note: string;
  amount: string;
  /** Rendered in the accent colour - the rows that carry the claim. */
  accent?: boolean;
}

type Body =
  | { layout: 'steps'; items: Item[] }
  | { layout: 'points'; items: Item[] }
  | { layout: 'ledger'; opening: LedgerRow; rows: LedgerRow[]; total: LedgerRow }
  | { layout: 'pair'; lead: string; left: Item & { value: string }; right: Item & { value: string }; note: string };

export interface Graphic {
  slug: string;
  eyebrow: string;
  headline: string;
  /** Rendered bottom-right. As defensible as every other line. */
  kicker: string;
  body: Body;
  /** What makes the copy true. Not rendered; the record, and the test reads it. */
  facts: string[];
}

const usd0 = '$0.00';

export const BRAND_GRAPHICS: Graphic[] = [
  {
    slug: 'how-giving-works',
    eyebrow: 'HOW IT WORKS',
    headline: 'What happens when you give',
    kicker: '0% platform fee',
    body: {
      layout: 'steps',
      items: [
        { title: 'You give in seconds', body: 'Pay with M-Pesa. There is no account to create.' },
        { title: 'A person has already read it', body: 'Every campaign is reviewed before it goes live.' },
        { title: 'The organiser proves who they are', body: 'An ID check before any funds can be released.' },
        { title: 'We take 0%', body: 'LastDonor receives no part of your donation.' },
      ],
    },
    facts: [
      'payhero/initiate collects for a listed campaign; the M-Pesa rail creates guests (docs/122) and the form asks only for amount, phone and email (docs/151).',
      'docs/78 + docs/79 gate both creation paths to under_review; docs/169 §8.6 verified published == approved.',
      'withdraw/route.ts refuses anything but fully_verified, reached only through the Didit + document review path (docs/110, docs/121).',
      'No code deducts a platform fee: create-checkout sets unit_amount with no application_fee, payment-service credits raisedAmount + amount (docs/116 §5).',
    ],
  },

  {
    slug: 'start-a-campaign',
    eyebrow: 'FOR ORGANISERS',
    headline: 'Starting a campaign',
    kicker: 'Free to start',
    body: {
      layout: 'steps',
      items: [
        { title: 'Write your campaign', body: 'Say who needs help, what for, and how much.' },
        { title: 'A person reads it', body: 'Someone on our team checks it before anyone else can see it.' },
        { title: 'It goes live', body: 'We email you a link to share the moment it is approved.' },
        { title: 'You post updates', body: 'Tell the people who gave what their money did.' },
      ],
    },
    facts: [
      'The first two items are organiserJourneyOutline() verbatim (write, review) - derived, not invented.',
      'Approval emails the organiser with ?launched=true, the one moment that copy is true (docs/109).',
      'Campaign updates are a live feature: insertCampaignUpdate, /dashboard/campaigns/[id]/updates, CampaignUpdates renders them (docs/89).',
      'No fee is charged to create a campaign: no code path bills an organiser (docs/116 §5).',
    ],
  },

  {
    slug: 'every-campaign-is-reviewed',
    eyebrow: 'TRUST',
    headline: 'Nothing publishes itself',
    kicker: 'Every campaign, no exceptions',
    body: {
      layout: 'points',
      items: [
        { title: 'Every campaign starts private', body: 'Submitting does not publish. Nobody can see it yet.' },
        { title: 'A person reads it', body: 'However a campaign is created, it goes to the same queue.' },
        { title: 'A refused campaign gets no page', body: 'If we say no, there was never anything public to find.' },
        { title: 'The organiser is told why', body: 'A refusal carries the reason, in the reviewer’s own words.' },
      ],
    },
    facts: [
      'Both creation paths insert status under_review with publishedAt null (docs/78, docs/79), and publisher-review-gate.test.ts discovers every campaign insert from disk.',
      'The public page requires isNotNull(publishedAt), so a refused campaign has no page at all (docs/131).',
      'The suspend route demands a reason of at least three characters and emails it to the organiser (docs/93).',
    ],
  },

  {
    slug: 'where-your-money-goes',
    eyebrow: 'FEES',
    headline: 'Where your money goes',
    kicker: 'lastdonor.org/transparency',
    body: {
      layout: 'ledger',
      opening: { label: 'Your donation', note: 'What you choose to give.', amount: '$100.00' },
      rows: [
        {
          label: 'Payment processing',
          note: 'The company that moves the money charges us a fee. We pay it.',
          amount: `− ${usd0}`,
          accent: true,
        },
        {
          label: 'LastDonor platform fee',
          note: 'No platform cut. No tip added to your donation.',
          amount: `− ${usd0}`,
          accent: true,
        },
      ],
      total: { label: 'Reaches the campaign', note: '', amount: '$100.00', accent: true },
    },
    facts: [
      'Mirrors the live ledger in WhereYourMoneyGoes.tsx, including its wording that the processing fee "is not taken out of your gift".',
      'No code deducts either: unit_amount carries no application_fee and payment-service credits raisedAmount + amount (docs/116 §5).',
      'The processing fee is genuinely absorbed - PayHero bills the service wallet LastDonor tops up (docs/92, docs/168 §10).',
      '$100 is a round ILLUSTRATION, as the live ledger also uses. It is not a claim about any real donation.',
    ],
  },

  {
    slug: 'giving-from-anywhere',
    eyebrow: 'CROSS-BORDER',
    headline: 'Give in shillings to a campaign anywhere',
    kicker: 'No margin added',
    body: {
      layout: 'pair',
      lead: 'A campaign states its goal in its own currency. You still pay in shillings, over M-Pesa.',
      left: { title: 'You are charged', value: 'Ksh 650.00', body: 'By M-Pesa, in shillings.' },
      right: { title: 'The campaign is credited', value: '$5.00', body: 'In the currency it was set up in.' },
      note: 'A real donation, 2 November 2026. We convert at the day’s rate and add no margin of our own.',
    },
    facts: [
      'docs/168: a real donation, M-Pesa receipt UK2JG0GO0Z, charged Ksh 650.00 with the USD campaign keisha-wallace credited $5.00.',
      'FX_MARGIN_BPS is 0, and raising it is a copy change first because the 0% promise appears in five live surfaces (docs/168).',
      'The figure is DATED because an undated rate rots (CLAUDE.md), and labelled as one donation rather than a standing rate.',
    ],
  },

  {
    slug: 'what-the-id-check-covers',
    eyebrow: 'VERIFICATION',
    headline: 'What we check before money moves',
    kicker: 'Before any payout',
    body: {
      layout: 'steps',
      items: [
        { title: 'A government photo ID', body: 'The organiser shows us identification.' },
        { title: 'Papers for the need', body: 'Proof of what the money is for, such as a hospital bill.' },
        { title: 'A limit until that is done', body: 'An unchecked campaign can only raise so much.' },
        { title: 'Then, and only then, a payout', body: 'No money is released before the check is complete.' },
      ],
    },
    facts: [
      'organiserJourneyOutline() steps identity ("You show us a photo ID") and documents ("Proof of what the money is for, such as a hospital bill") - derived.',
      'unverifiedCapMinor in currencies.ts caps what an unverified campaign may raise; checkRaiseCap enforces it before any gateway call (docs/101).',
      'withdraw/route.ts refuses anything but fully_verified, which the document review grants (docs/121).',
      'No amount is printed for the cap: it is per currency and an owner-tunable policy number, so a figure here would rot.',
    ],
  },

  {
    slug: 'find-a-campaign',
    eyebrow: 'BROWSE',
    headline: 'Find a campaign by what it is for',
    kicker: `${CATEGORY_CONTENT.length} categories`,
    body: {
      layout: 'points',
      items: [
        { title: 'Medical', body: 'Hospital bills, surgery, treatment and recovery.' },
        { title: 'Memorial', body: 'Funeral costs, and families left behind.' },
        { title: 'Emergency and disaster', body: 'Fire, flood, and sudden loss of a home.' },
        { title: 'Veterans and community', body: 'Service members, first responders, and local causes.' },
      ],
    },
    facts: [
      'The count is DERIVED from CATEGORY_CONTENT.length, so adding a category cannot leave a stale number in a published image.',
      'All four named groups are real category slugs: medical, memorial, emergency, disaster, veterans, first-responders, community.',
      'No campaign counts are shown: those move daily and would rot (docs/169 §8.5 recorded the category set flapping).',
    ],
  },

  {
    slug: 'questions-donors-ask',
    eyebrow: 'QUESTIONS',
    headline: 'Questions donors ask',
    kicker: 'lastdonor.org/how-it-works',
    body: {
      layout: 'points',
      items: [
        { title: 'Does it cost me anything?', body: 'No. We take 0% and add no tip to your donation.' },
        { title: 'Do I need an account?', body: 'No. Your phone number and an email for the receipt.' },
        { title: 'Who checked this campaign?', body: 'A person on our team, before it was published.' },
        { title: 'When is the organiser paid?', body: 'After we have checked their ID. Not before.' },
      ],
    },
    facts: [
      'Fee answer: no code deducts a platform fee and no tip field exists (docs/116 §5, WhereYourMoneyGoes).',
      'Account answer: the M-Pesa rail creates guests and the form asks for amount, phone and email (docs/122, docs/151).',
      'Review answer: docs/78 + docs/79.',
      'Payout answer: withdraw/route.ts requires fully_verified (docs/121). It states the GATE, never that a payout has happened.',
    ],
  },
];

function itemsHtml(items: Item[], numbered: boolean): string {
  return items
    .map(
      (s, i) => `
      <li class="item">
        <div class="${numbered ? 'badge' : 'dot'}">${numbered ? i + 1 : ''}</div>
        <div class="text">
          <div class="ititle">${esc(s.title)}</div>
          <div class="ibody">${esc(s.body)}</div>
        </div>
      </li>`,
    )
    .join('');
}

function ledgerRowHtml(r: LedgerRow, kind: 'opening' | 'row' | 'total'): string {
  return `
    <li class="lrow ${kind}">
      <div class="ltext">
        <div class="llabel">${esc(r.label)}</div>
        ${r.note ? `<div class="lnote">${esc(r.note)}</div>` : ''}
      </div>
      <div class="lamount ${r.accent ? 'accent' : ''}">${esc(r.amount)}</div>
    </li>`;
}

function bodyHtml(b: Body): string {
  if (b.layout === 'steps') return `<ul class="list stepped">${itemsHtml(b.items, true)}</ul>`;
  if (b.layout === 'points') return `<ul class="list">${itemsHtml(b.items, false)}</ul>`;
  if (b.layout === 'ledger') {
    return `<ul class="ledger">
      ${ledgerRowHtml(b.opening, 'opening')}
      ${b.rows.map((r) => ledgerRowHtml(r, 'row')).join('')}
      ${ledgerRowHtml(b.total, 'total')}
    </ul>`;
  }
  return `<div class="pairwrap">
  <div class="plead">${esc(b.lead)}</div>
  <div class="pair">
    <div class="pcol">
      <div class="plabel">${esc(b.left.title)}</div>
      <div class="pvalue">${esc(b.left.value)}</div>
      <div class="pbody">${esc(b.left.body)}</div>
    </div>
    <div class="pcol">
      <div class="plabel">${esc(b.right.title)}</div>
      <div class="pvalue accent">${esc(b.right.value)}</div>
      <div class="pbody">${esc(b.right.body)}</div>
    </div>
  </div>
  <div class="pnote">${esc(b.note)}</div>
  </div>`;
}

function graphicHtml(g: Graphic, serif: string, sans: string): string {
  /*
    WARNING: no backticks in any comment inside this template literal - one
    would end the string. (docs/138's comment trap, one layer over; it cost a
    build here already.)

    max-width on the headline is doing TYPOGRAPHY, not layout: at the full
    width "What happens when you give" broke after "you" and orphaned "give"
    on its own line. Constraining the measure forces a balanced break.
  */
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
  .headline {
    position: relative; font-family: 'DM Serif Display', serif;
    font-size: 74px; line-height: 1.07; color: #fff; margin-top: 20px;
    letter-spacing: -0.012em; max-width: 760px;
  }
  .rule { position: relative; width: 104px; height: 6px; background: ${AMBER}; margin-top: 34px; }

  /*
    The body DISTRIBUTES through the space between the rule and the footer
    rather than stacking from the top - a fixed margin left ~100px of dead
    canvas above the footer, which reads as an unfinished graphic.
  */
  .list {
    position: relative; list-style: none; margin-top: 48px; flex: 1;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  /* Behind the badges, centre to centre (36px = badge radius). Stepped only. */
  .stepped::before {
    content: ''; position: absolute; left: 35px; top: 36px; bottom: 36px;
    width: 2px; background: rgba(255,255,255,0.18);
  }
  .item { position: relative; display: flex; gap: 30px; align-items: flex-start; }
  .badge {
    position: relative; flex: 0 0 72px; width: 72px; height: 72px; border-radius: 50%;
    background: ${AMBER}; color: #1b2b2a;
    display: flex; align-items: center; justify-content: center;
    font-size: 34px; font-weight: 500; line-height: 1;
  }
  .dot {
    position: relative; flex: 0 0 22px; width: 22px; height: 22px; border-radius: 4px;
    background: ${AMBER}; margin-top: 14px;
  }
  .text { padding-top: 7px; }
  .ititle { font-size: 40px; color: #fff; line-height: 1.18; letter-spacing: -0.005em; }
  .ibody { font-size: 27px; color: rgba(255,255,255,0.72); line-height: 1.38; margin-top: 9px; max-width: 800px; }

  .ledger {
    position: relative; list-style: none; margin-top: 48px; flex: 1;
    display: flex; flex-direction: column; justify-content: center; gap: 30px;
  }
  .lrow { display: flex; justify-content: space-between; align-items: baseline; gap: 36px; }
  .lrow.total { border-top: 1px solid rgba(255,255,255,0.22); padding-top: 30px; margin-top: 8px; }
  .llabel { font-size: 36px; color: #fff; line-height: 1.2; }
  .lnote { font-size: 24px; color: rgba(255,255,255,0.66); line-height: 1.36; margin-top: 8px; max-width: 620px; }
  .lamount { font-size: 40px; color: #fff; white-space: nowrap; }
  .lamount.accent { color: ${AMBER}; }
  .lrow.total .llabel { font-size: 40px; }
  .lrow.total .lamount { font-size: 54px; }

  /*
    The two columns and their note are centred AS ONE BLOCK. Giving .pair
    flex:1 instead floated the values in the middle of a tall box and left a
    wide gap under the rule, which read as a layout mistake rather than
    breathing room.
  */
  .pairwrap {
    position: relative; flex: 1; display: flex; flex-direction: column;
    justify-content: center; gap: 40px;
  }
  .plead { font-size: 30px; color: rgba(255,255,255,0.82); line-height: 1.42; max-width: 920px; }
  .pair { position: relative; display: flex; align-items: stretch; gap: 32px; }
  /*
    PANELS, not bare columns with a hairline between them. Centring two short
    columns in the leftover space left the figures floating with wide dead
    margins above and below; a filled panel makes the same block read as
    designed and lets the numbers be the hero.
  */
  .pcol {
    flex: 1; display: flex; flex-direction: column; justify-content: center;
    background: rgba(255,255,255,0.07); border-radius: 22px; padding: 62px 46px;
  }
  .plabel { font-size: 26px; color: rgba(255,255,255,0.7); letter-spacing: 0.02em; }
  .pvalue {
    font-family: 'DM Serif Display', serif; font-size: 82px; color: #fff;
    line-height: 1.1; margin-top: 18px; letter-spacing: -0.015em;
  }
  .pvalue.accent { color: ${AMBER}; }
  .pbody { font-size: 26px; color: rgba(255,255,255,0.72); line-height: 1.36; margin-top: 16px; }
  .pnote {
    position: relative; font-size: 25px; color: rgba(255,255,255,0.66);
    line-height: 1.4; max-width: 940px;
  }

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
  <div class="eyebrow">${esc(g.eyebrow)}</div>
  <div class="headline">${esc(g.headline)}</div>
  <div class="rule"></div>
  ${bodyHtml(g.body)}
  <div class="foot">
    <div class="mark">lastdonor.org</div>
    <div class="kicker">${esc(g.kicker)}</div>
  </div>
</body></html>`;
}

/*
  The REGISTRY decides what is published and carries the alt text; this file
  decides only what each graphic looks like. Drift between them would mean a
  page rendering an image that was never drawn, or a drawn image on no page -
  which is the one thing that makes it unindexable (docs/171).
*/
function assertSlugsMatch(): void {
  const design = new Set(BRAND_GRAPHICS.map((g) => g.slug));
  const published = new Set(PUBLISHED.map((g) => g.slug));
  const missing = [...published].filter((s) => !design.has(s));
  const extra = [...design].filter((s) => !published.has(s));
  if (missing.length || extra.length) {
    throw new Error(
      `brand graphic slugs disagree with src/lib/brand-graphics.ts - no design for [${missing}], not published [${extra}]`,
    );
  }
}

async function main() {
  assertSlugsMatch();
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
  // Supersampled: read at full size AND as a grid thumbnail.
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 2,
  });

  for (const g of targets) {
    await page.setContent(graphicHtml(g, serif, sans), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    /*
      ⛔ Refuse to emit a graphic whose content overflows its canvas. A clipped
      final row is invisible in the file and obvious to a reader, and this
      script is the only thing between the copy and a published image.
    */
    const over = await page.evaluate(() => ({
      h: document.body.scrollHeight,
      w: document.body.scrollWidth,
    }));
    if (over.h > SIZE || over.w > SIZE) {
      throw new Error(
        `${g.slug}: content is ${over.w}x${over.h}, larger than the ${SIZE}px canvas - it would be clipped`,
      );
    }

    const png = await page.screenshot({ type: 'png' });
    const webp = await sharp(png).resize(SIZE, SIZE, { fit: 'fill' }).webp({ quality: 90 }).toBuffer();

    const dest = join(outDir, `${g.slug}.webp`);
    writeFileSync(dest, webp);
    console.log(
      `${g.slug.padEnd(28)} ${g.body.layout.padEnd(7)} ${String(Math.round(webp.length / 1024)).padStart(3)}KB`,
    );
  }

  await browser.close();
  console.log(`\n${targets.length} graphic(s) written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
