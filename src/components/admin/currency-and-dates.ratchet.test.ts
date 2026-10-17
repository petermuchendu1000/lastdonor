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
const DOLLAR_DENOMINATED = new Set(['PipelineMonitor.tsx', 'SystemSettings.tsx']);

describe('one currency renderer across the admin (F4/F5)', () => {
  it.each(files.filter((f) => !DOLLAR_DENOMINATED.has(f)))(
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
    'src/app/admin/page.tsx',
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
