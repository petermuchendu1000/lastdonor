/**
 * The first-party media route, EXECUTED.
 *
 * The whole defect this route exists for is a response header
 * (`X-Robots-Tag: none` from Supabase Storage), so the thing that must be
 * proven is what this route's own response carries - which cannot be read
 * from the source, only from a Response object.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from './[...path]/route';

const SUPABASE = 'https://vavxdjqufxrsbyohcwdh.supabase.co';
const KEY = 'campaign-photos/59171bbc-7077-485a-a432-b2546f156690.jpg';

/** The upstream, answering exactly as Supabase really does (header included). */
function upstreamOk(contentType = 'image/jpeg') {
  return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=31536000',
      // ⛔ The real header, reproduced: this is what must NOT come back out.
      'x-robots-tag': 'none',
    },
  });
}

const call = (key: string) =>
  GET(new Request(`https://lastdonor.org/media/${key}`), {
    params: Promise.resolve({ path: key.split('/') }),
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('⛔ the route does not re-publish the upstream noindex', () => {
  it('serves the image WITHOUT X-Robots-Tag, though upstream sent none', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstreamOk());

    const res = await call(KEY);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toContain('max-age=31536000');
    // The assertion the whole route exists for.
    expect(res.headers.get('x-robots-tag')).toBeNull();

    // And it asked the right upstream object.
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `${SUPABASE}/storage/v1/object/public/media/${KEY}`,
    );
  });

  it('⚠️ CONTROL: the fixture really does carry the header', async () => {
    /*
      Without this, a route that strips nothing would still pass the row
      above if the fixture never set the header in the first place.
    */
    expect(upstreamOk().headers.get('x-robots-tag')).toBe('none');
  });
});

describe('⛔ what the route refuses', () => {
  it('a private-document key is 404, never proxied', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstreamOk());

    const res = await call('verification-documents/passport.jpg');

    expect(res.status).toBe(404);
    // The real guarantee: it never even asked for it.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a traversal attempt is 404 and is not fetched', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstreamOk());

    const res = await GET(new Request('https://lastdonor.org/media/x'), {
      params: Promise.resolve({ path: ['..', '..', 'etc', 'passwd.jpg'] }),
    });

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('⛔ a non-image upstream is refused, so storage cannot serve HTML', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstreamOk('text/html'));

    const res = await call('uploads/page.jpg');
    expect(res.status).toBe(404);
  });

  it('⚠️ a missing object is 404, though Supabase answers it with HTTP 400', async () => {
    /*
      THE FIXTURE IS THE REAL ONE. [VERIFIED by execution against the live
      bucket] a missing object comes back as **HTTP 400** with a JSON body
      reading `{"statusCode":"404","error":"not_found","code":"NoSuchKey"}` -
      the status line does not mean what it says (`docs/92`'s family).

      The first version of this test mocked a tidy 404 and passed, while the
      route turned every deleted photo into a 502 against the real bucket.
      A fixture the real system could never produce is not evidence
      (`docs/128` §6).
    */
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found', code: 'NoSuchKey' }),
        { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } },
      ),
    );

    expect((await call(KEY)).status).toBe(404);
  });

  it('⚠️ CONTROL: a genuine upstream FAILURE is still 502, not 404', async () => {
    // Without this, "return 404 for everything that is not ok" would pass the
    // row above and would hide a storage outage as a missing image.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));

    expect((await call(KEY)).status).toBe(502);
  });

  it('an unreachable upstream is 502, never a silent 200', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    expect((await call(KEY)).status).toBe(502);
  });

  it('⛔ fails CLOSED and says so when the credential is absent', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await call(KEY);

    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
