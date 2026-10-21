/**
 * The one email shell. Every template in `email-templates.ts` and
 * `email-adaptive.ts` renders through it.
 *
 * ## What it replaces
 *
 * Both files carried an identical copy of this:
 *
 *   `<div style="font-family: 'DM Sans', Arial; max-width:600px; ...">`
 *
 * A bare `div`. No doctype, no `<head>`, so no charset, no viewport and no
 * dark-mode declaration. No tables, which is the part that actually breaks:
 * Outlook on Windows renders through Word, and Word does not lay out `div`
 * widths reliably. No preheader, so the inbox preview line was whatever text
 * happened to come first. And the call to action was padding on an inline
 * `<a>`, which Word ignores outright, so in Outlook the primary action
 * rendered as plain blue text.
 *
 * ## What email can and cannot do, stated plainly
 *
 * Verified behaviour of the major clients, and the reason this file looks
 * the way it does:
 *
 * - **Tables, not flex or grid.** Word has neither.
 * - **No SVG.** Gmail strips it entirely, so an inline-SVG illustration
 *   renders as nothing at all for the largest share of readers.
 * - **No web fonts.** Gmail drops `@font-face`. DM Serif Display and DM Sans
 *   cannot load, so the stacks below name the closest system faces: a
 *   transitional serif for headings, a humanist sans for body. The brand is
 *   carried by colour, spacing and tone instead, which survive everywhere.
 * - **Images are off by default** in Outlook and for many Gmail readers, so
 *   nothing load-bearing may live in an image. Depth here is built from
 *   table cells, borders and background colours, which always render.
 * - **CSS animation is progressive enhancement only.** Apple Mail, iOS Mail
 *   and Samsung Mail honour keyframes; Gmail and Outlook strip them. Every
 *   animated element here is fully legible in its final state, so a client
 *   that ignores the animation loses nothing.
 *
 * That is the honest ceiling. An email cannot carry a 3D render or a motion
 * piece the way a web page can, and pretending otherwise produces mail that
 * looks broken in Outlook and blank in Gmail with images off.
 *
 * See `docs/67`.
 */

const BASE_URL = process.env.NEXTAUTH_URL || 'https://lastdonor.org';

/** Brand tokens, mirroring `globals.css`. Hex only: email has no custom properties. */
export const EMAIL_COLORS = {
  ink: '#0B2B28',
  primary: '#0F766E',
  accent: '#D97706',
  foreground: '#1A1A1A',
  muted: '#5B6B68',
  hairline: '#E4E9E8',
  surface: '#FFFFFF',
  canvas: '#F6F3EC',
  positive: '#10B981',
} as const;

/**
 * Closest system equivalents to DM Serif Display and DM Sans.
 * Gmail strips `@font-face`, so naming the real faces alone would silently
 * fall back to Times.
 */
const SERIF_STACK =
  "Georgia, 'Times New Roman', Times, serif";
const SANS_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A call to action Outlook actually renders.
 *
 * The button is a table with the background on the `td` and the padding on
 * the anchor, wrapped in a VML rounded rectangle that only Word parses. Word
 * ignores `border-radius` and ignores padding on an inline anchor, so
 * without the VML the button is a bare link, and without the table the
 * background does not paint.
 */
export function emailButton(
  href: string,
  label: string,
  variant: 'primary' | 'accent' | `#${string}` = 'accent',
): string {
  const bg =
    variant.startsWith('#') ? variant
    : variant === 'accent' ? EMAIL_COLORS.accent
    : EMAIL_COLORS.primary;
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
  <tr><td align="left">
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
      href="${href}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="50%" stroke="f" fillcolor="${bg}">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:${SANS_STACK};font-size:16px;font-weight:bold;">${label}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" bgcolor="${bg}" class="ld-btn" style="border-radius:999px;background-color:${bg};">
        <a href="${href}" style="display:inline-block;padding:14px 32px;font-family:${SANS_STACK};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a>
      </td></tr>
    </table>
    <!--<![endif]-->
  </td></tr>
</table>`.trim();
}

/**
 * A figure worth pausing on: the amount, the count, the total.
 *
 * Rendered as its own bordered row rather than bolded inside a sentence,
 * because the number is usually the reason the person opened the mail.
 */
export function emailStat(label: string, value: string, note?: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border:1px solid ${EMAIL_COLORS.hairline};border-radius:14px;background-color:${EMAIL_COLORS.canvas};">
  <tr><td style="padding:20px 24px;">
    <p style="margin:0;font-family:${SANS_STACK};font-size:13px;font-weight:600;color:${EMAIL_COLORS.muted};letter-spacing:0.02em;">${label}</p>
    <p style="margin:6px 0 0;font-family:${SANS_STACK};font-size:32px;line-height:1.1;font-weight:700;color:${EMAIL_COLORS.ink};">${value}</p>
    ${note ? `<p style="margin:8px 0 0;font-family:${SANS_STACK};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.muted};">${note}</p>` : ''}
  </td></tr>
</table>`.trim();
}

/**
 * Build the inbox preview line from the body when a template has not written
 * one.
 *
 * A leading greeting is dropped first: "Hi Ada," is the most common opening
 * in these templates and the least useful thing to show beside the subject,
 * because the reader already knows their own name. The sentence after it is
 * almost always the actual news.
 */
export function derivePreheader(bodyHtml: string, limit = 110): string {
  const text = bodyHtml
    // Headings go first. The preview line sits beside the subject in the
    // inbox, so repeating the headline there spends the one spare line
    // saying something the reader can already see.
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, ' ')
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hi|hello|hey|dear)\b[^.!?]{0,40}?[,.]\s*/i, '');

  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

export interface EmailShellOptions {
  /**
   * The inbox preview line, shown next to the subject before the mail is
   * opened. Absent before this shell existed, so the preview was whatever
   * body text came first, usually "Hi Ada,". It is the single highest
   * leverage line in the message after the subject.
   */
  preheader?: string;
  /** Body HTML. Paragraphs should use `emailParagraph` for consistent type. */
  body: string;
  /** Adds the unsubscribe and postal-address block required of commercial mail. */
  commercial?: boolean;
  /** Overrides the default "manage notifications" footer link. */
  footerLinks?: string;
}

export function emailParagraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${SANS_STACK};font-size:16px;line-height:1.65;color:${EMAIL_COLORS.foreground};">${html}</p>`;
}

export function emailHeading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-family:${SERIF_STACK};font-size:28px;line-height:1.2;font-weight:700;color:${EMAIL_COLORS.ink};">${text}</h1>`;
}

/**
 * Wrap body HTML in the full document.
 *
 * `commercial` controls the CAN-SPAM block. Transactional mail (a receipt, a
 * password reset) is exempt from the postal-address requirement; anything
 * promotional is not. `mailingPostalAddress()` has no default on purpose
 * (docs/41 §5.1), so when it is unset the block is omitted rather than
 * filled with a placeholder, and the caller is responsible for refusing to
 * send promotional mail in that state.
 */
export function renderEmail(opts: EmailShellOptions): string {
  const { body, commercial = false, footerLinks } = opts;
  /*
    An EXPLICIT preheader is escaped here; a derived one is not.

    The difference is where the text came from. `derivePreheader` reads the
    body, which every template has already escaped, and then decodes a few
    entities for readability - escaping that again would print `&amp;amp;`
    in the inbox preview.

    An explicit preheader is a fresh string built by the caller, and the
    natural way to build one is `We got your gift to ${p.campaignTitle}`.
    That interpolates raw, attacker-controlled text straight into the
    markup below. Caught by the receipt's escaping test the moment explicit
    preheaders were introduced: a campaign titled with an `<img onerror>`
    tag reached the document as a real tag. Escaping here fixes the whole
    class rather than asking 20 call sites to remember `esc()`.
  */
  const preheader =
    opts.preheader !== undefined ? escapeHtml(opts.preheader) : derivePreheader(body);

  const postal = process.env.MAILING_POSTAL_ADDRESS?.trim() || null;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>LastDonor</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  /* Progressive enhancement only. Apple Mail, iOS Mail and Samsung Mail
     honour these; Gmail and Outlook strip the block entirely. Every element
     is legible in its final state, so stripping it costs nothing. */
  @media screen {
    .ld-rise { animation: ldRise 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }
    .ld-rise-2 { animation-delay: 90ms; }
    .ld-rise-3 { animation-delay: 180ms; }
    @keyframes ldRise {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ld-rise { animation: none !important; }
  }
  @media only screen and (max-width: 600px) {
    .ld-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .ld-h1 { font-size: 24px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .ld-canvas { background-color: #0F1A19 !important; }
    .ld-card { background-color: #16211F !important; border-color: #24302D !important; }
    .ld-text { color: #E8EDEC !important; }
    .ld-muted { color: #9FB0AC !important; }
    .ld-heading { color: #F1F5F9 !important; }

    /*
      Re-colour text that carries its own INLINE colour.

      The five rules above set colour on the container, and inheritance
      stops the moment a child declares its own. Every template does:
      \`<h1 style="color: #0F766E">\`, \`<p style="color: #666">\`,
      \`<ol style="color: #333">\`. In dark mode those stayed put on a near
      black card, which measured 1.31:1 against a 4.5:1 requirement - the
      numbered "how to get your money" steps were effectively invisible,
      as were every receipt row label and both tax-note paragraphs.
      Light mode was and is clean; the whole fault was dark only.

      An author rule marked !important beats a normal inline declaration,
      so matching on the inline style is what reaches them.

      Each colour needs TWO selectors because the declaration can start the
      attribute or follow a semicolon, and both spacings occur. Matching a
      bare "color: #EA580C" substring would also hit
      "background-color: #EA580C"; anchoring at ^ or "; " cannot, which is
      why the lazier single selector is not used here.

      \`scripts/email-contrast.ts\` measures this in a real browser and
      \`src/lib/email-dark-mode.ratchet.test.ts\` fails the build if any of
      it regresses. Add a rule here when you introduce a new inline colour.
    */
    [style^="color: #333"], [style*="; color: #333"],
    [style^="color:#333"], [style*=";color:#333"],
    [style^="color: #444"], [style*="; color: #444"],
    [style^="color:#444"], [style*=";color:#444"] { color: #E8EDEC !important; }

    [style^="color: #666"], [style*="; color: #666"],
    [style^="color:#666"], [style*=";color:#666"],
    [style^="color: #999"], [style*="; color: #999"],
    [style^="color:#999"], [style*=";color:#999"],
    [style^="color: #5B6B68"], [style*="; color: #5B6B68"],
    [style^="color:#5B6B68"], [style*=";color:#5B6B68"] { color: #AFBDBA !important; }

    [style^="color: #0F766E"], [style*="; color: #0F766E"],
    [style^="color:#0F766E"], [style*=";color:#0F766E"] { color: #6FD3C5 !important; }

    [style^="color: #EA580C"], [style*="; color: #EA580C"],
    [style^="color:#EA580C"], [style*=";color:#EA580C"] { color: #FFB27A !important; }

    [style^="color: #DC2626"], [style*="; color: #DC2626"],
    [style^="color:#DC2626"], [style*=";color:#DC2626"],
    [style^="color: #c00"], [style*="; color: #c00"],
    [style^="color:#c00"], [style*=";color:#c00"] { color: #FFA3A3 !important; }

    /*
      Callout panels carry a pale tint as an inline background, and a
      background does not inherit, so the rules above lightened the text
      inside them and left the panel white. That read 1.13:1 - worse than
      the fault being fixed. Caught only because the contrast was measured
      again AFTER the fix rather than assumed; the first pass turned 45
      failures into 4 and quietly created those 4.

      Each tint is darkened to a panel that keeps its meaning (green for
      good news, amber for caution, red for a problem, grey for neutral).
    */
    [style*="background: #f0fdf4"] { background-color: #12302A !important; }
    [style*="background: #fff7ed"] { background-color: #33240F !important; }
    [style*="background: #fef2f2"] { background-color: #3A1B1B !important; }
    [style*="background: #f9fafb"] { background-color: #1B2624 !important; }
    [style*="background: #e5e7eb"] { background-color: #2A3634 !important; }

    /*
      The call to action recedes into a dark card at the brand teal, which
      is a presence problem rather than a contrast one - white on #0F766E
      already passes AA. Lifting the fill keeps it the loudest thing in the
      message, which is the whole job of the one button.
    */
    .ld-btn { background-color: #14A197 !important; }
    .ld-btn a { color: #06201E !important; }
  }
</style>
</head>
<body class="ld-canvas" style="margin:0;padding:0;background-color:${EMAIL_COLORS.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}</div>
<div style="display:none;max-height:0;overflow:hidden;">&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ld-canvas" style="background-color:${EMAIL_COLORS.canvas};">
<tr><td align="center" style="padding:28px 12px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

    <tr><td style="padding:0 0 18px;">
      <span style="font-family:${SERIF_STACK};font-size:21px;font-weight:700;color:${EMAIL_COLORS.ink};" class="ld-heading">Last</span><span style="font-family:${SERIF_STACK};font-size:21px;font-weight:700;color:${EMAIL_COLORS.primary};">Donor</span><span style="color:${EMAIL_COLORS.accent};font-size:21px;font-weight:700;">.</span>
    </td></tr>

    <tr><td class="ld-card" style="background-color:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.hairline};border-radius:18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="height:4px;background-color:${EMAIL_COLORS.primary};border-radius:18px 18px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td class="ld-pad ld-rise ld-text" style="padding:32px 36px 36px;font-family:${SANS_STACK};font-size:16px;line-height:1.65;color:${EMAIL_COLORS.foreground};">
          ${body}
        </td></tr>
      </table>
    </td></tr>

    <tr><td class="ld-pad" style="padding:22px 8px 0;">
      <p class="ld-muted" style="margin:0 0 8px;font-family:${SANS_STACK};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted};">
        ${footerLinks ?? `<a href="${BASE_URL}/settings" style="color:${EMAIL_COLORS.muted};text-decoration:underline;">Manage your notifications</a>`}
      </p>
      <p class="ld-muted" style="margin:0;font-family:${SANS_STACK};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted};">
        LastDonor, reviewed crowdfunding with 0% platform fees.${commercial && postal ? `<br />${escapeHtml(postal)}` : ''}
      </p>
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}
