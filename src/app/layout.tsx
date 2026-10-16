import './globals.css';
import type { Metadata } from 'next';
import { DM_Serif_Display, DM_Sans, DM_Mono } from 'next/font/google';
import { seoKeywords } from '@/lib/seo/keywords';
import { SOCIAL_LINKS } from '@/lib/social-links';

const BASE_URL = 'https://lastdonor.org';

// Keep the entity graph factual and conservative. Donation/YMYL pages lose trust
// quickly when schema asserts authority that the visible site cannot prove.
const siteSchemaGraph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${BASE_URL}/#organization`,
      name: 'LastDonor',
      alternateName: ['LastDonor.org', 'Last Donor'],
      url: BASE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${BASE_URL}/apple-icon`,
        width: 180,
        height: 180,
      },
      description:
        'LastDonor is a reviewed crowdfunding platform that charges 0% platform fees on fundraisers, reviews campaigns before publication, and provides visible campaign progress and impact updates, serving medical, emergency, veteran, and family fundraising in the United States.',
      foundingDate: '2024-01-01',
      areaServed: { '@type': 'Country', name: 'United States' },
      knowsAbout: [
        ...seoKeywords('core', 'campaigns', 'trust', 'medical', 'emergency', 'disaster', 'memorial'),
      ],
      /*
        Fed from `SOCIAL_LINKS`, which is also what the footer renders, so a
        profile cannot be claimed in one place and absent from the other.

        This array used to hardcode a LinkedIn company page and an X handle.
        Both returned 404 on 2026-10-16 - verified against GoFundMe's
        equivalents on the same request shape, which return 200, so the
        404s mean the accounts do not exist rather than a bot wall. The
        comment at the top of this block asks for an entity graph that
        asserts nothing the visible site cannot prove; two imaginary
        profiles were the opposite of that.

        Omitted entirely while the list is empty: `sameAs: []` is a claim
        about nothing, and absent is the honest encoding of "none yet".
      */
      ...(SOCIAL_LINKS.length > 0
        ? { sameAs: SOCIAL_LINKS.map((link) => link.href) }
        : {}),
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'Customer Support',
        availableLanguage: 'en',
        url: `${BASE_URL}`,
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${BASE_URL}/#website`,
      name: 'LastDonor - Reviewed Crowdfunding Platform',
      url: BASE_URL,
      publisher: { '@id': `${BASE_URL}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${BASE_URL}/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
      mainEntity: { '@id': `${BASE_URL}/#organization` },
    },
    {
      '@type': 'SiteNavigationElement',
      '@id': `${BASE_URL}/#nav-campaigns`,
      name: 'Find a Reviewed Campaign',
      description: 'Browse reviewed crowdfunding campaigns raising money now',
      url: `${BASE_URL}/campaigns`,
      position: 1,
    },
    {
      '@type': 'SiteNavigationElement',
      '@id': `${BASE_URL}/#nav-start`,
      name: 'Start a Campaign',
      description: 'Submit your story for editorial review and launch a reviewed fundraiser',
      url: `${BASE_URL}/share-your-story`,
      position: 2,
    },
    {
      '@type': 'SiteNavigationElement',
      '@id': `${BASE_URL}/#nav-how-it-works`,
      name: 'How It Works',
      description: 'Step-by-step guide to how LastDonor verifies campaigns and tracks donations',
      url: `${BASE_URL}/how-it-works`,
      position: 3,
    },
    {
      '@type': 'SiteNavigationElement',
      '@id': `${BASE_URL}/#nav-about`,
      name: 'About LastDonor',
      description: 'Crowdfunding with 0% platform fees on fundraisers and reviewed campaigns',
      url: `${BASE_URL}/about`,
      position: 4,
    },
    {
      '@type': 'SiteNavigationElement',
      '@id': `${BASE_URL}/#nav-transparency`,
      name: 'Transparency Reports',
      description: 'Live platform stats, donation records, tax status updates, and annual reports',
      url: `${BASE_URL}/transparency`,
      position: 5,
    },
    {
      '@type': 'SiteNavigationElement',
      '@id': `${BASE_URL}/#nav-donate`,
      name: 'Make a Donation',
      description: 'Make a one-time or recurring donation to a reviewed campaign',
      url: `${BASE_URL}/donate`,
      position: 6,
    },
  ],
};
import { Toaster } from 'sonner';
import { cn } from '@/lib/utils';
import { Providers } from '@/components/Providers';
import { SkipToContent } from '@/components/layout/SkipToContent';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { SUPABASE_HOST } from '@/lib/supabase-host';

// The CSS variable names below are the ones `globals.css` reads in its
// `@theme` block (--font-dm-serif-display / --font-dm-sans / --font-dm-mono).
// They previously read --font-display / --font-body / --font-mono, so every
// font utility resolved `var(--font-dm-*)` against an undefined property; an
// unresolvable var() makes the whole `font-family` declaration invalid at
// computed-value time, and because font-family is inherited the document fell
// back to the UA default serif for body, headings AND mono. See docs/29 §6.2.
const dmSerifDisplay = DM_Serif_Display({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-dm-serif-display',
  display: 'swap',
});

const dmSans = DM_Sans({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const dmMono = DM_Mono({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-dm-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    template: '%s | LastDonor',
    default: 'LastDonor - Reviewed Crowdfunding with 0% Platform Fees',
  },
  description:
    'LastDonor helps donors support reviewed medical, emergency, veteran, disaster relief, and family fundraising campaigns with 0% platform fees on fundraisers and visible donation tracking.',
  keywords: seoKeywords('core', 'campaigns', 'trust', 'medical', 'emergency', 'disaster'),
  metadataBase: new URL('https://lastdonor.org'),
  alternates: {
    canonical: 'https://lastdonor.org',
  },
  openGraph: {
    siteName: 'LastDonor',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: '/api/v1/og/page?title=LastDonor+Crowdfunding&subtitle=0%25+platform+fees.+Campaigns+reviewed.+Impact+updates.',
        width: 1200,
        height: 630,
        alt: 'LastDonor - Reviewed Crowdfunding with 0% Platform Fees',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@lastdonororg',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        dmSerifDisplay.variable,
        dmSans.variable,
        dmMono.variable,
      )}
    >
      <head>
        {/* Preconnect to critical third-party origins */}
        <link rel="preconnect" href="https://js.stripe.com" />
        <link rel="dns-prefetch" href="https://js.stripe.com" />
        <link rel="preconnect" href={`https://${SUPABASE_HOST}`} />
        <link rel="dns-prefetch" href={`https://${SUPABASE_HOST}`} />
        <link rel="dns-prefetch" href="https://plausible.io" />
        {/* Tawk.to live chat — preconnect reduces widget load latency */}
        <link rel="preconnect" href="https://embed.tawk.to" />
        <link rel="dns-prefetch" href="https://embed.tawk.to" />
        <link rel="dns-prefetch" href="https://va.tawk.to" />
        {/* Structured data: @graph merges Organization + WebSite into one
            block so JSON-LD @id cross-references resolve within a shared graph context. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteSchemaGraph) }}
        />
        {/* Apply an explicit dark preference before paint; default is light. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
        <script
          defer
          data-domain="lastdonor.org"
          src="https://plausible.io/js/script.js"
        />
      </head>
      <body className="flex min-h-screen flex-col bg-background font-sans text-foreground antialiased">
        <noscript data-nosnippet>
          <div className="bg-yellow-50 px-4 py-3 text-center text-sm text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200">
            JavaScript is required to donate and interact with campaigns. Please enable JavaScript to continue.
          </div>
        </noscript>
        <Providers>
          <SkipToContent />
          <Navbar />
          <main id="main-content" className="flex-1">
            {children}
          </main>
          <Footer />
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}

