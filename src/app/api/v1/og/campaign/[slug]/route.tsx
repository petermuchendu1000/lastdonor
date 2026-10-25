import { ImageResponse } from '@vercel/og';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { getCampaignPhase } from '@/lib/utils/phase';
import { CATEGORY_LABELS } from '@/lib/categories';
import { appBaseUrl } from '@/lib/unsubscribe-tokens';
import { loadOgFonts } from '@/lib/og-fonts';
import { ogCardModel, probeHeroSrc } from '@/lib/og-card-model';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * The 1200x630 card every shared LastDonor link carries.
 *
 * This is not decoration. On WhatsApp and Facebook the image is the largest
 * element in the card and is read before any text; on X's
 * `summary_large_image` it is very nearly the ONLY thing shown. For most
 * people who ever see a campaign second-hand, this picture is the campaign.
 *
 * ── What was wrong with the version this replaces ────────────────────────
 *
 * All of the following were observed against production on 2026-10-25,
 * not reasoned about:
 *
 *  1. **It 502'd for 2 of 14 live campaigns.** A campaign whose
 *     `heroImageUrl` is a relative path (`/images/categories/...svg`) made
 *     `ImageResponse` throw, so `harold-jennings` and `david-l-jones` had no
 *     share image at all and every platform fell back to a text-only card.
 *     Satori needs an absolute URL, and it does not render SVG as an `<img>`.
 *     Both are now handled, and a hero that cannot be used degrades to a
 *     designed panel rather than a 502.
 *  2. **"$0.00 raised · 0 donors"** was printed on every card. Every live
 *     campaign has raised nothing (`docs/72`), so the single most
 *     discouraging fact about a campaign was the headline of every share.
 *     The product's own zero state is "Be the first to donate" (`docs/71`),
 *     and that is what this shows.
 *  3. **It hardcoded USD.** `centsToDollars` formats as dollars whatever the
 *     row's currency is, while every amount column is in the MINOR UNITS OF
 *     ITS OWN ROW'S CURRENCY (`docs/92`). Latent only because the one KES
 *     campaign is `archived` and so unservable - it would have become
 *     shillings behind a dollar sign in every preview the day a KES campaign
 *     went live. Now `formatMoney(minor, currency)`.
 *  4. **Cents on whole-dollar goals** - "$0.00 of $35,000.00".
 *  5. **It repeated the page title and added nothing.** Category, location
 *     and the review guarantee - the things that make a stranger trust an
 *     appeal - were all absent.
 *
 * ── Why the photo is on the left ─────────────────────────────────────────
 *
 * X draws its own copy of `og:title` in a black badge over the BOTTOM LEFT
 * of the image. The old card put its title there too, so on X the title was
 * printed on top of itself. Moving the text to the right half means X's
 * badge lands on the photo, where it belongs.
 */
export async function GET(_request: Request, { params }: Params) {
  const { slug } = await params;

  const [campaign] = await db
    .select({
      title: campaigns.title,
      heroImageUrl: campaigns.heroImageUrl,
      raisedAmount: campaigns.raisedAmount,
      goalAmount: campaigns.goalAmount,
      currency: campaigns.currency,
      category: campaigns.category,
      location: campaigns.location,
      donorCount: campaigns.donorCount,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.slug, slug),
        or(
          eq(campaigns.status, 'active'),
          eq(campaigns.status, 'last_donor_zone'),
          eq(campaigns.status, 'completed'),
        ),
      ),
    )
    .limit(1);

  if (!campaign) {
    return new Response('Campaign not found', { status: 404 });
  }

  const model = ogCardModel({
    raisedMinor: campaign.raisedAmount,
    goalMinor: campaign.goalAmount,
    currency: campaign.currency,
    donorCount: campaign.donorCount,
    heroImageUrl: campaign.heroImageUrl,
    baseUrl: appBaseUrl(),
    phase: getCampaignPhase(campaign.raisedAmount, campaign.goalAmount),
  });

  /*
    The shape check above cannot tell a JPEG from a WebP when the URL has no
    extension, and an undecodable image makes `ImageResponse` throw mid-pipe
    - which is the 502. One HEAD request settles it, and the result is
    cached for a day with the card.
  */
  const heroSrc = model.heroSrc ? await probeHeroSrc(model.heroSrc) : null;

  const categoryLabel = CATEGORY_LABELS[campaign.category] ?? 'Fundraiser';
  const context = [categoryLabel, campaign.location].filter(Boolean).join('  ·  ');
  const fonts = await loadOgFonts();

  const INK = '#0F172A';
  const MUTED = '#64748B';
  const TEAL = '#0F766E';
  const TRACK = '#E2E8F0';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'row',
          backgroundColor: '#FFFFFF',
          fontFamily: 'DM Sans',
        }}
      >
        {/* ── Left: the photograph ─────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            width: '456px',
            height: '100%',
            position: 'relative',
            backgroundColor: '#0B3B38',
          }}
        >
          {heroSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroSrc}
              alt=""
              style={{ width: '456px', height: '630px', objectFit: 'cover' }}
            />
          ) : (
            /*
              No usable photograph. This is a designed state, not an empty
              box: the old route threw here and answered 502, which is how
              two live campaigns ended up with no share image at all.
            */
            <div
              style={{
                display: 'flex',
                width: '456px',
                height: '630px',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#0B3B38',
                color: '#5EEAD4',
                fontSize: 120,
                fontFamily: 'DM Serif Display',
              }}
            >
              L
            </div>
          )}
        </div>

        {/* ── Right: everything a stranger needs to decide ─────────────── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            /*
              Centred, not space-between. With two groups, space-between put
              every unused pixel into one gap in the middle, so a short title
              left a ~200px hole. Centring absorbs the slack evenly and a
              three-line title still fills the panel.
            */
            justifyContent: 'center',
            width: '744px',
            height: '100%',
            padding: '44px 48px',
          }}
        >
          {/* Brand, context, headline */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 30,
                fontFamily: 'DM Serif Display',
                color: TEAL,
              }}
            >
              LastDonor
            </div>

            <div
              style={{
                display: 'flex',
                marginTop: '18px',
                fontSize: 23,
                color: MUTED,
              }}
            >
              {context}
            </div>

            <div
              style={{
                display: '-webkit-box',
                marginTop: '12px',
                fontSize: 44,
                lineHeight: 1.18,
                fontFamily: 'DM Serif Display',
                color: INK,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {campaign.title}
            </div>
          </div>

          {/* Money, progress, and the guarantee */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: '36px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                fontSize: 42,
                color: INK,
              }}
            >
              {model.headline}
            </div>

            <div
              style={{
                display: 'flex',
                marginTop: '8px',
                fontSize: 24,
                color: MUTED,
              }}
            >
              {model.subline}
            </div>

            {/* Progress */}
            <div
              style={{
                display: 'flex',
                width: '100%',
                height: '14px',
                marginTop: '18px',
                borderRadius: '7px',
                backgroundColor: TRACK,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  width: `${model.barPercent}%`,
                  height: '14px',
                  borderRadius: '7px',
                  backgroundColor: model.barColor,
                }}
              />
            </div>

            {/*
              The platform's actual differentiator, and the one claim
              `docs/78`/`docs/79` make without qualification because BOTH
              insert paths are gated. Do not soften or embellish it.
            */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginTop: '28px',
                paddingTop: '20px',
                borderTop: `1px solid ${TRACK}`,
                fontSize: 22,
                color: MUTED,
              }}
            >
              {/*
                ⚠️ A rule, not a tick, and not by preference.

                A literal check character is not in DM Sans, and Satori
                reaches for the NETWORK for any glyph the supplied fonts
                lack - observed here as `Failed to load dynamic font for ✓
                ... Status: 400` (`docs/95`: Satori has no system fonts).
                Drawing one as inline SVG works, but
                `src/components/ui/icon/icon.test.tsx` ratchets the number of
                files that hand-roll SVG downward and this would have been
                the seventeenth (`docs/70`) - note that ratchet matches raw
                TEXT, so even naming the tag in a comment trips it. The icon components cannot be
                used either: they size by className and rely on
                `vectorEffect`, neither of which Satori honours.

                So the emphasis is a border, which needs no font and no
                artwork.
              */}

              <div
                style={{
                  display: 'flex',
                  borderLeft: `4px solid ${TEAL}`,
                  paddingLeft: '14px',
                }}
              >
                Reviewed by a person before it goes live  ·  lastdonor.org
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts,
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    },
  );
}
