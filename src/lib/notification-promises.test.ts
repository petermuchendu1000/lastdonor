import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve } from 'node:path';

/*
  ─────────────────────────────────────────────────────────────────────────
  A WIRED NOTIFICATION MAY NOT PROMISE A CLOCK WE DO NOT RUN.      docs/140
  ─────────────────────────────────────────────────────────────────────────

  `docs/110` §7 refused to wire `verificationReminderEmail`, because every
  level of it opens with "reached its goal N days ago" and three threaten to
  return the donations - and [VERIFIED three ways, again today] NO mechanism
  sends money back on a clock:

    1. every refund call site is under `src/app/api/v1/admin/` - the admin
       donation PATCH and the admin campaign-cancel POST;
    2. the only two cron files that mention "refund" are
       `verification-reminders` (whose mention IS the comment recording this
       finding) and `reconcile`, where every mention is
       `donations.refunded = false` inside a READ;
    3. no cron route imports a refund helper.

  That ruling was written as prose about ONE function. Its sibling in
  `src/lib/email-adaptive.ts` was never swept, and says the same thing:

    `:856`  "You have N days remaining to complete verification. After that,
             we may need to return funds to donors."
    `:869`  subject: "N days left to verify ..."
    `:860`  "We can extend deadlines, help with documents, ..."

  Both are dead today. This rule does not delete them and does not forbid the
  programme - it makes them impossible to WIRE while they still say it.

  ⛔ What this rule deliberately does NOT do:

  - It does not ban the idea of a date. `infoRequestCampaignerEmail` is WIRED
    and renders an admin's OWN TYPED date as "Send it by" - a person asking,
    not an automated threat. Probed: it does not match.
  - Its anti-vacuity control does NOT assert that the two templates still
    contain the bad copy. That would make FIXING the copy fail the build -
    `docs/138`'s auto-relaxation lesson inverted. The control proves the
    MATCHER works, against synthetic samples.
  - It says nothing about `sendEmailOnly`. A rule over the send mechanism was
    designed and abandoned: 11 WIRED functions already use it (registration,
    password reset, refunds), because it is the right mechanism for
    transactional mail to a guest. The hazard is the copy.
*/

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

/*
  ⚠️ Comments are stripped FIRST. `email-templates.ts:849` is `docs/110`'s own
  note - "no deadline, no countdown, no turnaround time" - so a raw-text sweep
  reports the record of the fix as the defect (`docs/116`).
*/
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const NOTIFICATIONS = 'src/lib/notifications.ts';
const TEMPLATE_FILES = ['src/lib/email-templates.ts', 'src/lib/email-adaptive.ts'];

/**
 * Copy that states a countdown this platform does not run, or money it does
 * not return. Matched against STRING LITERALS only, so a `deadline: string`
 * parameter declaration is not a hit.
 */
const UNKEEPABLE: { pattern: RegExp; why: string }[] = [
  { pattern: /days left/i, why: 'a countdown no job enforces' },
  { pattern: /days remaining/i, why: 'a countdown no job enforces' },
  { pattern: /send the money back/i, why: 'nothing returns money on a clock' },
  { pattern: /return funds to donors/i, why: 'nothing returns money on a clock' },
  { pattern: /return the donations?/i, why: 'nothing returns money on a clock' },
  { pattern: /extend deadlines/i, why: 'there is no deadline to extend' },
];

/** Every string literal in a chunk of source, lower-cased and joined. */
function literals(src: string): string {
  return (src.match(/`[^`]*`|'[^']*'|"[^"]*"/g) ?? []).join(' ').toLowerCase();
}

function unkeepableIn(src: string): string[] {
  const text = literals(src);
  return UNKEEPABLE.filter(({ pattern }) => pattern.test(text)).map(
    ({ pattern, why }) => `${pattern.source} (${why})`,
  );
}

/** `notify*` name -> its body, comments stripped. */
function notifyBodies(): Map<string, string> {
  const parts = read(NOTIFICATIONS).split(/^export async function (notify\w+)/m);
  const out = new Map<string, string>();
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i], strip(parts[i + 1]));
  return out;
}

/** The `notify*` names that something outside the module actually calls. */
function wiredNotifiers(): Set<string> {
  const names = [...notifyBodies().keys()];
  const sources = [
    ...globSync('src/**/*.ts', { cwd: ROOT }),
    ...globSync('src/**/*.tsx', { cwd: ROOT }),
  ]
    .filter((f) => f !== NOTIFICATIONS && !f.includes('.test.'))
    .map((f) => strip(read(f)));

  return new Set(
    names.filter((n) => sources.some((s) => new RegExp(`\\b${n}\\s*\\(`).test(s))),
  );
}

/** Exported template function name -> its source slice. */
function templateBodies(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of TEMPLATE_FILES) {
    const lines = strip(read(file)).split('\n');
    const marks: [number, string][] = [];
    lines.forEach((l, i) => {
      const m = /^export function (\w+)/.exec(l);
      if (m) marks.push([i, m[1]]);
    });
    marks.forEach(([start, name], j) => {
      const end = j + 1 < marks.length ? marks[j + 1][0] : lines.length;
      out.set(name, lines.slice(start, end).join('\n'));
    });
  }
  return out;
}

describe('a wired notification does not promise a clock we do not run', () => {
  /*
    ── RULE 0, ANTI-VACUITY ──
    If the scans found nothing, every rule below passes over nothing.
  */
  it('⚠️ CONTROL: the scans find the notifiers and the templates', () => {
    expect(notifyBodies().size).toBeGreaterThan(30);
    expect(wiredNotifiers().size).toBeGreaterThan(20);
    expect(templateBodies().size).toBeGreaterThan(30);
  });

  /*
    ── RULE 1, ANTI-VACUITY ──
    Proves the MATCHER can fail - without pinning the product's current copy,
    so rewriting the two dead templates honestly never breaks the build.
  */
  it('⚠️ CONTROL: the matcher catches unkeepable copy and spares honest copy', () => {
    expect(unkeepableIn("const a = `You have 7 days left to verify`;")).not.toEqual([]);
    expect(unkeepableIn("const a2 = `3 days remaining to verify`;")).not.toEqual([]);
    expect(unkeepableIn("const a3 = `we may need to return funds to donors`;")).not.toEqual([]);
    expect(unkeepableIn("const a4 = `we will return the donations`;")).not.toEqual([]);
    expect(unkeepableIn("const b = `We will send the money back`;")).not.toEqual([]);
    expect(unkeepableIn("const c = `We can extend deadlines for you`;")).not.toEqual([]);

    // Honest copy, including an admin's own typed date, must NOT match.
    expect(unkeepableIn("const d = `Send it by ${esc(p.deadline)}`;")).toEqual([]);
    expect(unkeepableIn('interface P { deadline: string; }')).toEqual([]);
    expect(
      unkeepableIn("const e = `A person read your update. We published it.`;"),
    ).toEqual([]);
  });

  /*
    ── RULE 2, THE RULE ──
    Derived both ends: which notifiers are wired, and what their templates
    say. It auto-relaxes in BOTH directions - fix the copy, or leave the
    function dead, and it passes.
  */
  it('⛔ no WIRED notification renders a countdown or a money-back promise', () => {
    const wired = wiredNotifiers();
    const bodies = notifyBodies();
    const templates = templateBodies();
    const offences: string[] = [];

    for (const notifier of wired) {
      const body = bodies.get(notifier)!;
      for (const [tplName, tplSrc] of templates) {
        if (!new RegExp(`\\b${tplName}\\s*\\(`).test(body)) continue;
        const bad = unkeepableIn(tplSrc);
        if (bad.length) {
          offences.push(`${notifier} -> ${tplName}: ${bad.join(', ')}`);
        }
      }
    }

    expect(
      offences,
      'these are wired and promise something the platform cannot do ' +
        '(docs/110 §7: no mechanism returns money on a clock):\n' +
        offences.join('\n'),
    ).toEqual([]);
  });

  /*
    ── RULE 3 ──
    The same rule for copy written INLINE in `notifications.ts` itself, which
    no template scan would reach. `docs/139` removed the last two inline
    bodies; this keeps a new one from carrying the same promise.
  */
  it('⛔ no WIRED notification states it inline either', () => {
    const wired = wiredNotifiers();
    const bodies = notifyBodies();
    const offences: string[] = [];
    for (const notifier of wired) {
      const bad = unkeepableIn(bodies.get(notifier)!);
      if (bad.length) offences.push(`${notifier}: ${bad.join(', ')}`);
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });
});
