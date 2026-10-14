/**
 * SSRF guard tests — audit P1-15.
 *
 * The four outbound fetches in the news pipeline all used
 * `redirect: 'follow'` and validated nothing beyond `startsWith('https://')`:
 *
 *   src/lib/news/image-resolver.ts    (HEAD probe, article HTML fetch)
 *   src/lib/news/image-validation.ts  (HEAD probe)
 *   src/lib/news/fetch-article-body.ts (article HTML fetch)
 *
 * The project already shipped `INTERNAL_PATTERNS` in
 * `src/lib/validators/url-allowlist.ts` but the pipeline never imported it.
 *
 * The trigger these tests defend against: an indexed news article sets
 * `og:image` to a host that answers `302 Location: http://169.254.169.254/…`,
 * and our server fetches cloud instance metadata on the attacker's behalf.
 * A pre-flight check on the ORIGINAL url cannot see that, so the decisive
 * assertions here are the post-redirect ones.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertSafeOutboundUrl,
  isSafeOutboundUrl,
  isInternalHostname,
  isInternalUrl,
  validateImageUrl,
  SsrfBlockedError,
} from '@/lib/validators/url-allowlist';
import { safeFetch } from '@/lib/news/safe-fetch';
import { SUPABASE_HOST } from '@/lib/supabase-host';

const ROOT = resolve(__dirname, '../..');

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. The guard itself ────────────────────────────────────────────────────

describe('P1-15: outbound URL guard rejects non-public hosts', () => {
  const BLOCKED = [
    // Cloud instance metadata — the payload that motivates the whole fix.
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://metadata/computeMetadata/v1/',
    // Loopback and RFC1918.
    'http://localhost:3000/',
    'https://localhost/',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://172.31.255.254/',
    'http://192.168.1.1/',
    'http://0.0.0.0/',
    // Carrier-grade NAT — reachable inside many hosting providers.
    'http://100.64.0.1/',
    // IPv6 loopback, unique-local and link-local.
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    // IPv4-mapped IPv6: spells a private address without a dotted quad.
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:7f00:1]/',
    // Encoded IPv4 literals — each resolves to 127.0.0.1.
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    // Internal naming.
    'http://router/',
    'http://db.internal/',
    'http://cache.local/',
    'http://host.lan/',
    'http://svc.home.arpa/',
    // Non-fetchable schemes.
    'file:///etc/passwd',
    'gopher://evil.example.com/',
    'ftp://evil.example.com/',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ];

  for (const url of BLOCKED) {
    it(`blocks ${url}`, () => {
      expect(isSafeOutboundUrl(url)).toBe(false);
      expect(() => assertSafeOutboundUrl(url)).toThrow(SsrfBlockedError);
    });
  }

  const ALLOWED = [
    'https://ichef.bbci.co.uk/news/976/hero.jpg',
    'https://static01.nyt.com/images/2026/story.jpg',
    'https://images.unsplash.com/photo-123?w=800',
    `https://${SUPABASE_HOST}/storage/v1/object/public/media/x.jpg`,
    'https://news.example.com/photo.jpg',
  ];

  for (const url of ALLOWED) {
    it(`allows ${url}`, () => {
      expect(isSafeOutboundUrl(url)).toBe(true);
      expect(() => assertSafeOutboundUrl(url)).not.toThrow();
    });
  }

  it('blocks credentials in the authority, which hide the real host', () => {
    // `INTERNAL_PATTERNS` is anchored with `^https?://169\.254\.` and so does
    // NOT match this string — the real hostname is after the `@`. This is why
    // the guard parses the URL instead of regexing the raw string.
    const sneaky = 'https://trusted.bbci.co.uk@169.254.169.254/latest/meta-data/';
    expect(new URL(sneaky).hostname).toBe('169.254.169.254');
    expect(isSafeOutboundUrl(sneaky)).toBe(false);
    expect(isInternalUrl(sneaky)).toBe(true);
    expect(validateImageUrl(sneaky, true)).toBe(false);
  });

  it('rejects relative and malformed URLs rather than guessing', () => {
    expect(isSafeOutboundUrl('/latest/meta-data/')).toBe(false);
    expect(isSafeOutboundUrl('not a url')).toBe(false);
    expect(isSafeOutboundUrl('')).toBe(false);
  });

  it('normalises hostname case and the FQDN root dot', () => {
    expect(isInternalHostname('LOCALHOST')).toBe(true);
    expect(isInternalHostname('localhost.')).toBe(true);
    expect(isInternalHostname('METADATA.GOOGLE.INTERNAL')).toBe(true);
    expect(isInternalHostname('ichef.bbci.co.uk')).toBe(false);
  });
});

// ── 2. Post-redirect revalidation ──────────────────────────────────────────

/** Minimal redirect response; `safeFetch` must not follow this itself. */
function redirectTo(location: string, status = 302) {
  return {
    ok: false,
    status,
    url: '',
    headers: new Headers({ location }),
  } as unknown as Response;
}

function okResponse(contentType = 'image/jpeg') {
  return {
    ok: true,
    status: 200,
    url: '',
    headers: new Headers({ 'content-type': contentType }),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

describe('P1-15: safeFetch re-validates every redirect hop', () => {
  it('refuses a permitted host that 302s to cloud metadata', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : String(input);
        if (url.startsWith('https://news.example.com/')) {
          return redirectTo('http://169.254.169.254/latest/meta-data/');
        }
        return okResponse();
      });

    await expect(
      safeFetch('https://news.example.com/og.jpg', { method: 'HEAD' }),
    ).rejects.toThrow(SsrfBlockedError);

    // The decisive assertion: exactly ONE request was made — the metadata
    // endpoint was never contacted.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://news.example.com/og.jpg');
  });

  it('never delegates redirect following to the runtime', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await safeFetch('https://news.example.com/og.jpg', { method: 'HEAD' });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('follows a redirect to another public host, validating it first', async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input);
      seen.push(url);
      if (url === 'https://news.example.com/og.jpg') {
        return redirectTo('https://cdn.example.com/real.jpg', 301);
      }
      return okResponse();
    });

    const res = await safeFetch('https://news.example.com/og.jpg', { method: 'HEAD' });
    expect(res.ok).toBe(true);
    expect(seen).toEqual([
      'https://news.example.com/og.jpg',
      'https://cdn.example.com/real.jpg',
    ]);
  });

  it('resolves a relative Location against the current hop and still validates it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url === 'https://news.example.com/a') return redirectTo('/b');
      return okResponse();
    });

    const res = await safeFetch('https://news.example.com/a');
    expect(res.ok).toBe(true);
  });

  it('refuses a redirect chain that exceeds the hop budget', async () => {
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      n++;
      return redirectTo(`https://news.example.com/hop-${n}`);
    });

    await expect(
      safeFetch('https://news.example.com/start', { maxRedirects: 2 }),
    ).rejects.toThrow(/exceeded 2 redirects/);
    expect(n).toBe(3); // initial + 2 permitted hops, then refused
  });

  it('refuses a redirect to a non-http scheme', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      redirectTo('file:///etc/passwd'),
    );
    await expect(safeFetch('https://news.example.com/x')).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it('refuses the initial target before opening a socket', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await expect(safeFetch('http://169.254.169.254/latest/')).rejects.toThrow(
      SsrfBlockedError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bounds the whole chain with one AbortController, not one per hop', async () => {
    const signals: AbortSignal[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      signals.push((init as RequestInit).signal as AbortSignal);
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/a')) return redirectTo('https://cdn.example.com/b');
      return okResponse();
    });

    await safeFetch('https://news.example.com/a', { timeoutMs: 1_000 });
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
  });
});

// ── 3. The pipeline actually uses it ───────────────────────────────────────

describe('P1-15: all four pipeline fetch sites route through safeFetch', () => {
  const SITES = [
    'src/lib/news/image-resolver.ts',
    'src/lib/news/image-validation.ts',
    'src/lib/news/fetch-article-body.ts',
  ];

  for (const file of SITES) {
    const source = readFileSync(resolve(ROOT, file), 'utf-8');

    it(`${file} imports safeFetch`, () => {
      expect(source).toMatch(/from '@\/lib\/news\/safe-fetch'/);
    });

    it(`${file} contains no bare fetch( with redirect: 'follow'`, () => {
      expect(source).not.toMatch(/redirect:\s*'follow'/);
    });

    it(`${file} makes no direct fetch( call on an untrusted URL`, () => {
      // Fixed-host API calls (Unsplash, Pexels) are allowed to call fetch
      // directly; nothing may call it on a third-party-supplied URL.
      const directCalls = [...source.matchAll(/(?<![.\w])fetch\(\s*([^\s,)]+)/g)]
        .map((m) => m[1])
        .filter((arg) => !arg.includes('api.unsplash.com') && !arg.includes('api.pexels.com'));
      expect(directCalls).toEqual([]);
    });
  }

  it('image-resolver guards og:image candidates, not just their scheme', () => {
    const source = readFileSync(
      resolve(ROOT, 'src/lib/news/image-resolver.ts'),
      'utf-8',
    );
    expect(source).toMatch(/isSafeOutboundUrl/);
  });
});

// ── 4. End-to-end through the real pipeline entry points ───────────────────

describe('P1-15: pipeline entry points drop metadata-pointing images', () => {
  it('extractImageCandidates discards an og:image pointing at link-local', async () => {
    const { extractImageCandidates } = await import('@/lib/news/image-resolver');
    const html = `
      <meta property="og:image" content="https://169.254.169.254/latest/meta-data/">
      <meta name="twitter:image" content="https://cdn.example.com/real.jpg">
    `;
    expect(extractImageCandidates(html)).toEqual(['https://cdn.example.com/real.jpg']);
  });

  it('image-validation refuses an internal URL without issuing a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { validateImageUrl: probe } = await import('@/lib/news/image-validation');
    await expect(probe('http://169.254.169.254/latest/')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetchArticleBody falls back instead of fetching an internal URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { fetchArticleBody } = await import('@/lib/news/fetch-article-body');
    await expect(fetchArticleBody('http://localhost:9200/_search', 'summary'))
      .resolves.toBe('summary');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolveHeroImageEnhanced degrades to the category SVG when the article 302s to metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.startsWith('https://article.example.com')) {
        return redirectTo('http://169.254.169.254/latest/meta-data/');
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { resolveHeroImageEnhanced } = await import('@/lib/news/image-resolver');
    const result = await resolveHeroImageEnhanced({
      category: 'medical',
      articleUrl: 'https://article.example.com/story',
    });

    expect(result.source).toBe('fallback');
    expect(result.url).toBe('/images/categories/medical-default.svg');
  });
});
