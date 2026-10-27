/**
 * Every place that sends mail renders through the one shell, or is listed here
 * with a reason.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * `EMAIL_SOURCE_FILES` in `email-readability.ts` is a **hand-written list of
 * two files**, and it is the input to both email sweeps: the plain-language
 * budget (`docs/94`) and the dark-mode contrast ratchet (`docs/94` §9). So a
 * template written inline in a route handler is measured by nothing, and the
 * two ratchets stay green while it says whatever it likes in whatever colour.
 *
 * That has now happened three times. `docs/74` found two - the password reset
 * and the donor receipt, both inline in route handlers. The third was the
 * newsletter welcome in `POST /api/v1/newsletter/subscribe`, a bare `text:`
 * body promising *"updates about campaigns making a real difference in
 * people's lives"* to four real subscribers who have received nothing
 * (`docs/123`).
 *
 * Extending the file list is not the fix: the list is the defect. This rule
 * DISCOVERS senders from disk instead, so a fourth inline template fails the
 * build rather than waiting to be noticed. The `docs/116` §4 lesson - a sweep
 * that names its own inputs only checks what somebody remembered.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { EMAIL_SOURCE_FILES } from './email-readability';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length));
}

/**
 * A call that hands a body to the mail provider.
 *
 * Matched on `resend.emails.send` / `resend.batch.send` rather than on the
 * word "email", because that is the one place a body becomes a message. A
 * notification helper that only assembles copy is not a sender.
 */
const SEND_CALL = /resend\.(?:emails|batch)\.send\(/;

/**
 * Senders allowed to build their own body, each with the reason.
 *
 * ⛔ Adding a path here is a decision, not housekeeping: it exempts that
 * body from the plain-language budget AND from the dark-mode contrast sweep.
 * Prefer moving the copy into `src/lib/email-templates.ts`, which costs
 * nothing and puts it inside both.
 */
const HAND_WRITTEN_BODIES: Record<string, string> = {
  'src/app/api/v1/admin/bulk-emails/[id]/send/route.ts':
    'The body is composed by an administrator in the admin UI and interpolated per ' +
    'recipient - there is no template to measure. It appends its own CAN-SPAM footer ' +
    'with the postal address and records `postalAddressPresent` on the audit row.',
  'src/app/api/v1/cron/send-newsletter/route.ts':
    'The body is AI-generated per run inside its own HTML document, so no fixed copy ' +
    'exists to score. It is the one sender that REFUSES to send when ' +
    'MAILING_POSTAL_ADDRESS is unset rather than omitting the line.',
  'src/app/api/v1/users/me/route.ts':
    'One sentence confirming an account deletion, sent as plain text to an address ' +
    'whose account no longer exists. Purely transactional, carries no link, and the ' +
    'HTML shell would add a footer pointing at settings for a deleted account.',
};

const SENDERS = walk(SRC)
  .map((abs) => ({ path: relative(ROOT, abs).split('\\').join('/'), src: stripComments(readFileSync(abs, 'utf-8')) }))
  .filter((f) => SEND_CALL.test(f.src));

describe('the sweep found the senders', () => {
  it('⚠️ discovers them from disk, and finds more than one', () => {
    /*
      Gate: an empty or single-element discovery would pass every rule below.
      Seven senders existed when this was written.
    */
    expect(SENDERS.length).toBeGreaterThan(4);
    expect(SENDERS.map((s) => s.path)).toContain('src/lib/notifications.ts');
  });

  it('⛔ and the hand-written allowlist names only files that exist and still send', () => {
    // A stale entry is an exemption nobody is checking.
    const found = new Set(SENDERS.map((s) => s.path));
    const stale = Object.keys(HAND_WRITTEN_BODIES).filter((p) => !found.has(p));
    expect(stale, 'allowlisted paths that no longer send mail').toEqual([]);
  });
});

describe('⛔ every mail sender renders through the shell', () => {
  it('or is allowlisted with a reason', () => {
    /*
      "Through the shell" means the file reaches `renderEmail` - directly, or
      via `email-templates` / `email-adaptive`, the two files both sweeps
      measure. Anything else is a body nothing is looking at.
    */
    const offenders = SENDERS.filter(({ path, src }) => {
      if (path in HAND_WRITTEN_BODIES) return false;
      return !/renderEmail|email-templates|email-adaptive|email-shell/.test(src);
    }).map((s) => s.path);

    expect(offenders, 'mail bodies outside both email sweeps').toEqual([]);
  });

  it('⚠️ and the two swept files are the ones the sweeps are pointed at', () => {
    /*
      The rule above is only worth anything while `EMAIL_SOURCE_FILES` really
      is what `measureAll` reads. If that list grows a third entry, the
      allowlist reasons above ("there is no template to measure") may have
      stopped being true, so this fails deliberately and asks.
    */
    expect([...EMAIL_SOURCE_FILES]).toEqual([
      'src/lib/email-templates.ts',
      'src/lib/email-adaptive.ts',
    ]);
  });
});

describe('⛔ the newsletter welcome specifically, since that is the one that escaped', () => {
  it('the subscribe route no longer writes its own body', () => {
    const route = SENDERS.find((s) => s.path === 'src/app/api/v1/newsletter/subscribe/route.ts');
    expect(route, 'the subscribe route no longer sends mail').toBeTruthy();
    expect(route!.src).toMatch(/newsletterWelcomeEmail\(/);
    // A `text:` body is the shape that escaped; `html:` comes from the shell.
    expect(route!.src).not.toMatch(/\n\s*text:\s*`/);
  });

  it('⛔ and it does not promise content the platform has never sent', () => {
    /*
      [VERIFIED 2026-10-27 against production] `blog_posts` has 0 rows and
      `cron.send_newsletter` has written two rows, both `sent: 0`. The old
      copy told four real subscribers they would "receive updates about
      campaigns making a real difference in people's lives".
    */
    const templates = readFileSync(join(ROOT, 'src/lib/email-templates.ts'), 'utf-8');
    const at = templates.indexOf('export function newsletterWelcomeEmail');
    expect(at, 'newsletterWelcomeEmail is gone').toBeGreaterThan(-1);
    const body = templates.slice(at, templates.indexOf('\n}\n', at));
    expect(body).not.toMatch(/making a real difference/i);
    expect(body).not.toMatch(/every dollar has a name/i);
    // And it still says how to leave, which is this message's actual job.
    expect(body).toMatch(/Unsubscribe/);
  });
});
