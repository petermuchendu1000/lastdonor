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
 *   3. A signed-in dashboard surface may not render a JSX `href` to
 *      `/campaigns/${slug}` unless the file consults a visibility guard.
 *
 * ⚠️ **Rule 3 exists because rule 1 had a hole, and the hole was in the
 * matcher, not the principle.** The header above states `docs/118`'s rule as
 * *"before rendering ANY link to `/campaigns/<slug>`"* - and rule 1 matches
 * only `` link:`/campaigns/${ ``, the notification-property spelling. A JSX
 * `` href={`/campaigns/${ `` is invisible to it. Three dashboard surfaces were
 * handing out 404s the whole time (`docs/154`): `/dashboard`'s "View" link,
 * and on `/dashboard/supported` and `/dashboard/subscriptions` the title, the
 * thumbnail and a **"Donate Again"** button pointing at a campaign that cannot
 * take a donation. Same shape as `docs/116` §4, `docs/146` §6.1, `docs/147`
 * and `docs/121` §3: the rule is right and the matcher sees one spelling.
 *
 * ⚠️ And the near-miss is written in the repo: `dashboard/campaigns/[id]`
 * carries the comment *"This was the THIRD ungated link ... docs/109 found the
 * wizard redirect and the dashboard 'View' button"*. `docs/109` fixed the
 * "View" button in `CampaignsListClient` - the one on `/dashboard/campaigns` -
 * while `/dashboard` had its own, same label, same template literal. The fix
 * went to the page that was being looked at.
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

  it('a slug IS still allowed on the three children that accept one (control)', () => {
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

describe('⛔ rule 3: a dashboard link to a public campaign page is guarded', () => {
  /*
    SCOPE, and why it is derived rather than an allowlist.

    A signed-in surface lists campaigns by OWNERSHIP or RELATIONSHIP - your own
    campaigns whatever their status, the ones you gave to, the ones you follow -
    so it can hold a campaign with no public page. A public surface reached its
    campaign through a filter that already required visibility
    (`listedCampaignFilter`, `docs/147`), so its links are sound by
    construction. That boundary is a property of the directory, not a list of
    blessed files.

    ⛔ Admin is deliberately OUT of scope and that is recorded, not forgotten:
    `docs/120` §12 already reports `AdminDashboard`, `UserDetail` and
    `admin/screening` as unfixed, with the reason that their row shapes carry
    no status, so guarding them means changing three queries. Naming them as
    exemptions here would be an allowlist, and `docs/152` is about what falls
    through one.
  */
  const DASHBOARD = /^src\/(app\/dashboard|components\/dashboard)\//;

  it('found the dashboard surfaces (anti-vacuity)', () => {
    const files = sourceFiles().filter((f) => DASHBOARD.test(f));
    expect(files.length, 'no dashboard files scanned - rule 3 is vacuous').toBeGreaterThan(10);
  });

  it('no dashboard file writes a public campaign href by hand, at all', () => {
    /*
      ⛔ AN ABSENCE, and that shape was arrived at by injection after two
      weaker rules were DEFEATED. Recorded because the failures are the useful
      part (`docs/154` §6):

        v1 "the file mentions a guard" - satisfied by a LEFTOVER IMPORT after
           the call is deleted. `docs/146` §6.1 and `docs/147` both met exactly
           that.
        v2 "guard uses >= hrefs, imports excluded, following the resolved
           local" - survived the import hole, and FOUR injections still did not
           fire: removing the gate from ONE of two links in `supported`, and
           turning `{x.campaignHref ? (` into `{true ? (` in three files where
           the prop's NAME still appears in a type declaration. A line count
           cannot see which href is guarded.

      So the hand-written form is forbidden outright. `publicCampaignPath`
      returns `string | null` - the type system then carries the obligation,
      and `href={publicHref}` cannot be "accidentally ungated" because there is
      nothing to gate. This is `docs/147`'s conclusion reached again: *"Rule 1
      is now ABSOLUTE."*
    */
    const offenders = scan((l) => /href=\{`\/campaigns\/\$\{/.test(l))
      .filter((h) => DASHBOARD.test(h.file));
    expect(
      offenders,
      `A dashboard surface can hold a campaign with no public page - your own ` +
        `campaign sits \`under_review\` the whole time you are waiting, and a ` +
        `campaign you gave to can be archived afterwards (docs/118 §2.5). ` +
        `Build the href with publicCampaignPath({ slug, status, publishedAt }), ` +
        `which returns null, and render plain text when it does. ` +
        `docs/118, docs/131, docs/154.\n${show(offenders)}`,
    ).toEqual([]);
  });

  it('the builder IS called on the dashboard, so rule 3 is not satisfied by deleting the links', () => {
    /*
      The control, and it is what stops the rule above being satisfied by
      removing every campaign link from the dashboard - or by rendering the
      href from a bare variable nobody computed.

      ⚠️ Import lines do not count. That is the `docs/146` §6.1 hole, kept out
      of the control as well as out of the rule.
    */
    const callers = sourceFiles()
      .filter((f) => DASHBOARD.test(f))
      .filter((f) =>
        stripComments(readFileSync(resolve(ROOT, f), 'utf8'))
          .split('\n')
          .some((l) => !/^\s*import\b/.test(l) && /publicCampaignPath\(/.test(l)),
      );
    expect(callers.length, `dashboard files calling the builder: ${callers.join(', ')}`)
      .toBeGreaterThanOrEqual(8);
    for (const required of [
      'src/app/dashboard/(index)/page.tsx',
      'src/app/dashboard/supported/page.tsx',
      'src/app/dashboard/subscriptions/page.tsx',
      'src/app/dashboard/updates/page.tsx',
      'src/app/dashboard/finances/page.tsx',
      'src/app/dashboard/finances/payouts/page.tsx',
      'src/app/dashboard/campaigns/[id]/page.tsx',
      'src/components/dashboard/CampaignsListClient.tsx',
    ]) {
      expect(callers, `${required} must still build its campaign link`).toContain(required);
    }
  });

  it('⚠️ the two client components still receive a RESOLVED href, never a slug', () => {
    /*
      `subscriptions/client.tsx` and `FinancesClient.tsx` are `'use client'`,
      so they cannot ask the database. They take `campaignHref: string | null`
      from the server. If either ever took a slug again, the rule above would
      catch the template literal - this asserts the positive half, so the prop
      cannot quietly become a boolean (which is what v2 of the rule could not
      distinguish).
    */
    for (const file of [
      'src/app/dashboard/subscriptions/client.tsx',
      'src/components/dashboard/FinancesClient.tsx',
      'src/components/dashboard/ImpactLinkRow.tsx',
    ]) {
      const src = stripComments(readFileSync(resolve(ROOT, file), 'utf8'));
      expect(src, `${file} must take a resolved href`).toMatch(
        /campaignHref\s*:\s*string \| null/,
      );
    }
  });
});
