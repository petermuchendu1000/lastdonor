/**
 * The ten brand illustrations, and the message each one carries.
 *
 * ## Why this file exists at all
 *
 * `docs/169` established that nothing technical blocks indexing here: robots
 * allows, canonicals self-reference, 50/50 sitemap URLs answered 200 and
 * indexable. Four real pages sit in "Crawled - currently not indexed", which
 * is the profile of a new domain with thin inventory. (26 other URLs ARE
 * indexed - `docs/169` §2, corrected 2026-11-05.) Images are part of answering
 * that - a page with an illustration and a described subject has more for a
 * crawler to hold onto than a page of prose alone.
 *
 * ⚠️ But image indexing is DOWNSTREAM of page indexing, and this file must not
 * be read as a fix for `docs/169` §2.3. An image on an unindexed page is not
 * indexed either. This is groundwork.
 *
 * ## Every message is a claim, so every message is checked
 *
 * CLAUDE.md: *"Never add a claim the platform cannot substantiate."* These ten
 * were chosen by reading production, not by picking appealing sentences, and
 * the `evidence` field on each records what was read. Five candidates were
 * REJECTED for lack of evidence and are listed in `REJECTED_MESSAGES` below so
 * nobody proposes them again without checking the same counters.
 *
 * ## ⛔ No photorealistic people, and no words inside the image
 *
 * Two hard constraints, both earned:
 *
 * 1. `docs/36` is this project's record of forged press attribution about real
 *    named officials, and `docs/141` §5 raises the live question of stock
 *    photographs sitting atop public appeals that NAME REAL PEOPLE. A
 *    generated photorealistic person on a trust surface is the same class of
 *    problem. Every prompt therefore asks for flat geometric illustration and
 *    explicitly refuses faces and photorealism.
 *
 * 2. Diffusion models mangle lettering. A garbled word baked into a brand
 *    image on a page about money would be worse than no word at all, so the
 *    images are WORDLESS and the message is carried by `alt` and by the copy
 *    around them - which is what a crawler reads regardless.
 *
 * ⛔ These are platform illustrations for the platform's OWN explanatory
 * surfaces. None may be used as a campaign hero image: that is exactly the
 * `docs/141` §5 hazard, where an unlabelled picture sits above an appeal about
 * a named person and implies it depicts them.
 */

/** Brand palette, read from `globals.css` rather than chosen here. */
export const BRAND_PALETTE = {
  /** `--primary` */
  teal: '#0F766E',
  /** `--accent` */
  amber: '#D97706',
  /** `--surface-ink` */
  ink: '#0B2B28',
  /** `--background` */
  ground: '#FFFFFF',
} as const;

/**
 * The shared style clause, appended to every prompt.
 *
 * Kept as one constant so the ten images cannot drift into ten styles - the
 * `docs/146` rule (one definition, not several agreeing by accident) applied
 * to artwork. Colour is named in WORDS as well as hex, because a diffusion
 * model does not honour a hex code and does respond to "deep teal".
 */
export const STYLE_CLAUSE =
  'flat vector illustration, minimal geometric shapes, thick even outlines, ' +
  `limited palette of deep teal (${BRAND_PALETTE.teal}) and warm amber ` +
  `(${BRAND_PALETTE.amber}) on a plain white background, ` +
  'centred composition with generous empty margin, soft rounded corners, ' +
  'calm and reassuring, editorial infographic style. ' +
  'No text, no letters, no numbers, no words, no watermark, no signature. ' +
  'No photorealism, no photograph, no human faces, no portraits.';

/**
 * What a model must be told NOT to draw.
 *
 * Only `@cf/stabilityai/stable-diffusion-xl-base-1.0` accepts a
 * `negative_prompt`; `@cf/black-forest-labs/flux-1-schnell` takes only
 * `prompt` and `steps`. That difference is the reason the generator supports
 * both models and the choice is settled by LOOKING at a test render rather
 * than by preference.
 */
export const NEGATIVE_PROMPT =
  'text, letters, words, numbers, typography, captions, watermark, signature, ' +
  'photograph, photorealistic, realistic skin, human face, portrait, ' +
  'cluttered, busy background, gradient mesh, drop shadow, 3d render';

export type BrandImage = {
  /** Filename stem. DESCRIPTIVE on purpose - a filename is an image-search signal. */
  readonly slug: string;
  /** The one sentence this image exists to carry. */
  readonly message: string;
  /** `alt` text. This, not the pixels, is what a crawler reads. */
  readonly alt: string;
  /** The public, indexable page it belongs on. */
  readonly pages: readonly string[];
  /** What was read in production or in code to substantiate the message. */
  readonly evidence: string;
  /** The subject clause. `STYLE_CLAUSE` is appended by the generator. */
  readonly subject: string;
};

export const BRAND_IMAGES: readonly BrandImage[] = [
  {
    slug: 'zero-platform-fee',
    message: 'We take 0% - your whole gift reaches the campaign.',
    alt:
      'Illustration of a coin travelling along a straight arrow to a heart, ' +
      'with an empty dotted side branch where a platform fee would be taken, ' +
      'showing that LastDonor deducts nothing.',
    pages: ['/', '/transparency'],
    evidence:
      'Code-verified: no path deducts a processing fee. `create-checkout` ' +
      'sets `unit_amount: data.amount` with no `application_fee`, ' +
      '`payment-service.ts` credits `raisedAmount + amount`, and ' +
      '`withdraw/route.ts` computes `released - withdrawn - pending`. ' +
      'See docs/116 §5.',
    /*
      ⛔ NOT a donut or pie chart. docs/59 records that the fee band on the
      homepage deliberately replaced "a donut that claimed 100%", so a
      circular share-of-the-whole metaphor is a pattern this project has
      already rejected once. The readable idea is a flow that does not branch:
      the money goes straight through and the place a fee would be taken is
      visibly empty.
    */
    subject:
      'One coin travelling left to right along a single bold straight arrow ' +
      'that ends at a heart, with a short dotted branch dropping away from ' +
      'the middle of the arrow and ending in an empty dashed outline with ' +
      'nothing in it',
  },
  {
    slug: 'reviewed-by-a-person',
    message: 'A person reads every campaign before it goes live.',
    alt:
      'Illustration of a magnifying glass held over a document that carries a ' +
      'tick, showing that a person reviews each LastDonor campaign before it ' +
      'is published.',
    pages: ['/how-it-works'],
    evidence:
      '[VERIFIED in production 2026-11-03] 10 live published campaigns and 10 ' +
      'with a `campaign.published` audit row - the invariant docs/148 ' +
      'established, holding at 10/10.',
    subject:
      'A large magnifying glass angled over a single sheet of paper, a clear ' +
      'tick mark on the sheet beneath the lens',
  },
  {
    slug: 'give-without-an-account',
    message: 'You do not need an account to give.',
    alt:
      'Illustration of a heart moving freely through an open gateway with no ' +
      'barrier across it, showing that giving on LastDonor needs no account.',
    pages: ['/donate'],
    evidence:
      '[VERIFIED in production] 4 of the 6 real donations have `user_id IS ' +
      'NULL` - most of the real money this platform has taken arrived from ' +
      'people with no account. docs/122: the M-Pesa rail creates only guests.',
    subject:
      'Two tall upright gateway posts standing wide apart with nothing ' +
      'between them, and a simple heart shape passing straight through the ' +
      'gap on a horizontal arrow, no gate, no barrier, no lock',
  },
  {
    slug: 'invite-a-teammate',
    message: 'Invite someone to help run your campaign.',
    alt:
      'Illustration of two simple figures joined by a line to one shared ' +
      'banner, showing that a LastDonor organiser can invite a helper.',
    pages: ['/about'],
    evidence:
      'Feature built and reachable (docs/111, docs/117 fixed the journey); ' +
      '`campaign_collaborators` holds 2 rows. ⚠️ This states a CAPABILITY ' +
      'and deliberately claims no usage.',
    subject:
      'Two simple rounded abstract figures without faces, standing either ' +
      'side of one shared upright banner, a short line connecting them',
  },
  {
    slug: 'identity-checked-before-money-moves',
    message: "We check the organiser's ID before money moves.",
    alt:
      'Illustration of an identity card bearing a tick in front of a shield, ' +
      "showing that LastDonor checks an organiser's identity before funds move.",
    pages: ['/campaign-verification-policy'],
    evidence:
      'Code-verified: `withdraw/route.ts` refuses anything but ' +
      '`fully_verified`, and `createTransfer` has exactly one caller ' +
      '(docs/101, docs/121). Identity checks run through Didit (docs/81).',
    subject:
      'A rectangular identity card with a tick mark on it, overlapping a ' +
      'simple broad shield outline behind it',
  },
  {
    slug: 'refused-campaigns-stay-private',
    message: 'A campaign we refuse never gets a public page.',
    alt:
      'Illustration of a document held behind a solid barrier with an empty ' +
      'browser window beyond it, showing that a refused LastDonor campaign ' +
      'never reaches a public page.',
    pages: ['/how-it-works'],
    evidence:
      'Code-verified: `/campaigns/[slug]` requires ' +
      '`isNotNull(campaigns.publishedAt)`, so a refused campaign has no ' +
      'public page at all (docs/131). [VERIFIED live] the queue rows answer ' +
      '404 while approved ones answer 200.',
    subject:
      'A single sheet of paper on the left stopped against a thick solid ' +
      'vertical barrier running down the middle, and on the right of the ' +
      'barrier an empty browser window frame containing nothing at all',
  },
  {
    slug: 'funds-released-after-verification',
    message: 'Money is released only after verification.',
    alt:
      'Illustration of a padlock opening to let coins travel along a channel, ' +
      'showing that LastDonor releases funds only after verification.',
    pages: ['/fund-release-policy'],
    evidence:
      'Code-verified: `approve_t2` sets `total_released_amount`, the column ' +
      'the payout route pays against, and the statement is executed against ' +
      'real Postgres by 10 integration tests (docs/130).',
    subject:
      'An opening padlock at the mouth of a simple channel, three round ' +
      'coins travelling along the channel away from it',
  },
  {
    slug: 'ask-for-a-refund',
    message: 'You can ask for a refund.',
    alt:
      'Illustration of a coin travelling back along a circular return arrow ' +
      'towards a mobile phone, showing that a LastDonor donor can ask for a ' +
      'refund.',
    pages: ['/refund-policy'],
    evidence:
      'A published refund policy and an implemented admin refund path exist ' +
      '(docs/122, docs/152). ⚠️ No turnaround is claimed, per docs/78 and ' +
      'docs/152 - the M-Pesa return is settled by hand.',
    /*
      ⚠️ The first composition put an open upturned hand under the coin. In
      the sketch that arc read unmistakably as a FROWNING MOUTH beneath a
      round face - found by looking at the render, not by reading the prompt.
      A phone is both unambiguous and truer: every real refund here would go
      back down the M-Pesa rail it arrived on (docs/152).
    */
    subject:
      'A bold circular arrow curving anticlockwise back on itself, carrying ' +
      'one round coin along it, the arrow head pointing down towards a small ' +
      'upright mobile phone below',
  },
  {
    slug: 'campaigns-grouped-by-need',
    message: 'Appeals are grouped by the need they meet.',
    alt:
      'Illustration of a tidy grid of rounded tiles each holding a different ' +
      'simple symbol, showing how LastDonor groups appeals by category.',
    pages: ['/campaigns'],
    evidence:
      '[VERIFIED live 2026-11-03] 7 categories hold live campaigns and their ' +
      'card counts sum to the 10 live campaigns; the sitemap advertises ' +
      'exactly those 7 (docs/169 §5, §8.5).',
    subject:
      'A neat three by two grid of rounded square tiles, each tile holding ' +
      'one different simple symbol such as a cross, a roof, a book and a leaf',
  },
  {
    slug: 'start-a-campaign-in-steps',
    message: 'Start a campaign in a few steps.',
    alt:
      'Illustration of three ascending rounded steps with a small flag at the ' +
      'top, showing that starting a LastDonor campaign takes a few steps.',
    pages: ['/share-your-story'],
    evidence:
      'The create wizard exists and is walked end to end in docs/75-77 and ' +
      'docs/153. Submissions land in the review queue (docs/109).',
    subject:
      'Three ascending rounded rectangular steps of increasing height with a ' +
      'small triangular flag planted on the highest one',
  },
] as const;

/**
 * Messages considered and REJECTED, with the counter that rejected them.
 *
 * Recorded so the next person does not propose them without reading the same
 * numbers. Each would be a claim about something that has not happened, which
 * is the one thing CLAUDE.md forbids outright.
 */
export const REJECTED_MESSAGES: readonly { readonly message: string; readonly why: string }[] = [
  {
    message: 'Donors receive updates on how their money was spent.',
    why: '`impact_updates` holds 0 rows. docs/142 §3 already deleted this exact claim from `llms.txt` for the same reason.',
  },
  {
    message: 'Give to verified organisers.',
    why: '0 campaigns are `fully_verified`. docs/110 also forbids calling `identity_verified` "verified" - the two tiers unblock different things.',
  },
  {
    message: 'Organisers get paid quickly.',
    why: '`campaign_withdrawals` holds 0 rows - money has never left this platform (docs/113, docs/121). Also quotes a turnaround, which docs/78 forbids.',
  },
  {
    message: 'A hospital or church can confirm a crisis.',
    why: 'The trust network is built and exercised only in a lab (docs/136 §8); production holds no vouches. The capability is real but an image on a public page would imply it is in use.',
  },
  {
    message: 'Read our guides on fundraising.',
    why: '0 published blog posts ever (docs/123). The pipeline is owner-gated and has never produced one.',
  },
];
