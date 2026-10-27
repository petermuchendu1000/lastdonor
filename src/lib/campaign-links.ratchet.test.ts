/**
 * A link to a campaign is BUILT, never hand-written.
 *
 * ── WHY A RATCHET ───────────────────────────────────────────────────────────
 *
 * `docs/109` set the rule - *before rendering ANY link to `/campaigns/<slug>`,
 * call `hasPublicPage`* - and enforced it for links in the UI. Notifications
 * were never swept, and two of them handed a person a 404 (`docs/118`). The
 * unit tests cover the builder; nothing stopped the twenty-first call site
 * from being written by hand again, which is how the first twenty happened.
 *
 * Two rules, both discovered from disk rather than from a list of files:
 *
 *   1. A notification `link:` that interpolates a campaign slug must come from
 *      `publicCampaignPath`.
 *   2. Nothing may link to `/dashboard/campaigns/${...slug...}` with no child
 *      segment - that route is UUID-only and calls `notFound()` on a slug.
 *
 * ⚠️ **Comments are stripped first.** This is the `docs/116` §4 lesson and it
 * is not hypothetical here: `campaign-links.ts` and `notifications.ts` both
 * EXPLAIN this defect in prose, and that prose necessarily quotes the
 * forbidden strings. A raw-source match reports the fix as the defect.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';

const ROOT = resolve(__dirname, '../..');

/** Blank out comments and keep the length, so line numbers still line up. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

function sourceFiles(): string[] {
  return globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
    .map((f) => f.replace(/\\/g, '/'));
}

function scan(predicate: (line: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles()) {
    const stripped = stripComments(readFileSync(resolve(ROOT, file), 'utf8'));
    stripped.split('\n').forEach((line, i) => {
      if (predicate(line)) hits.push({ file, line: i + 1, text: line.trim() });
    });
  }
  return hits;
}

const show = (hits: Hit[]) =>
  hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');

describe('the sweep can actually see the code', () => {
  it('found the source files and the builder', () => {
    // Without this, every assertion below passes against an empty scan.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain('src/lib/campaign-links.ts');
    expect(files).toContain('src/lib/notifications.ts');
  });

  it('strips comments but keeps code', () => {
    const src = [
      '/* link: `/campaigns/${p.campaignSlug}`, */',
      'const real = 1;',
      '// link: `/campaigns/${p.campaignSlug}`,',
    ].join('\n');
    const out = stripComments(src);
    expect(out).not.toContain('campaignSlug');
    expect(out).toContain('const real = 1;');
    // Length preserved, so reported line numbers are trustworthy.
    expect(out.split('\n').length).toBe(3);
  });

  it('⛔ stripping is load-bearing on a REAL file in this repo, not just in theory', () => {
    /*
      The docs/116 §4 hazard, demonstrated rather than asserted: the comment
      in the moderation route that EXPLAINS the old broken link necessarily
      quotes it, so the raw source still contains `/campaigns/${…}` while the
      code no longer does. A sweep without stripping would report the fix as
      the defect - which is exactly what happened in docs/116.
    */
    const file =
      'src/app/api/v1/admin/campaigns/[campaignId]/messages/[messageId]/moderate/route.ts';
    const raw = readFileSync(resolve(ROOT, file), 'utf8');
    expect(raw, 'the explanatory comment should still be there').toMatch(
      /\/campaigns\/\$\{/,
    );
    expect(stripComments(raw), 'but no CODE may build that link').not.toMatch(
      /\/campaigns\/\$\{/,
    );
  });
});

describe('⛔ rule 1: a campaign notification link is built, not written', () => {
  it('no `link:` hand-builds a public campaign URL', () => {
    const hits = scan(
      (l) => /\blink:\s*`\/campaigns\/\$\{/.test(l),
    );
    expect(
      hits,
      `A notification link to the public campaign page must be built by ` +
        `publicCampaignPath({ slug, status }) so a campaign with no public ` +
        `page yields null instead of a 404. docs/118.\n${show(hits)}`,
    ).toEqual([]);
  });

  it('the builder IS used, so rule 1 is not satisfied by deleting the links', () => {
    // The control. Without it, removing every notification link passes above.
    const used = scan((l) => /publicCampaignPath\(/.test(l));
    expect(used.length, show(used)).toBeGreaterThanOrEqual(10);
    expect(used.some((h) => h.file === 'src/lib/notifications.ts')).toBe(true);
  });
});

describe('⛔ rule 2: the organiser campaign route is UUID-only', () => {
  it('nothing links a slug at `/dashboard/campaigns/<x>` with no child segment', () => {
    /*
      `[id]/page.tsx:33` is `if (!UUID_RE.test(id)) notFound()`. A template
      whose interpolation is named ...Slug... and which ends right after it
      (backtick, quote or `?`) addresses that route with a slug.
    */
    const hits = scan((l) =>
      /\/dashboard\/campaigns\/\$\{[^}]*[Ss]lug[^}]*\}(?![/\w])/.test(l),
    );
    expect(
      hits,
      `/dashboard/campaigns/[id] rejects a slug with notFound(). Use ` +
        `organiserCampaignPath(campaignId) - the id form works on all seven ` +
        `screens, a slug on only three. docs/118.\n${show(hits)}`,
    ).toEqual([]);
  });

  it('a slug IS still allowed on the three children that accept one', () => {
    /*
      Not a defect, and the rule above must not forbid it: `verification`,
      `impact-update` and `payout-destination` branch on a UUID regex and fall
      back to `eq(campaigns.slug, …)`. This asserts the rule is narrow enough
      to leave them alone - otherwise rule 2 would be over-broad and someone
      would "fix" working code.
    */
    const sample = 'link: `/dashboard/campaigns/${p.campaignSlug}/verification`,';
    expect(
      /\/dashboard\/campaigns\/\$\{[^}]*[Ss]lug[^}]*\}(?![/\w])/.test(sample),
    ).toBe(false);
  });
});
