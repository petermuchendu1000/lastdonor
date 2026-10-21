/**
 * Render outgoing emails in a real browser and screenshot them.
 *
 * Copy can be measured (`scripts/email-readability.ts`); layout cannot.
 * This renders the actual template HTML in Chromium at the widths and
 * themes real clients use, so the result can be looked at rather than
 * reasoned about. Same principle as docs/56: verify against the rendered
 * page, not the source.
 *
 *   npx tsx scripts/email-screenshot.ts <outDir>
 *
 * Note the limits of what this proves. It is Chromium, so it shows how the
 * mail renders in Apple Mail, Gmail's web client and anything else using a
 * modern engine. It does NOT show Outlook on Windows, which renders through
 * Word and takes the VML path in `emailButton` (docs/67). Nothing here can
 * substitute for a real client test there.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  passwordResetEmail,
  campaignSubmittedForReviewEmail,
  identityDeclinedEmail,
  donationReceiptEmail,
} from '../src/lib/email-templates';

const outDir = process.argv[2] ?? '/tmp/email-shots';
mkdirSync(outDir, { recursive: true });

const SHOTS = [
  {
    name: 'reset',
    email: passwordResetEmail({
      resetUrl: 'https://lastdonor.org/login/reset-password?token=EXAMPLE&email=you%40example.com',
    }),
  },
  {
    name: 'submitted',
    email: campaignSubmittedForReviewEmail({
      campaignerName: 'Peter',
      campaignTitle: 'Help Amina Walk Again',
    }),
  },
  {
    name: 'id-declined',
    email: identityDeclinedEmail({
      campaignerName: 'Peter',
      campaignTitle: 'Help Amina Walk Again',
      campaignSlug: 'help-amina',
      reason: 'The photo was too dark to read the date.',
    }),
  },
  {
    name: 'receipt',
    email: donationReceiptEmail({
      campaignTitle: 'Help Amina Walk Again',
      donorName: 'Grace',
      isAnonymous: false,
      amount: 5000,
      currency: 'KES',
      transactionId: 'payhero_LD-8821',
    }),
  },
];

/** Widths real clients give the message. 390 is a phone; 700 a desktop pane. */
const VIEWPORTS = [
  { tag: 'phone', width: 390, height: 900 },
  { tag: 'desktop', width: 700, height: 1000 },
];

const main = async (): Promise<void> => {
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
  });

  for (const scheme of ['light', 'dark'] as const) {
    for (const vp of VIEWPORTS) {
      /*
        `reducedMotion: 'reduce'` is not a nicety here, it is correctness.

        The shell animates `.ld-rise` from `opacity: 0` over 520ms, and a
        screenshot taken on `load` catches it part way: the whole card
        renders faded, which reads exactly like a contrast fault and is
        not one. The shell already disables the animation under
        `prefers-reduced-motion`, so asking for it gives the steady state
        a reader actually ends up looking at.
      */
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
        reducedMotion: 'reduce',
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();

      for (const shot of SHOTS) {
        await page.setContent(shot.email.html, { waitUntil: 'load' });
        const file = join(outDir, `${shot.name}-${vp.tag}-${scheme}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`${file}`);
      }
      await ctx.close();
    }
  }

  await browser.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
