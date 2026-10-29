import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The brand is appended by ONE place, so a page title must not carry it.
 *
 * ## The defect this encodes (docs/142)
 *
 * `src/app/layout.tsx` sets `title: { template: '%s | LastDonor' }`, and six
 * public templates ended their OWN title with the brand as well, so
 * production served it twice - measured verbatim:
 *
 *   Browse Reviewed Medical & Emergency Crowdfunding Campaigns | LastDonor | LastDonor
 *   Help Tuan Nguyen Rebuild After Fire Destroys San Jose Home | LastDonor.org | LastDonor
 *   Donate to Help Tuan Nguyen Rebuild After Fire Destroys San Jose Home | LastDonor.org | LastDonor
 *
 * The last two are the campaign page and its donate page - the money pages -
 * at 86 and 96 characters.
 *
 * ## What this does NOT forbid
 *
 * A brand mention INSIDE the sentence ("About LastDonor.org", "How LastDonor
 * Works") is editorial and legitimate; only a trailing brand suffix duplicates
 * the template. And `openGraph` / `twitter` titles are NEVER templated by
 * Next, so they keep their brand - those blocks are removed before scanning,
 * which is why `campaigns/category/[category]` passes: it hands the template a
 * bare `seoTitle` and puts the brand in `openGraph` only.
 */

const APP = __dirname;
const SKIP_DIRS = new Set(['node_modules', '.next', 'admin', 'dashboard']);

function pageFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pageFiles(full, acc);
    else if (/^(page|layout)\.tsx$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Remove a brace-matched `key: { … }` block wherever it appears. */
function stripBlock(src: string, key: string): string {
  let out = src;
  for (;;) {
    const at = out.indexOf(`${key}: {`);
    if (at === -1) return out;
    let depth = 0;
    let i = out.indexOf('{', at);
    const start = i;
    for (; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    out = out.slice(0, at) + out.slice(i + 1);
    if (start === -1) return out;
  }
}

/** The brand suffix the root layout appends, read from the layout itself. */
function templateBrand(): string {
  const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
  const m = layout.match(/template:\s*'%s\s*\|\s*([^']+)'/);
  if (!m) throw new Error('could not read the title template from layout.tsx');
  return m[1]!.trim();
}

const BRAND = templateBrand();
const FILES = pageFiles(APP).filter((f) => f !== join(APP, 'layout.tsx'));

/** Page-level `title:` string literals, with og/twitter blocks removed. */
function pageTitles(file: string): string[] {
  let src = readFileSync(file, 'utf8');
  src = stripBlock(src, 'openGraph');
  src = stripBlock(src, 'twitter');
  const titles: string[] = [];
  for (const m of src.matchAll(/\btitle:\s*(['"`])([^'"`]*)\1/g)) titles.push(m[2]!);
  return titles;
}

describe('the brand suffix is appended exactly once', () => {
  it('reads the brand out of the layout template', () => {
    // Anti-vacuity: if this stopped resolving, every rule below would pass on
    // an empty needle.
    expect(BRAND.length).toBeGreaterThan(3);
    expect(BRAND).toBe('LastDonor');
  });

  it('finds public page files to scan', () => {
    expect(FILES.length).toBeGreaterThan(25);
  });

  it('no page title ends with the brand the template already adds', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const t of pageTitles(f)) {
        const tail = t.replace(/\s+$/, '');
        if (new RegExp(`\\|\\s*${BRAND}(\\.org)?$`, 'i').test(tail)) {
          offenders.push(`${f.slice(APP.length + 1)} :: ${t}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still permits the brand inside a title sentence', () => {
    // A control: this rule must not be satisfiable only by banning the word.
    const sentence = 'How LastDonor Works | Start, Review, Donate, Track Impact';
    expect(new RegExp(`\\|\\s*${BRAND}(\\.org)?$`, 'i').test(sentence)).toBe(false);
  });

  it('and the matcher really fires on the shape production served', () => {
    for (const bad of [
      'Browse Reviewed Medical & Emergency Crowdfunding Campaigns | LastDonor',
      'Completed Campaigns | LastDonor.org',
      'Campaign Stories & Impact Updates | LastDonor',
    ]) {
      expect(new RegExp(`\\|\\s*${BRAND}(\\.org)?$`, 'i').test(bad)).toBe(true);
    }
  });

  it('strips openGraph blocks, so a branded og title is still allowed', () => {
    const sample = [
      'export const metadata = {',
      "  title: 'Completed Campaigns',",
      '  openGraph: {',
      "    title: 'Completed Campaigns | LastDonor.org',",
      '  },',
      '};',
    ].join('\n');
    const stripped = stripBlock(sample, 'openGraph');
    expect(stripped).toContain("title: 'Completed Campaigns',");
    expect(stripped).not.toContain('LastDonor.org');
  });
});
