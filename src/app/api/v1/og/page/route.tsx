import { ImageResponse } from '@vercel/og';
import { loadOgFonts } from '@/lib/og-fonts';
import { logCrawlerHit } from '@/lib/crawler-log';

export const runtime = 'nodejs';

/**
 * General-purpose branded OG image for static pages.
 *
 * Usage: /api/v1/og/page?title=About&subtitle=How+we+work
 *
 * Renders a branded card: deep teal background, amber accent stripe,
 * page title in DM Serif Display, optional subtitle in DM Sans,
 * and "lastdonor.org" branding.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Same purpose as the campaign card's: see `src/lib/crawler-log.ts`.
  logCrawlerHit({
    surface: 'og-page',
    subject: searchParams.get('title') ?? '(default)',
    userAgent: request.headers.get('user-agent'),
  });

  const title = searchParams.get('title') ?? 'LastDonor.org';
  const subtitle = searchParams.get('subtitle') ?? '';

  const fonts = await loadOgFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          backgroundColor: '#0F766E',
          padding: '60px 80px',
          position: 'relative',
        }}
      >
        {/* Amber accent stripe at top */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '8px',
            backgroundColor: '#D97706',
          }}
        />

        {/* Subtle pattern overlay for depth */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background:
              'radial-gradient(circle at 85% 20%, rgba(255,255,255,0.06) 0%, transparent 50%)',
          }}
        />

        {/* Title */}
        <div
          style={{
            fontSize: 72,
            fontFamily: 'DM Serif Display',
            color: '#FFFFFF',
            lineHeight: 1.15,
            maxWidth: '900px',
            display: 'flex',
          }}
        >
          {title}
        </div>

        {/* Subtitle */}
        {subtitle && (
          <div
            style={{
              fontSize: 28,
              fontFamily: 'DM Sans',
              color: 'rgba(255, 255, 255, 0.8)',
              marginTop: '24px',
              maxWidth: '800px',
              lineHeight: 1.5,
              display: 'flex',
            }}
          >
            {subtitle}
          </div>
        )}

        {/* Bottom bar: logo + amber line */}
        <div
          style={{
            position: 'absolute',
            bottom: '48px',
            left: '80px',
            right: '80px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontFamily: 'DM Sans',
              color: 'rgba(255, 255, 255, 0.6)',
              display: 'flex',
            }}
          >
            lastdonor.org
          </div>
          <div
            style={{
              fontSize: 18,
              fontFamily: 'DM Sans',
              color: '#D97706',
              display: 'flex',
            }}
          >
            0% Platform Fees
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts,
      headers: {
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable',
      },
    },
  );
}
