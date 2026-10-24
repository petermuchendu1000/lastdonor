/**
 * The submission receipt: what it must say, and what it must never say again.
 *
 * Two separate concerns are pinned here.
 *
 * ## 1. It stays short
 *
 * The earlier version delivered three facts in 95 visible words. The
 * subject, the preheader, the h1 and the opening sentence each announced
 * that the campaign was in review; the title appeared three times; and one
 * line existed only to describe the button directly beneath it. Nothing
 * was wrong with any single sentence, which is how copy like that
 * survives review - the repetition is only visible when the whole render
 * is read in order, so that is what these tests read.
 *
 * ## 2. It promises only what the product does
 *
 * It used to say "If anything needs changing first, we will tell you
 * exactly what." Nothing does that. `under_review` transitions only to
 * `active` or `suspended` (the admin campaign route's own table), the
 * suspend path reaches `notifyCampaignStatusChange`, and that returns
 * early for any status outside `['completed', 'archived']` - so a campaign
 * refused at review notifies nobody at all, organiser included.
 *
 * Approval is the single outcome the product actually writes about, so it
 * is the only one promised. If the rejection path is ever built, relax the
 * assertion deliberately rather than by deleting it. See `docs/93`.
 */
import { describe, it, expect } from 'vitest';
import { campaignSubmittedForReviewEmail } from './email-templates';

const TITLE = 'Help Amina Walk Again';
const email = campaignSubmittedForReviewEmail({
  campaignerName: 'Peter',
  campaignTitle: TITLE,
});

/**
 * The hidden inbox-preview line the shell emits before the visible card.
 */
function preheaderOf(html: string): string {
  const m = /<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">([\s\S]*?)<\/div>/.exec(
    html,
  );
  return m ? m[1].trim() : '';
}

/**
 * What a reader actually sees, in order.
 *
 * Outlook-only VML is dropped: `emailButton` emits the label twice, once
 * inside `<!--[if mso]>` and once outside, and exactly one of those renders
 * in any given client. Counting both would invent a duplicate that no
 * person ever sees - and a naive tag-strip does invent it.
 */
function visibleText(html: string): string {
  return html
    // Drop the Outlook-only branch...
    .replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, ' ')
    // ...but only UNWRAP the everyone-else branch, which is itself written
    // as comment markers (`<!--[if !mso]><!-- -->` … `<!--<![endif]-->`).
    // Deleting it wholesale drops the CTA label, which would let the one
    // button vanish without a single assertion here noticing.
    .replace(/<!--\[if !mso\]><!-- -->/g, ' ')
    .replace(/<!--<!\[endif\]-->/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<div style="display:none[\s\S]*?<\/div>/g, ' ') // preheader + spacer
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8203;|&#847;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const visible = visibleText(email.html);
const words = visible.split(' ').filter(Boolean);

describe('campaign submission receipt — brevity', () => {
  it('delivers the whole message in a short render', () => {
    /*
      Measured at 43 visible words including the LastDonor wordmark and the
      shell footer, against 95 before. The bound is a ratchet, not a
      target: adding a genuinely new fact is fine, restating an existing
      one is what this stops.
    */
    expect(words.length).toBeLessThanOrEqual(60);
  });

  it('names the campaign once, in the subject, and not again in the body', () => {
    expect(email.subject).toContain(TITLE);
    // The body refers back to the subject rather than reprinting the title.
    expect(visible).not.toContain(TITLE);
  });

  it('spends the preheader on new information rather than echoing the subject', () => {
    const pre = preheaderOf(email.html);
    expect(pre).not.toBe('');
    expect(pre).not.toContain(TITLE);
    // `derivePreheader` would have copied the opening body sentence here.
    expect(visible.startsWith(pre)).toBe(false);
  });

  it('still renders the call to action for non-Outlook clients', () => {
    // Guards the helper above as much as the template: see its comment.
    expect(visible).toContain('Check status');
  });

  it('offers exactly one action of its own', () => {
    /*
      `/settings` is the shell's own "Manage your notifications" footer
      link and belongs to every email, so it is not one of this template's
      choices. The body gets one call to action and no competing links:
      the "Questions? Reach us at support@" line was removed with the rest
      of the padding, which is why no `mailto:` survives either.
    */
    const hrefs = [...email.html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    const ownLinks = hrefs.filter((h) => !h.endsWith('/settings'));

    /*
      Asserted as a PATH, not as `https://lastdonor.org/dashboard`.

      The absolute form made this test depend on the ambient environment:
      `appBaseUrl()` reads `NEXTAUTH_URL`, so a developer (or a verification
      run) with `NEXTAUTH_URL=http://localhost:3000` in their shell saw this
      fail with a correct email. The property worth pinning is "exactly one
      call to action of its own, and it goes to the dashboard" - the host is
      the shell's business, not this template's.
    */
    expect(ownLinks).toHaveLength(1);
    expect(ownLinks[0]).toMatch(/\/dashboard$/);
    expect(hrefs.some((h) => h.startsWith('mailto:'))).toBe(false);
  });
});

describe('campaign submission receipt — only substantiated promises', () => {
  it('does not promise to say what needs changing', () => {
    expect(visible).not.toMatch(/needs changing|tell you exactly what|changes? requested/i);
  });

  it('does not promise to write on any decision, only on going live', () => {
    // "when it is decided" covered a refusal path that notifies nobody.
    expect(visible).not.toMatch(/when it is decided|as soon as it is decided/i);
    expect(visible).toMatch(/email you when it goes live/i);
  });

  it('quotes no turnaround time (docs/77, docs/78)', () => {
    expect(visible).not.toMatch(/\b\d+\s*(hours?|days?|business days?)\b/i);
    expect(visible).not.toMatch(/typically|usually within/i);
  });

  it('still states the gate that makes the review claim true', () => {
    expect(visible).toMatch(/not public/i);
    expect(visible).toMatch(/cannot take donations/i);
    expect(visible).toMatch(/approves it/i);
  });
});

describe('campaign submission receipt — escaping', () => {
  it('escapes the campaigner name', () => {
    const hostile = campaignSubmittedForReviewEmail({
      campaignerName: '<script>alert(1)</script>',
      campaignTitle: TITLE,
    });
    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).toContain('&lt;script&gt;');
  });
});
