/**
 * Serve an organiser's uploaded image from OUR domain.
 *
 * ── WHY THIS ROUTE EXISTS ───────────────────────────────────────────────────
 *
 * ⛔ **Supabase Storage sends `X-Robots-Tag: none` on every public object.**
 * Google's own documentation defines `none` as *"Equivalent to `noindex,
 * nofollow`"* and names `X-Robots-Tag` as the way to block indexing of image
 * files. So every campaign photo an organiser uploads was published at an
 * address Google is explicitly instructed not to index - and `sitemap.ts`
 * was advertising exactly that address.
 *
 * [VERIFIED live 2026-11-04]
 *
 *   | subject                                   | X-Robots-Tag |
 *   |-------------------------------------------|--------------|
 *   | the Supabase object (what we advertised)  | `none`       |
 *   | our own panel   (control)                 | absent       |
 *   | our own explainer (control)               | absent       |
 *   | `/_next/image` proxying the same object   | absent       |
 *
 * ⚠️ That fourth row is why this is narrower than it first looks: the PAGE
 * was always fine, because the optimizer does not forward the header. Only
 * the sitemap pointed at the forbidden URL.
 *
 * ── WHY A ROUTE HANDLER AND NOT A REWRITE ───────────────────────────────────
 *
 * A rewrite proxies the upstream response, and whether Next forwards an
 * upstream `X-Robots-Tag` is not something this fix should have to assume -
 * the entire defect IS a header. Here every response header is written
 * explicitly, so the question cannot arise.
 *
 * ⛔ It lives OUTSIDE `/api/`, deliberately: `robots.ts` disallows `/api/` for
 * every agent group except the one `/api/v1/og/` allowance, so an image
 * served from there would be unfetchable by the crawler this exists for
 * (`docs/142`).
 */
import { NextResponse } from 'next/server';
import {
  PUBLIC_MEDIA_PREFIX,
  isServableMediaKey,
} from '@/lib/campaign-hero';

export const runtime = 'nodejs';

/** Matches what Supabase itself sends, and what the objects are: immutable. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Only an image may come back, whatever the bucket holds. */
const SERVABLE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

function upstreamBase(): string | null {
  const configured = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = (path ?? []).join('/');

  /*
    One predicate, shared with the resolver that MINTS these paths, so a key
    the renderer would never produce is also a key this route will not serve
    (`docs/146`: the predicate that names a thing is the predicate that
    serves it). It refuses traversal and the private-document prefixes.
  */
  if (!isServableMediaKey(key)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const base = upstreamBase();
  if (base === null) {
    // Fail closed and say so, rather than 404 - a missing credential is an
    // operator problem, not a missing image (`docs/97` §5.4's lesson).
    console.error('[media] NEXT_PUBLIC_SUPABASE_URL is not set');
    return new NextResponse('Image serving is not configured', { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${base}${PUBLIC_MEDIA_PREFIX}${key}`, {
      // The objects are immutable; let the platform cache them.
      next: { revalidate: 31_536_000 },
    });
  } catch {
    return new NextResponse('Upstream unavailable', { status: 502 });
  }

  if (!upstream.ok) {
    /*
      ⚠️ Supabase answers a MISSING object with **HTTP 400** and a JSON body
      reading `{"statusCode":"404","error":"not_found",...}` - the status line
      does not mean what it says (`docs/92`'s family, where `success: true`
      arrived beside `status: "FAILED"`). [VERIFIED by execution against the
      real bucket.] So the first version of this branch, written against a
      mock that returned a tidy 404, turned every deleted photo into a 502.

      Any 4xx means we cannot serve the object; only a real upstream failure
      is a 502.
    */
    return new NextResponse('Not found', { status: upstream.status < 500 ? 404 : 502 });
  }

  const contentType = (upstream.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!SERVABLE_TYPES.has(contentType)) {
    // The bucket is public and this route is public, so it serves images and
    // nothing else - never an HTML document or a script from storage.
    return new NextResponse('Not found', { status: 404 });
  }

  /*
    ⛔ Headers are WRITTEN, not forwarded. In particular `X-Robots-Tag` is
    absent by construction: copying the upstream headers would copy the
    `none` that this whole route exists to escape.
  */
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
