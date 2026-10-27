/**
 * Publishing a campaign has ONE writer, and it is the one that records who
 * decided.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * "Every campaign is reviewed by a person before it goes live" is asserted in
 * ~44 lines across 23 files, including the site title and the `/compare`
 * table. The only evidence that it is true of a given row is an
 * `audit_logs` entry: `docs/116` §8 proved five machine-written campaigns had
 * gone public unreviewed precisely because they had `published_at` set and
 * ZERO `campaign.published` rows.
 *
 * That forensic method is sound only while every publication path logs. And
 * one did not. `PUT /api/v1/campaigns/[slug]` accepted a `status` and, on
 * `'active'`, stamped `publishedAt` - with no transition check, no audit row,
 * no email, and re-stamping an already-live campaign on every save. It was
 * not obscure: `/admin`'s own "Review" link, the `[Admin] Review needed`
 * email's CTA and the in-app notification all pointed at
 * `/admin/campaigns/<id>/edit`, which handed an `under_review` campaign to
 * `CampaignEditor` as `'active'` (anything not `draft` was coerced) and PUT
 * the whole form back. **An admin who opened the review link and pressed Save
 * published the campaign.** Two clicks from the dashboard, and the row it
 * produced is indistinguishable from one nobody ever read.
 *
 * `docs/120`.
 *
 * ── WHY A DISK SWEEP, AND WHY IT RESOLVES VARIABLES ─────────────────────────
 *
 * `docs/116` §4's lesson is that a gate test naming its own inputs is worth
 * little: `publisher-review-gate.test.ts` searched two files by hand and
 * missed `.insert(schema.campaigns)` in a third. So this discovers the write
 * sites from the tree.
 *
 * ⚠️ And it must follow a variable. The approval route builds
 * `const updates: Record<string, unknown> = {...}`, then
 * `updates.publishedAt = new Date()`, then `.set(updates)` - so a sweep that
 * only brace-matches the `.set({...})` literal sees NOTHING there. My own
 * first pass over this question reported `publishedAt` as having one writer
 * for exactly that reason, and six of the 43 sites in `src/` pass a variable.
 * It is the `docs/108` lesson in a second place: a grep proves text, not
 * semantics.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

/**
 * The only places allowed to write `campaigns.published_at` in an UPDATE.
 *
 * Both of them key the stamp on the column being NULL, so a republish cannot
 * silently re-date a campaign that was already live, and both write an audit
 * row naming the actor.
 *
 * ⛔ Adding an entry here is a decision about who may publish a campaign.
 * Read `docs/120` §3 first; the point of the list is that it is short.
 */
const PUBLISHED_AT_WRITERS = [
  // The approval route. Checks ALLOWED_TRANSITIONS, writes
  // `campaign.published`, emails the organiser "Your Campaign Is Live!".
  'src/app/api/v1/admin/campaigns/[campaignId]/route.ts',
  // Resume. A campaign can reach `paused` without ever having been public,
  // so resuming it is a first publication and must be dated as one.
  'src/app/api/v1/admin/campaigns/[campaignId]/resume/route.ts',
] as const;

/* ── the sweep ─────────────────────────────────────────────────────────── */

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length));
}

/** The text from the first `{` after `from` to its matching `}`. */
function braceMatched(source: string, from: number): string {
  const open = source.indexOf('{', from);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  // Unbalanced reads as "look at everything", never as a pass.
  return source.slice(open);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

type Site = { file: string; line: number; viaVariable: boolean; written: string };

/**
 * Every `.update(campaigns).set(...)` in `src/`, with what it writes.
 *
 * For `.set(someVariable)` the variable is resolved to its declaration object
 * plus every `someVariable.key =` assignment in the file, which is how the
 * approval route assembles its update.
 */
function campaignUpdateSites(): Site[] {
  const sites: Site[] = [];
  for (const file of sourceFiles(resolve(ROOT, 'src'))) {
    const src = stripComments(readFileSync(file, 'utf-8'));
    for (const match of src.matchAll(/\.update\(\s*(?:schema\.)?campaigns\s*\)/g)) {
      const setIdx = src.indexOf('.set(', match.index ?? 0);
      if (setIdx === -1) continue;
      const varName = /^\s*([A-Za-z_$][\w$]*)\s*\)/.exec(src.slice(setIdx + 5, setIdx + 60))?.[1];
      let written: string;
      if (varName) {
        const decl = src.search(new RegExp(`(const|let|var)\\s+${varName}\\b`));
        const obj = decl >= 0 ? braceMatched(src, decl) : '';
        const assigns = [...src.matchAll(new RegExp(`\\b${varName}\\.([A-Za-z_$][\\w$]*)\\s*=`, 'g'))]
          .map((m) => `${m[1]}:`)
          .join(' ');
        written = `${obj} ${assigns}`;
      } else {
        written = braceMatched(src, setIdx);
      }
      sites.push({
        file: file.slice(ROOT.length + 1),
        line: src.slice(0, match.index ?? 0).split('\n').length,
        viaVariable: Boolean(varName),
        written,
      });
    }
  }
  return sites;
}

const SITES = campaignUpdateSites();

/* ── the sweep can see what it claims to ───────────────────────────────── */

describe('the sweep is looking at something', () => {
  it('found the campaign updates in src/', () => {
    // An empty sweep passes against anything (docs/116 §4).
    expect(SITES.length).toBeGreaterThan(20);
  });

  it('⚠️ and it resolves `.set(variable)`, which is where the stamp lives', () => {
    const viaVar = SITES.filter((s) => s.viaVariable);
    expect(viaVar.length, 'no variable-assembled updates found - the resolver is dead code').toBeGreaterThan(0);
    // The approval route is the one that matters, and it is variable-assembled.
    const approval = viaVar.find((s) =>
      s.file === 'src/app/api/v1/admin/campaigns/[campaignId]/route.ts',
    );
    expect(approval, 'the approval route was not resolved through its variable').toBeTruthy();
    expect(approval!.written).toMatch(/publishedAt/);
  });
});

/* ── the invariant ─────────────────────────────────────────────────────── */

describe('⛔ only the recording routes may stamp published_at', () => {
  it('no other UPDATE in src/ writes campaigns.published_at', () => {
    const writers = SITES.filter((s) => /\bpublishedAt\b/.test(s.written));
    const offenders = writers
      .filter((s) => !(PUBLISHED_AT_WRITERS as readonly string[]).includes(s.file))
      .map((s) => `${s.file}:${s.line}`);
    expect(offenders).toEqual([]);
  });

  it('and both allowed writers are actually still there', () => {
    /*
      The control. Without it, deleting the stamp from both routes would
      satisfy the rule above - and a campaign that goes live with a null
      `published_at` is undated in the homepage order, the `/campaigns`
      "newest" sort and every sitemap `lastmod`.
    */
    const writers = SITES.filter((s) => /\bpublishedAt\b/.test(s.written)).map((s) => s.file);
    for (const expected of PUBLISHED_AT_WRITERS) {
      expect(writers, `${expected} no longer stamps published_at`).toContain(expected);
    }
  });

  it('⛔ and each one keys the stamp on the column being null', () => {
    /*
      Not on a previous status. `PUT /api/v1/campaigns/[slug]` stamped
      unconditionally, so every admin save re-dated an already-live
      campaign's publication.
    */
    for (const file of PUBLISHED_AT_WRITERS) {
      const src = stripComments(readFileSync(resolve(ROOT, file), 'utf-8'));
      expect(src, `${file} does not test publishedAt for null before stamping`).toMatch(
        /publishedAt === null/,
      );
    }
  });
});

describe('⛔ the public campaign route cannot change a status', () => {
  const PUT_ROUTE = 'src/app/api/v1/campaigns/[slug]/route.ts';
  const src = stripComments(readFileSync(resolve(ROOT, PUT_ROUTE), 'utf-8'));

  it('refuses a status outright rather than ignoring it', () => {
    /*
      ⚠️ An explicit 400, not a silent omission, and that is deliberate.
      `docs/116` §3 could leave `currency` to the field-by-field
      `updateValues` quietly dropping it, because nothing should ever send
      one. `status` had a live caller - "Restore to Draft" posted
      `{ status: 'draft' }` here - so a silent drop would have left a button
      that looked like it worked and did nothing.
    */
    expect(src).toMatch(/if \(data\.status !== undefined\) \{[\s\S]{0,400}?apiError\(/);
    expect(src).toMatch(/PATCH \/api\/v1\/admin\/campaigns/);
  });

  it('⛔ and does not write status or publishedAt at all', () => {
    expect(src).not.toMatch(/updateValues\.status\s*=/);
    expect(src).not.toMatch(/updateValues\.publishedAt\s*=/);
  });
});

describe('⛔ the admin editor does not carry a status', () => {
  it('the edit page passes the real status for display, not as a form value', () => {
    const page = stripComments(
      readFileSync(resolve(ROOT, 'src/app/admin/campaigns/[id]/edit/page.tsx'), 'utf-8'),
    );
    /*
      The coercion was the first half of the defect: anything that was not
      `draft` - including `under_review` - was handed to the editor as
      `'active'`, so the form showed "Active" for a campaign awaiting review.
    */
    expect(page).not.toMatch(/status:\s*campaign\.status === 'draft'/);
    expect(page).not.toMatch(/defaultValues=\{\{[\s\S]*?\bstatus:/);
    expect(page).toMatch(/currentStatus=\{campaign\.status\}/);
  });

  it('⛔ and edit mode deletes `status` from the payload', () => {
    /*
      Deleting the key is the fix, not belt-and-braces.
      `createCampaignSchema` declares `status: …default('draft')` and this
      form's resolver IS that schema, so zod fills the field whether or not
      anything renders it. Removing the control alone would make every admin
      save post `status: 'draft'` and UNPUBLISH the campaign.
    */
    const editor = stripComments(
      readFileSync(resolve(ROOT, 'src/components/admin/CampaignEditor.tsx'), 'utf-8'),
    );
    expect(editor).toMatch(/if \(mode === 'edit'\) delete payload\.status;/);
    expect(editor).toMatch(/body: JSON\.stringify\(payload\)/);
    // And the control itself is create-only.
    expect(editor).toMatch(/mode === 'create' \? \([\s\S]{0,600}?Initial Status/);
  });

  it('⛔ and the schema really does default status, which is why the delete matters', () => {
    /*
      A control on the premise. If `status` ever stops carrying a `.default()`,
      the paragraph above is wrong and somebody should re-read it rather than
      inherit the reasoning.
    */
    const validators = stripComments(
      readFileSync(resolve(ROOT, 'src/lib/validators/campaign.ts'), 'utf-8'),
    );
    expect(validators).toMatch(/status:\s*z\.enum\(\['draft', 'active'\]\)\.default\('draft'\)/);
  });
});

describe('⛔ every surface that says "review" points at a screen that can approve', () => {
  it('the dashboard, the email and the notification all link to the campaign page', () => {
    /*
      All three pointed at `/admin/campaigns/<id>/edit` - the one screen that
      published on save and could not approve properly. The campaign page is
      where the Approve, Suspend and Cancel controls are.
    */
    const dashboard = stripComments(
      readFileSync(resolve(ROOT, 'src/components/admin/AdminDashboard.tsx'), 'utf-8'),
    );
    const email = stripComments(readFileSync(resolve(ROOT, 'src/lib/email-templates.ts'), 'utf-8'));
    const notifications = stripComments(
      readFileSync(resolve(ROOT, 'src/lib/notifications.ts'), 'utf-8'),
    );

    // The dashboard's pending-review row action.
    const reviewLink = dashboard.slice(
      Math.max(0, dashboard.indexOf('Review\n') - 600),
      dashboard.indexOf('Review\n') + 10,
    );
    expect(reviewLink, 'the dashboard Review link still goes to the editor').not.toMatch(
      /\/edit`/,
    );

    // The review email's CTA.
    const cta = email.slice(email.indexOf('campaignSubmittedEmail'));
    const ctaBlock = cta.slice(0, cta.indexOf('\n}\n') + 3);
    expect(ctaBlock).not.toMatch(/\/admin\/campaigns\/' \+ p\.campaignId \+ '\/edit/);
    expect(ctaBlock).toMatch(/\/admin\/campaigns\/' \+ p\.campaignId/);

    // The in-app notification row.
    const notify = notifications.slice(notifications.indexOf('notifyAdminsCampaignSubmitted'));
    const notifyBlock = notify.slice(0, notify.indexOf('\n}\n') + 3);
    expect(notifyBlock).toMatch(/link: `\/admin\/campaigns\/\$\{p\.campaignId\}`/);
  });

  it('⛔ and the campaign page offers approval, not only refusal', () => {
    /*
      It had Suspend and Cancel and no approve control at all, so the screen
      an admin reads a queued campaign on could only say no. `docs/119` is the
      same shape from the other side: a door onto a room that refuses to open.
    */
    const detail = stripComments(
      readFileSync(resolve(ROOT, 'src/components/admin/CampaignDetail.tsx'), 'utf-8'),
    );
    expect(detail).toMatch(/const canApprove = campaign\.status === 'under_review'/);
    expect(detail).toMatch(/canApprove && \(/);
    // And it goes through the recording route.
    expect(detail).toMatch(/admin\/campaigns\/\$\{campaign\.id\}`,[\s\S]{0,80}method: 'PATCH'/);
  });
});

describe('⛔ refusing at review has one path, and cancel is not it', () => {
  it('under_review is not cancellable, on the server or in the UI', () => {
    const route = stripComments(
      readFileSync(
        resolve(ROOT, 'src/app/api/v1/admin/campaigns/[campaignId]/cancel/route.ts'),
        'utf-8',
      ),
    );
    const cancellable = /const CANCELLABLE[^=]*=\s*\[([^\]]*)\]/.exec(route)?.[1] ?? '';
    expect(cancellable, 'CANCELLABLE not found').not.toBe('');
    expect(cancellable).not.toMatch(/under_review/);

    const detail = stripComments(
      readFileSync(resolve(ROOT, 'src/components/admin/CampaignDetail.tsx'), 'utf-8'),
    );
    const canCancel = /const canCancel =[^;]*;/.exec(detail)?.[0] ?? '';
    expect(canCancel, 'canCancel not found').not.toBe('');
    expect(canCancel).toMatch(/under_review/); // present in the EXCLUSION list
    expect(canCancel).toMatch(/^const canCancel = !\[/);
  });

  it('⛔ and the cancel dialog offers the schema’s own reasons', () => {
    /*
      It sent `governanceReason || 'policy_violation'` into
      `z.enum(CANCELLATION_REASONS)`, and `policy_violation` is not in that
      enum - so the default 400'd and so did any sentence a human typed. The
      `docs/93` Suspend defect, repeated in the adjacent statement.
    */
    const detail = stripComments(
      readFileSync(resolve(ROOT, 'src/components/admin/CampaignDetail.tsx'), 'utf-8'),
    );
    expect(detail).not.toMatch(/'policy_violation'/);
    expect(detail).toMatch(/CANCELLATION_REASONS\.map/);
    expect(detail).toMatch(/body\.reason = governanceReason;/);
  });
});

describe('⛔ the pause transition goes to the route that implements it', () => {
  it('the client never PATCHes a status the server map rejects', () => {
    /*
      The client map offers `paused` for `active` and `last_donor_zone`; the
      server's `ALLOWED_TRANSITIONS` has no `paused` target, so both menu
      items 400'd. Derived from both sources rather than pinned, so aligning
      them either way keeps this true.
    */
    const list = stripComments(
      readFileSync(resolve(ROOT, 'src/components/admin/CampaignsList.tsx'), 'utf-8'),
    );
    const route = stripComments(
      readFileSync(resolve(ROOT, 'src/app/api/v1/admin/campaigns/[campaignId]/route.ts'), 'utf-8'),
    );

    const parseMap = (src: string): Record<string, string[]> => {
      const start = src.indexOf('ALLOWED_TRANSITIONS');
      const body = braceMatched(src, start);
      const out: Record<string, string[]> = {};
      for (const m of body.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
        out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      }
      return out;
    };
    const client = parseMap(list);
    const server = parseMap(route);
    expect(Object.keys(client).length, 'client map not parsed').toBeGreaterThan(5);
    expect(Object.keys(server).length, 'server map not parsed').toBeGreaterThan(5);

    // Which targets the UI sends somewhere other than PATCH.
    const rerouted = [...list.matchAll(/newStatus === '(\w+)' \? '(\w+)'/g)].map((m) => m[1]);
    // `suspended` is handled by the ternary's first branch, written differently.
    const allRerouted = new Set([...rerouted, 'suspended']);

    const unreachable: string[] = [];
    for (const [from, targets] of Object.entries(client)) {
      for (const to of targets) {
        if (allRerouted.has(to)) continue;
        if (!(server[from] ?? []).includes(to)) unreachable.push(`${from} -> ${to}`);
      }
    }
    expect(unreachable).toEqual([]);
  });
});

describe('⛔ a machine-drafted campaign is not described as published', () => {
  it('campaign.auto_drafted has its own sentence', () => {
    /*
      `campaign.auto_drafted` and `campaign.auto_published` shared one case
      returning "Campaign auto-published". Since `docs/79` the entire point of
      the first is that the campaign is NOT published and needs a person, and
      the activity feed is the only in-app surface a machine draft appears on
      at all.
    */
    const centre = stripComments(
      readFileSync(resolve(ROOT, 'src/components/admin/ActivityCenter.tsx'), 'utf-8'),
    );
    const drafted = centre.indexOf("case 'campaign.auto_drafted':");
    expect(drafted, "no case for campaign.auto_drafted").toBeGreaterThan(-1);
    /*
      ⚠️ Bounded by the NEXT `case`, not by a character count. The first
      version of this rule sliced a fixed 200 characters and so read the
      adjacent `campaign.auto_published` arm, reporting the fix as the
      defect - the same fixed-window mistake `docs/116` §4 was rewritten to
      remove, made again in the test written to remember it.
    */
    const nextCase = centre.indexOf('case ', drafted + 5);
    const block = centre.slice(drafted, nextCase === -1 ? centre.length : nextCase);
    expect(block).toMatch(/return `[^`]*waiting for review/);
    expect(block).not.toMatch(/return `Campaign auto-published/);
  });

  it('and it reaches the alert channel', () => {
    const page = stripComments(
      readFileSync(resolve(ROOT, 'src/app/admin/activity/page.tsx'), 'utf-8'),
    );
    const alerts = /const ALERT_EVENTS = \[([\s\S]*?)\]/.exec(page)?.[1] ?? '';
    expect(alerts, 'ALERT_EVENTS not found').not.toBe('');
    expect(alerts).toMatch(/campaign\.auto_drafted/);
    expect(alerts).toMatch(/campaign\.submitted/);
  });
});
