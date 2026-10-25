const { chromium } = require('playwright');
const path = require('path');

const SHOTS = [
  ['s-a1', 'A1-admin-records-payee'],
  ['s-b1', 'B1-organiser-offered-choice'],
  ['s-b2', 'B2-organiser-picks-institution'],
  ['s-b3', 'B3-organiser-bill-number'],
  ['s-b4', 'B4-organiser-what-they-give-up'],
  ['s-c1', 'C1-donor-campaign-page'],
  ['s-c2', 'C2-donor-donate-screen'],
  ['s-c3', 'C3-donor-receipt'],
  ['s-d1', 'D1-admin-releases-funds'],
];

(async () => {
  const dir = __dirname;
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('file://' + path.join(dir, 'journey.html'), { waitUntil: 'networkidle' });
  // Fonts must be in before we measure or shoot: a fallback face changes every line break.
  await page.evaluate(() => document.fonts.ready);

  for (const [id, name] of SHOTS) {
    const el = page.locator('#' + id);
    const n = await el.count();
    if (n !== 1) { console.log(`MISSING ${id} (count=${n})`); continue; }
    const out = path.join(dir, name + '.png');
    await el.screenshot({ path: out });
    await require('sharp')(out).jpeg({ quality: 82, mozjpeg: true }).toFile(out.replace(/\.png$/, '.jpg'));
    const box = await el.boundingBox();
    console.log(`${name}.png  ${Math.round(box.width)}x${Math.round(box.height)}`);
  }

  // Overflow check: a frame is fixed-height, so content taller than it is content nobody sees.
  const over = await page.evaluate(() =>
    [...document.querySelectorAll('.frame')].map((f) => ({
      id: f.id,
      clipped: f.scrollHeight - f.clientHeight,
    })).filter((r) => r.clipped > 1),
  );
  console.log('CLIPPED:', JSON.stringify(over));
  console.log('CONSOLE_ERRORS:', errors.length ? JSON.stringify(errors) : 'none');
  await browser.close();
})();
