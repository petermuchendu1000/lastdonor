import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Registrable domains whose images may be optimised by `/_next/image`
 * (audit P1-14).
 *
 * ## Why this list exists
 *
 * `remotePatterns` previously contained `{ protocol: "https", hostname: "**" }`.
 * `/_next/image` is matched by no entry in `src/middleware.ts`, so it is
 * unauthenticated and unrate-limited; with a `"**"` hostname it was therefore a
 * general-purpose server-side fetcher that any anonymous caller could point at
 * any HTTPS host on the internet.
 *
 * ## Why these domains, and why the list is this short
 *
 * The news pipeline resolves hero images from arbitrary publishers, so there is
 * no small set of "our CDN hosts" to enumerate. The candidate set is the ~110
 * publishers in `RSS_FEEDS` (`src/lib/news/rss-parser.ts`) plus arbitrary GNews
 * publishers — but **Next.js caps `images.remotePatterns` at 50 entries**
 * (verified 2026-10-14 against the installed next@15:
 * `node_modules/next/dist/server/config-schema.js:559` — `.max(50)`; exceeding it
 * makes `next lint`/`next build` reject the config outright). A full
 * enumeration is therefore not merely unwieldy, it is impossible.
 *
 * So this list is the highest-value 43 domains, chosen to match the product's
 * actual categories (military, veterans, first responders, disaster, US metro)
 * plus the wires, plus the publisher-owned image CDNs that sit on a different
 * domain from the article (Guardian `i.guim.co.uk`, NYT `static01.nyt.com`, the
 * Gannett network). Each is expanded below to a single `**.domain` pattern.
 * Verified 2026-10-14 against the installed picomatch
 * (`next/dist/compiled/picomatch`, used by `matchRemotePattern`):
 * `**.example.com` matches `www.example.com` and `a.b.example.com` but NOT the
 * apex `example.com`, and does not match `notexample.com` or
 * `example.com.evil.net`. Publishers serve images from a subdomain
 * (`www.`, `i.`, `media.`, `static01.`), so subdomain-only patterns are the
 * right trade for the scarce slots; apex-hosted images are not optimised.
 *
 * ## Trade-off accepted
 *
 * Multi-tenant CDNs are deliberately NOT listed — `cloudfront.net`,
 * `s3.amazonaws.com`, `wp.com`, `akamaized.net` and friends are host namespaces
 * any attacker can obtain a subdomain in, so allowing them would restore the
 * open-fetcher primitive under a longer name. The one CloudFront entry below is
 * a single pinned distribution (DVIDS), not a wildcard.
 *
 * The cost, stated plainly: images hosted outside these domains — the ~65
 * unlisted feed publishers, arbitrary GNews publishers, apex-hosted images, and
 * campaigner-pasted `heroImageUrl` values on arbitrary hosts — get a 400 from
 * `/_next/image` and render broken rather than unoptimised. That is a visible,
 * bounded, cosmetic failure; an anonymous server-side fetcher is not.
 *
 * ## The real fix this is a step towards
 *
 * Because the cap makes a complete allowlist unreachable, the durable answer is
 * first-party ingestion: fetch each resolved image once at publish time through
 * `src/lib/news/safe-fetch.ts`, re-upload it to our own bucket, and store our
 * own URL — after which this list collapses to the first-party and stock hosts
 * alone and no third-party host needs optimising at all. That also closes the
 * residual risk recorded here: the optimiser still follows redirects, so an open
 * redirect on a listed publisher's domain can be chained.
 */
const NEWS_IMAGE_DOMAINS = [
  // ── Wires and US national ───────────────────────────────────────────────
  "apnews.com",
  "reuters.com",
  "upi.com",
  "npr.org",
  "nytimes.com",
  "nyt.com",            // NYT image CDN (static01.nyt.com)
  "washingtonpost.com",
  "usatoday.com",
  "gannett-cdn.com",    // Gannett network image CDN (USA Today, azcentral, …)
  "pbs.org",

  // ── US broadcast ────────────────────────────────────────────────────────
  "abcnews.com",
  "cbsnews.com",
  "nbcnews.com",
  "latimes.com",

  // ── Military, veterans, first responders (the product's core categories) ─
  "defense.gov",
  "dvidshub.net",
  "stripes.com",
  "militarytimes.com",
  "va.gov",
  "fema.gov",
  "odmp.org",
  "firehouse.com",
  "firerescue1.com",
  "police1.com",
  "ems1.com",

  // ── US metro ────────────────────────────────────────────────────────────
  "chicagotribune.com",
  "houstonchronicle.com",
  "miamiherald.com",
  "denverpost.com",
  "seattletimes.com",
  "startribune.com",
  "twincities.com",
  "oregonlive.com",

  // ── UK and Canada ───────────────────────────────────────────────────────
  "bbci.co.uk",
  "theguardian.com",
  "guim.co.uk",         // Guardian image CDN (i.guim.co.uk)
  "skynews.com",
  "independent.co.uk",
  "cbc.ca",
  "globalnews.ca",
  "ctvnews.ca",

  // ── Humanitarian wires ──────────────────────────────────────────────────
  "reliefweb.int",
  "icrc.org",
] as const;

/**
 * Hostname of our Supabase project. Mirrors `supabaseHostFrom` in
 * `src/lib/supabase-host.ts`; kept in sync by test, see below.
 */
const SUPABASE_HOST = (() => {
  const raw =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const fallback = "vavxdjqufxrsbyohcwdh.supabase.co";
  if (!raw) return fallback;
  try {
    return new URL(raw).hostname || fallback;
  } catch {
    return fallback;
  }
})();

/**
 * First-party and stock-photo image sources. These are the only hosts the
 * product itself writes into `heroImageUrl`/`galleryImages` when an operator or
 * campaigner uploads through us, plus the two stock APIs the resolver's
 * tiers 3-4 fall back to (`src/lib/news/image-resolver.ts`).
 */
const FIRST_PARTY_IMAGE_PATTERNS = [
  {
    protocol: "https" as const,
    // Derived, not hardcoded: the previous literal pointed at a Supabase
    // project that is not in this account, so every campaign image 404'd
    // (docs/35 §5). The same two-line derivation lives in
    // `src/lib/supabase-host.ts` for the runtime call sites; it is duplicated
    // here rather than imported because `next.config.ts` is loaded by Next's
    // own TS transpiler and a failed import there kills the build. The
    // duplication is pinned by a test — see
    // `test/security/image-optimizer-hosts.test.ts`.
    hostname: SUPABASE_HOST,
    pathname: "/storage/v1/object/public/**",
  },
  {
    // DVIDS CDN — a single pinned CloudFront distribution, never `*.cloudfront.net`.
    protocol: "https" as const,
    hostname: "d1ds6k2agfrpnf.cloudfront.net",
  },
  { protocol: "https" as const, hostname: "images.unsplash.com" },
  { protocol: "https" as const, hostname: "images.pexels.com" },
  { protocol: "https" as const, hostname: "cdn.pixabay.com" },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle in `.next/standalone` for the Fly.io image
  // (docs/26 §1 "Vercel couplings to remove", §10 step 1). Without this the
  // runtime stage would have to carry the full `node_modules` tree.
  output: "standalone",
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  staticPageGenerationTimeout: 180,
  experimental: {
    optimizePackageImports: [
      '@heroicons/react',
      'date-fns',
      'recharts',
      'motion',
    ],
  },
  images: {
    remotePatterns: [
      ...FIRST_PARTY_IMAGE_PATTERNS,
      // One pattern per news domain, matching any subdomain depth. Kept to one
      // slot each because `images.remotePatterns` is capped at 50 entries.
      ...NEWS_IMAGE_DOMAINS.map((domain) => ({
        protocol: "https" as const,
        hostname: `**.${domain}`,
      })),
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
    // Required: the category fallback images (`/images/categories/*.svg`) are
    // SVGs served through the optimiser. Contained by the attachment
    // disposition and the image-scoped CSP below.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), payment=(self)",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        {
          /**
           * Content-Security-Policy (audit P2-5, partial).
           *
           * `script-src` still carries `'unsafe-inline'`. It cannot be removed
           * from here: the App Router emits per-page inline bootstrap scripts
           * (`self.__next_f.push(...)`) whose contents differ per route, so
           * neither a static hash list nor a static nonce can cover them. A
           * real nonce must be minted per request, which only middleware can
           * do. The precise follow-up is recorded in `docs/31` §3.6 and
           * restated here so the next reader does not re-derive it:
           *
           *   1. In `src/middleware.ts`, generate `crypto.randomUUID()` (or 16
           *      random bytes, base64) per request.
           *   2. Set it on the forwarded request as `x-nonce` and emit the CSP
           *      header from middleware with
           *      `script-src 'self' 'nonce-<n>' 'strict-dynamic'`, dropping
           *      `'unsafe-inline'` (kept only as a pre-CSP3 fallback, which
           *      CSP3 browsers ignore when a nonce is present).
           *   3. Delete the `Content-Security-Policy` entry from this file, so
           *      the static header cannot shadow the per-request one.
           *   4. Read the nonce in `src/app/layout.tsx` via `headers()` and
           *      pass it to any `<Script>` tag.
           *
           * Until then this header does everything containment-wise that a
           * static header can:
           *
           *   - `script-src-attr 'none'` blocks ALL inline event-handler
           *     attributes (`onerror=`, `onload=`, …) while leaving Next's
           *     inline `<script>` blocks working. That is the execution path
           *     almost every sanitiser bypass actually uses, so this is the
           *     bulk of the containment a nonce would buy, available today.
           *   - `base-uri 'self'` stops an injected `<base href>` from
           *     re-pointing every relative script URL at an attacker origin.
           *   - `form-action 'self'` stops an injected form from exfiltrating
           *     to an external origin. Verified safe: no `<form action=...>`
           *     in `src/` posts off-origin; Stripe is entered via a JS
           *     redirect, not a cross-origin form POST.
           *   - `object-src 'none'` removes the plugin execution path.
           *   - `frame-ancestors 'none'` is the CSP equivalent of the
           *     `X-Frame-Options: DENY` above, which modern browsers prefer.
           */
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' js.stripe.com plausible.io embed.tawk.to",
            "script-src-attr 'none'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https: *.supabase.co dvidshub.net img.youtube.com",
            "connect-src 'self' api.stripe.com *.supabase.co *.sentry.io wss://ws-us3.pusher.com https://*.tawk.to wss://*.tawk.to",
            "frame-src 'self' https://js.stripe.com https://www.youtube-nocookie.com https://youtube-nocookie.com https://www.youtube.com https://youtube.com https://*.tawk.to",
            "font-src 'self' fonts.gstatic.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "upgrade-insecure-requests",
          ].join("; "),
        },
      ],
    },
    {
      // Immutable static assets (hashed filenames)
      source: "/_next/static/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    },
    {
      // Public static assets (images, fonts)
      source: "/:path(images|fonts)/:file*",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=604800, stale-while-revalidate=86400",
        },
      ],
    },
    {
      source: "/api/v1/stats",
      headers: [
        {
          key: "Cache-Control",
          value: "s-maxage=300, stale-while-revalidate=600",
        },
      ],
    },
    {
      source: "/api/v1/campaigns",
      headers: [
        {
          key: "Cache-Control",
          value: "s-maxage=60, stale-while-revalidate=600",
        },
      ],
    },
    {
      source: "/api/v1/donations/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: "no-store",
        },
      ],
    },
    {
      source: "/api/v1/og/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=86400, s-maxage=86400",
        },
      ],
    },
  ],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  // tunnelRoute is DISABLED deliberately. Verified live 2026-10-15: the client
  // bundle carried `globalThis._sentryRewritesTunnelPath="/monitoring"`, so the
  // SDK POSTed every envelope to /monitoring — and that path returned 404 on
  // both GET and POST, with no rewrite in the built output and no route under
  // `.next/server/app`. Net effect: every client-side error was silently
  // dropped, which is worse than no Sentry at all, because the dashboard looks
  // healthy. Without it the SDK posts straight to ingest.de.sentry.io, which
  // works; the only thing lost is ad-blocker evasion. Re-enable only after
  // confirming a rewrite actually appears in routes-manifest.json for the
  // standalone build. See docs/38.
  sourcemaps: {
    disable: true,
  },
});
