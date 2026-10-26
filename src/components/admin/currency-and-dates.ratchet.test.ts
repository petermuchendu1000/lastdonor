/**
 * Ratchets for docs/88 F4, F5 and F15.
 *
 * F5 was two formatters that were simply wrong: `PayoutsDashboard`
 * rendered 125050 cents as "$1,250.5" and 120000 as "$1,200" (no
 * fraction digits), and `RefundBatchDashboard` rendered "$1234.50" (no
 * separators) - while the SAME campaign showed "$1,250.50" on /admin,
 * because that screen used the shared renderer. Measured in production
 * before the fix.
 *
 * F4 is the cause: no admin component used `Money` or `centsToDollars`,
 * so there were five independent implementations to be inconsistent.
 *
 * F15 was every period boundary built from the server's local zone while
 * labelled plainly "Today".
 *
 * These are source ratchets, in the spirit of the docs/70 icon counts:
 * the point is that the next hand-rolled formatter cannot be added
 * quietly.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ADMIN = join(process.cwd(), 'src/components/admin');
const files = readdirSync(ADMIN).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));

/** Source with comments stripped, so a comment quoting old code cannot fail the ratchet. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/*
  `PipelineMonitor` is deliberately exempt: it renders AI spend already
  in DOLLARS, to four decimal places, because a day's spend is fractions
  of a cent. Running it through a cents renderer would be wrong, not
  consistent.
*/
/*
  `SystemSettings` is exempt for a different reason: its `CentsInput` is
  an editable field, and a form input must hold a bare numeric string.
  Putting "$1,250.50" in a text box the admin types into would break
  parsing on the next keystroke. Formatting for READING and formatting
  for EDITING are not the same job.
*/
const DOLLAR_DENOMINATED = new Set(['PipelineMonitor.tsx']);

/*
  ⚠️ `SystemSettings.tsx` WAS on that list and is not any more.

  Its exemption read: "its `CentsInput` is an editable field, and a form
  input must hold a bare numeric string". That is true, and that input is
  still untouched. But the same file also had a READ-ONLY `DisplayValue`
  using `Intl.NumberFormat('en-US', { currency: 'USD' })`, which the
  exemption never justified - a file-level allowlist entry covered a second
  code path nobody had looked at. Exempt the narrowest thing you can.
*/

/*
  `SystemSettings` keeps ONE narrow exemption: its `CentsInput` divides by
  100 to put a bare numeric string in an editable field, which is the
  original, correct reason. It is NOT exempt from the currency rules below -
  that is the half of the old file-level exemption that let a hardcoded
  `currency: 'USD'` survive in the same file's read-only `DisplayValue`.
*/
const HAND_DIVIDES_FOR_AN_INPUT = new Set(['SystemSettings.tsx']);

describe('one currency renderer across the admin (F4/F5)', () => {
  it.each(files.filter((f) => !DOLLAR_DENOMINATED.has(f) && !HAND_DIVIDES_FOR_AN_INPUT.has(f)))(
    '%s does not divide cents by 100 by hand',
    (file) => {
      const src = code(readFileSync(join(ADMIN, file), 'utf8'));
      // The exact shape of both broken formatters, and the correct-but-duplicated ones.
      expect(src).not.toMatch(/\/\s*100\s*\)\s*\.toLocaleString/);
      expect(src).not.toMatch(/\/\s*100\s*\)\s*\.toFixed\(2\)/);
    },
  );

  it('at least one admin screen now uses the shared renderer', () => {
    const users = files.filter((f) =>
      /from '@\/lib\/utils\/currency'|from '@\/components\/ui\/Money'/.test(
        readFileSync(join(ADMIN, f), 'utf8'),
      ),
    );
    expect(users.length).toBeGreaterThanOrEqual(8);
  });
});

describe('no server-local period boundaries (F15)', () => {
  const SERVER_FILES = [
    // `(index)` is a route group, so this is still `/admin`. It moved there
    // on 2026-10-18 so that `admin/loading.tsx` stops wrapping the
    // `admin/*/[id]` pages in a Suspense boundary, which was turning their
    // `notFound()` into HTTP 200 - see docs/80.
    'src/app/admin/(index)/page.tsx',
    'src/app/admin/reports/page.tsx',
    // `src/app/api/v1/admin/dashboard/route.ts` was here until docs/88
    // F10 deleted it as an orphan. Nothing called it.
    'src/lib/monitoring/ai-cost-tracker.ts',
  ];

  it.each(SERVER_FILES)('%s builds no date from the server clock', (rel) => {
    const src = code(readFileSync(join(process.cwd(), rel), 'utf8'));
    expect(src).not.toMatch(/new Date\(\s*\w*\.?getFullYear\(\)/);
  });

  it.each(SERVER_FILES)('%s uses the reporting-timezone helpers', (rel) => {
    expect(readFileSync(join(process.cwd(), rel), 'utf8')).toContain('@/lib/reporting-timezone');
  });

  it('the dashboard tells the reader which zone the periods are in', () => {
    const src = readFileSync(join(ADMIN, 'AdminDashboard.tsx'), 'utf8');
    expect(src).toContain('reportingTimezoneLabel');
  });
});

/*
  ─────────────────────────────────────────────────────────────────────────
  Added 2026-10-26. `docs/88` F4/F5 made the admin use ONE renderer. That
  renderer was `centsToDollars`, which hardcodes USD - so the screens became
  consistent and stayed wrong. On a platform collecting KES and USD, every
  admin money figure carried a dollar sign whatever currency the row held,
  and ten aggregates summed across currencies before printing.

  The rule is now: an amount is rendered in the currency of the row it came
  from. `Money` and `formatMoney` both take one; `centsToDollars` cannot.
  ─────────────────────────────────────────────────────────────────────────
*/
describe('admin money is rendered in its own currency (docs/92)', () => {
  it.each(files.filter((f) => !DOLLAR_DENOMINATED.has(f)))(
    '%s does not use the USD-only renderer',
    (file) => {
      const src = code(readFileSync(join(ADMIN, file), 'utf8'));
      expect(src).not.toMatch(/\bcentsToDollars\w*\s*\(/);
    },
  );

  it.each(files.filter((f) => !DOLLAR_DENOMINATED.has(f)))(
    '%s does not hardcode a currency in an Intl formatter',
    (file) => {
      const src = code(readFileSync(join(ADMIN, file), 'utf8'));
      expect(src).not.toMatch(/currency:\s*['"][A-Z]{3}['"]/);
    },
  );

  it('every <Money> in the admin is given a currency', () => {
    /*
      `Money`'s `currency` prop DEFAULTS to USD, so a bare `<Money minor={x} />`
      is a dollar sign nobody chose - the defect `DonorFeed` and `ImpactTiers`
      had on the public site. A default is what turns "nobody passed it" into
      "somebody chose dollars".
    */
    const offenders: string[] = [];
    for (const file of files) {
      const src = code(readFileSync(join(ADMIN, file), 'utf8'));
      for (const tag of src.match(/<Money\b[^>]*>/g) ?? []) {
        if (!/\bcurrency=/.test(tag)) offenders.push(`${file}: ${tag.slice(0, 70)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
