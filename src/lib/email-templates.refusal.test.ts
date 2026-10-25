/**
 * The refusal email: what it must say, and what it must not promise.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY ─────────────────────────────────────────
 *
 * The plain-language and dark-mode ratchets already measure this template
 * along with the other 46. They cannot see two things that matter here:
 *
 *  1. ⛔ `reason` is TYPED BY AN ADMIN and goes straight into the document.
 *     It is the only free text in this product that an administrator writes
 *     and a member of the public receives. `docs/94` §4 is the same hazard in
 *     the preheader.
 *  2. The owner chose the version of this decision that ENDS THE SILENCE
 *     without committing to a revision loop the product does not have. That
 *     is a line in the copy, and nothing else in the suite is watching it.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { campaignRefusedEmail } from '@/lib/email-templates';

const render = (over: Partial<Parameters<typeof campaignRefusedEmail>[0]> = {}) =>
  campaignRefusedEmail({
    campaignerName: 'Asha',
    campaignTitle: 'Help Asha',
    reason: 'The hospital bill does not name the person in the story.',
    ...over,
  });

describe('it says what happened and why', () => {
  it('names the campaign and carries the reason', () => {
    const e = render();
    expect(e.html).toContain('Help Asha');
    expect(e.html).toContain('The hospital bill does not name the person in the story.');
  });

  it('says plainly that it is not published', () => {
    expect(render().html).toMatch(/not public|not publish/i);
  });

  it('gives the mailbox the rest of the product uses', () => {
    const e = render();
    expect(e.html).toContain('support@lastdonor.org');
    expect(e.html).not.toContain('verify@lastdonor.org');
  });
});

describe('⛔ promises it may not make', () => {
  const allText = () => `${render().subject} ${render().html}`;

  it('does not promise to look at it again', () => {
    /*
      The owner chose "email them, with a typed reason" over the revision
      loop. Saying "resubmit" or "we will review it again" would commit the
      product to a path it does not have - and `docs/76`, `docs/77` and
      `docs/81` are all docs about shipping a promise with no code behind it.
    */
    expect(allText()).not.toMatch(/\bresubmit\b|submit it again|try again|review it again|look at it again/i);
    expect(allText()).not.toMatch(/\bappeal\b/i);
  });

  it('quotes no turnaround time', () => {
    // docs/78 quotes none anywhere, deliberately.
    expect(allText()).not.toMatch(/\b\d+\s*(hours?|days?|weeks?)\b/i);
    expect(allText()).not.toMatch(/within \w+ (hours?|days?)/i);
  });

  it('says nothing about money being sent back', () => {
    /*
      A campaign refused at review was never public, so it has no donations
      at all - but the sentence is absent rather than reassuring, because
      `docs/110` §7 is about exactly this: there is NO mechanism that sends
      money back on a clock, and copy about returning money is the thing this
      codebase has repeatedly got wrong.
    */
    expect(allText()).not.toMatch(/send (the |your )?money back|send it back|refund/i);
  });
});

describe('⛔ the admin-typed reason is escaped', () => {
  it('does not let a reason inject markup', () => {
    const e = render({
      reason: '<img src=x onerror=alert(1)> and <script>alert(2)</script>',
    });
    expect(e.html).not.toContain('<img src=x');
    expect(e.html).not.toContain('<script>alert(2)');
    // It is still legible as text, not silently dropped.
    expect(e.html).toContain('&lt;img');
  });

  it('escapes the campaign title and the name too', () => {
    const e = render({
      campaignTitle: '"><script>alert(3)</script>',
      campaignerName: '<b>Asha</b>',
    });
    expect(e.html).not.toContain('<script>alert(3)');
    expect(e.html).not.toContain('<b>Asha</b>');
  });

  it('⚠️ the escaping assertion is not vacuous', () => {
    // If `esc` ever became a no-op, the test above would still pass on a
    // template that dropped the field entirely. So prove the field is there.
    const e = render({ reason: 'plain words here' });
    expect(e.html).toContain('plain words here');
  });
});
