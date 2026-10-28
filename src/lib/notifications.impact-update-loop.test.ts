import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve } from 'node:path';
import { isNavigablePath } from '@/lib/navigable-routes';
import {
  impactUpdateApprovedEmail,
  impactUpdateChangesRequestedEmail,
} from '@/lib/email-templates';

/*
  ─────────────────────────────────────────────────────────────────────────
  THE IMPACT-UPDATE LOOP TELLS SOMEBODY AT BOTH ENDS.             docs/139
  ─────────────────────────────────────────────────────────────────────────

  An impact update is an organiser's report on how a family's money was
  spent. The whole loop was silent in both directions:

    organiser submits  -> no admin told, and no admin screen existed
    admin decides      -> organiser never told

  Three purpose-built notification functions existed for exactly those three
  moments and all three had ZERO callers. [VERIFIED four ways, the fourth by
  executing the codebase's own route oracle: `isNavigablePath` returned false
  for `/admin/impact-updates`, the link the admin notification pointed at.]

  ⚠️ Production had 0 `impact_updates` rows, so nothing had happened to
  anybody yet. This is the loop closing before the first one arrives, not a
  repair of something that went wrong.
*/

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const NOTIFICATIONS = 'src/lib/notifications.ts';
const SUBMIT_ROUTE = 'src/app/api/v1/user-campaigns/[id]/impact-update/route.ts';
const REVIEW_ROUTE = 'src/app/api/v1/admin/impact-updates/[id]/review/route.ts';
const QUEUE_UI = 'src/components/admin/ImpactUpdateQueue.tsx';

const IMPACT_FNS = [
  'notifyAdminImpactUpdateSubmitted',
  'notifyCreatorImpactUpdateApproved',
  'notifyCreatorImpactUpdateRejected',
] as const;

/** Every `notify*` function in the module, with its body. */
function notifyBodies(): Map<string, string> {
  const parts = read(NOTIFICATIONS).split(/^export async function (notify\w+)/m);
  const out = new Map<string, string>();
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i], parts[i + 1]);
  return out;
}

/** Files that could call a notification: app code, not the module, not tests. */
function appFiles(): string[] {
  return [
    ...globSync('src/**/*.ts', { cwd: ROOT }),
    ...globSync('src/**/*.tsx', { cwd: ROOT }),
  ].filter((f) => f !== NOTIFICATIONS && !f.includes('.test.'));
}

describe('the impact-update loop notifies at both ends', () => {
  /*
    ── RULE 0, ANTI-VACUITY ──
    If the scan could not find the functions or the routes, every rule below
    would pass over nothing. This is the check that the checks have a subject.
  */
  it('⚠️ CONTROL: the functions and both route files are found', () => {
    const bodies = notifyBodies();
    expect(bodies.size).toBeGreaterThan(30);
    for (const fn of IMPACT_FNS) expect(bodies.has(fn)).toBe(true);
    expect(read(SUBMIT_ROUTE).length).toBeGreaterThan(1000);
    expect(read(REVIEW_ROUTE).length).toBeGreaterThan(1000);
  });

  /*
    ── RULE 1, THE ROOT CAUSE ──
    Derived: searches all app code for a call, rather than asserting that one
    named file contains one named string. A function nobody calls sends
    nothing, however correct it is.
  */
  it('⛔ all three impact-update notifications have a caller in app code', () => {
    const files = appFiles().map((f) => ({ f, src: strip(read(f)) }));
    const dead: string[] = [];
    for (const fn of IMPACT_FNS) {
      const pat = new RegExp(`\\b${fn}\\s*\\(`);
      if (!files.some(({ src }) => pat.test(src))) dead.push(fn);
    }
    expect(
      dead,
      `these send nothing because nothing calls them:\n${dead.join('\n')}`,
    ).toEqual([]);
  });

  /*
    ── RULE 2 ──
    Both ends, named. Rule 1 would be satisfied by one call from anywhere;
    the point is that the SUBMIT route tells an admin and the REVIEW route
    tells the organiser.
  */
  it('⛔ the submit route tells an admin and the review route tells the organiser', () => {
    const submit = strip(read(SUBMIT_ROUTE));
    expect(submit, 'submitting must notify an admin').toMatch(
      /notifyAdminImpactUpdateSubmitted\s*\(/,
    );
    // Both the first submission and the resubmission after a change.
    expect(
      submit.match(/notifyAdminImpactUpdateSubmitted\s*\(/g)?.length ?? 0,
      'the resubmission path needs it too - it only happens after a refusal',
    ).toBe(2);

    const review = strip(read(REVIEW_ROUTE));
    expect(review).toMatch(/notifyCreatorImpactUpdateApproved\s*\(/);
    expect(review).toMatch(/notifyCreatorImpactUpdateRejected\s*\(/);
  });

  /*
    ── RULE 3, EXECUTABLE ──
    This is the rule that would have caught the original defect, and it runs
    the codebase's own route oracle rather than reading text: the admin
    notification's link must be a page that exists.
  */
  it('⛔ the admin notification links at a page that exists', () => {
    const body = notifyBodies().get('notifyAdminImpactUpdateSubmitted')!;
    const m = strip(body).match(/link:\s*['"`]([^'"`]+)['"`]/);
    expect(m, 'the notification must carry a literal link to check').not.toBeNull();
    const link = m![1];
    expect(
      isNavigablePath(link),
      `the admin notification points at ${link}, which no page serves`,
    ).toBe(true);
    // Control: the oracle must be capable of saying no.
    expect(isNavigablePath('/admin/not-a-real-page')).toBe(false);
  });

  /*
    ── RULE 4 ──
    A refusal carries a reason, enforced at BOTH ends (docs/109's shape): the
    route refuses, and the button is unavailable until there is something to
    send. The organiser is emailed the admin's words, so an empty reason
    renders "What they said:" and nothing.
  */
  it('⛔ a reject needs a reason, in the route and in the UI', () => {
    expect(strip(read(REVIEW_ROUTE)), 'the route must refuse a reasonless reject')
      .toMatch(/action === 'reject' &&[\s\S]{0,120}length < 3/);
    expect(strip(read(QUEUE_UI)), 'and the control must not offer it')
      .toMatch(/disabled=\{[\s\S]{0,120}length < 3\}/);
  });

  /*
    ── RULE 5 ──
    No notification may write its email body inline. An inline `html:` goes
    straight to `resend.emails.send` (`createAndEmail`, :133/:153-157), which
    puts it outside `renderEmail` and therefore outside BOTH email sweeps -
    the plain-language budget and the dark-mode contrast ratchet each read
    `EMAIL_SOURCE_FILES`, a list of two files (docs/123 §4).

    These two functions were the only two of the forty that did it.
  */
  it('⛔ no notification writes its email body as an inline html literal', () => {
    const offenders: string[] = [];
    for (const [name, body] of notifyBodies()) {
      if (/html:\s*`/.test(strip(body))) offenders.push(name);
    }
    expect(
      offenders,
      `these bypass renderEmail and both email sweeps:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  /*
    ── RULE 6 ──
    `reviewerNotes` is an admin's own typed words going into email markup -
    the hazard docs/93 escapes on the campaign refusal reason. Executed, not
    read: render both templates with a payload that would break out.
  */
  it('⛔ the two templates escape what is interpolated into them', () => {
    const nasty = '<script>alert(1)</script>';
    const approved = impactUpdateApprovedEmail({
      campaignerName: nasty,
      campaignTitle: nasty,
      campaignUrl: 'https://example.test/c',
    });
    const changes = impactUpdateChangesRequestedEmail({
      campaignerName: nasty,
      campaignTitle: nasty,
      reason: nasty,
      updateUrl: 'https://example.test/u',
    });
    for (const [label, mail] of [['approved', approved], ['changes', changes]] as const) {
      expect(mail.html, `${label} must not emit a raw script tag`).not.toContain(
        '<script>',
      );
      expect(mail.html, `${label} must have escaped it rather than dropped it`).toContain(
        '&lt;script&gt;',
      );
    }
  });

  /*
    ── RULE 7 ──
    An audit event type is a literal, not a string built from a variable.

    The review route wrote `` `impact_update.${action}d` ``, which for
    `action: 'reject'` emitted **`impact_update.rejectd`** - caught by
    executing the route and reading the row, after lint, typecheck and the
    whole suite passed over it.

    `docs/137` §5 named this as the one case its event-type sweep could not
    see: *"an event type assembled from a variable yields nothing. No such
    site is known, and none was searched for."* This was that site.
  */
  it('⛔ both impact-update routes write literal audit event types', () => {
    for (const f of [SUBMIT_ROUTE, REVIEW_ROUTE]) {
      const src = strip(read(f));
      const assembled = [...src.matchAll(/eventType:\s*`([^`]*)`/g)]
        .filter((m) => m[1].includes('${'))
        .map((m) => m[1]);
      expect(
        assembled,
        `${f} builds an event type from a variable - unreadable to the docs/137 sweep, and how "rejectd" hid:\n${assembled.join('\n')}`,
      ).toEqual([]);
    }
    // And the correct spellings are the ones present.
    const review = strip(read(REVIEW_ROUTE));
    expect(review).toContain("'impact_update.approved'");
    expect(review).toContain("'impact_update.rejected'");
    expect(review, 'the typo must not come back').not.toContain('rejectd');
  });

  /*
    ── RULE 8, THE CONTROL ──
    Without this, deleting the queue screen would leave rules 1-4 satisfiable
    while no admin could reach the decision at all.
  */
  it('⚠️ CONTROL: an admin-gated screen renders the queue and calls the review route', () => {
    const page = strip(read('src/app/admin/impact-updates/page.tsx'));
    expect(page, 'the page must gate non-admins').toMatch(
      /role !== 'admin'[\s\S]{0,80}redirect/,
    );
    expect(page).toMatch(/<ImpactUpdateQueue/);
    const ui = strip(read(QUEUE_UI));
    expect(ui, 'and must be able to act on a row').toMatch(
      /impact-updates\/\$\{[^}]+\}\/review/,
    );
  });
});
