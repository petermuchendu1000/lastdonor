/**
 * Measure real contrast ratios in rendered email, light and dark.
 *
 * Renders each template in Chromium, walks every element holding text,
 * reads the COMPUTED colour and the first opaque background behind it, and
 * reports the WCAG 2.1 contrast ratio.
 *
 *   npx tsx scripts/email-contrast.ts [--all]
 *
 * Thresholds: 4.5:1 for body text, 3:1 for text at 18.66px+ bold or 24px+.
 * Exits non-zero if anything fails, so it can gate.
 */
import { chromium, type Page } from '@playwright/test';
import {
  passwordResetEmail,
  campaignSubmittedForReviewEmail,
  identityDeclinedEmail,
  donationReceiptEmail,
  campaignCompletedCreatorEmail,
  welcomeCampaignerEmail,
} from '../src/lib/email-templates';

const SAMPLES: Array<{ name: string; html: string }> = [
  {
    name: 'passwordReset',
    html: passwordResetEmail({ resetUrl: 'https://lastdonor.org/x' }).html,
  },
  {
    name: 'campaignSubmitted',
    html: campaignSubmittedForReviewEmail({ campaignerName: 'Peter', campaignTitle: 'Help Amina' })
      .html,
  },
  {
    name: 'identityDeclined',
    html: identityDeclinedEmail({
      campaignerName: 'Peter',
      campaignTitle: 'Help Amina',
      campaignSlug: 'h',
      reason: 'The photo was too dark.',
    }).html,
  },
  {
    name: 'donationReceipt',
    html: donationReceiptEmail({
      campaignTitle: 'Help Amina',
      donorName: 'Grace',
      isAnonymous: false,
      amount: 5000,
      currency: 'KES',
      transactionId: 'payhero_LD-1',
    }).html,
  },
  {
    name: 'campaignCompletedCreator',
    html: campaignCompletedCreatorEmail({
      campaignerName: 'Peter',
      campaignTitle: 'Help Amina',
      campaignSlug: 'h',
      goalAmount: 250000,
      currency: 'KES',
      donorCount: 37,
      documentRequirementsHtml: '<li>A letter from the hospital</li>',
    }).html,
  },
  {
    name: 'welcomeCampaigner',
    html: welcomeCampaignerEmail({
      campaignerName: 'Peter',
      campaignTitle: 'Help Amina',
      campaignSlug: 'h',
    }).html,
  },
];

interface Finding {
  sample: string;
  scheme: string;
  ratio: number;
  required: number;
  fg: string;
  bg: string;
  size: string;
  text: string;
}

/*
  The audit runs as a STRING, not a closure.

  `tsx` compiles with esbuild's `--keep-names`, which rewrites named
  function expressions to call a `__name` helper. That helper exists in the
  Node bundle and not in the page, so a normal `page.evaluate(() => ...)`
  here dies with `ReferenceError: __name is not defined`. A string is
  handed to the page verbatim and cannot pick up build-time helpers.
*/
const AUDIT_JS = `(() => {
  const parse = (c) => { const m = (c.match(/[\\d.]+/g) || []).map(Number); return [m[0]||0, m[1]||0, m[2]||0, m[3] === undefined ? 1 : m[3]]; };
  const lum = (rgb) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  const ratio = (a, b) => { const ls = [lum(a), lum(b)].sort((x, y) => y - x); return (ls[0] + 0.05) / (ls[1] + 0.05); };
  const bgOf = (el) => { let n = el; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3] > 0) return [c[0], c[1], c[2]]; n = n.parentElement; } return [255, 255, 255]; };
  const out = [];
  const els = Array.prototype.slice.call(document.querySelectorAll('body *'));
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const own = Array.prototype.slice.call(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').trim();
    if (own.length < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fg = parse(cs.color);
    const bg = bgOf(el);
    const px = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = px >= 24 || (bold && px >= 18.66);
    const required = large ? 3 : 4.5;
    const value = ratio([fg[0], fg[1], fg[2]], bg);
    if (value < required) {
      out.push({ ratio: Math.round(value * 100) / 100, required: required, fg: 'rgb(' + fg[0] + ',' + fg[1] + ',' + fg[2] + ')', bg: 'rgb(' + bg[0] + ',' + bg[1] + ',' + bg[2] + ')', size: px + 'px' + (bold ? ' bold' : ''), text: own.slice(0, 48) });
    }
  }
  return out;
})()`;

async function auditPage(page: Page): Promise<Omit<Finding, 'sample' | 'scheme'>[]> {
  return page.evaluate(AUDIT_JS) as Promise<Omit<Finding, 'sample' | 'scheme'>[]>;
}

const main = async (): Promise<void> => {
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
  });
  const findings: Finding[] = [];

  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({
      viewport: { width: 700, height: 1000 },
      colorScheme: scheme,
    });
    const page = await ctx.newPage();
    for (const s of SAMPLES) {
      await page.setContent(s.html, { waitUntil: 'load' });
      for (const f of await auditPage(page)) {
        findings.push({ sample: s.name, scheme, ...f });
      }
    }
    await ctx.close();
  }
  await browser.close();

  for (const scheme of ['light', 'dark']) {
    const rows = findings.filter((f) => f.scheme === scheme);
    console.log(`\n=== ${scheme.toUpperCase()}: ${rows.length} element(s) below WCAG AA ===`);
    for (const f of rows.sort((a, b) => a.ratio - b.ratio)) {
      console.log(
        `  ${String(f.ratio).padStart(5)}:1 (need ${f.required}) ${f.fg} on ${f.bg}  ` +
          `[${f.size}] ${f.sample} — "${f.text}"`,
      );
    }
  }

  console.log(`\ntotal failures: ${findings.length}`);
  process.exit(findings.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
