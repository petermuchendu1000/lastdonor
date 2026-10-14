/**
 * Security response headers — audit P2-5.
 *
 * `script-src` carried `'unsafe-inline'` with no nonce, which removes all
 * containment for a sanitiser bypass. A real nonce has to be minted per
 * request and so belongs in `src/middleware.ts`; what a *static* header can
 * still do is remove the execution paths a bypass actually uses. These tests
 * pin that, and pin the headers docs/29 §5 recorded as already correct
 * (frame DENY, nosniff, HSTS preload) so a future edit cannot quietly weaken
 * them.
 *
 * Asserted against the REAL exported Next config.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';

interface HeaderEntry { key: string; value: string }
interface HeaderRule { source: string; headers: HeaderEntry[] }

let globalRule: HeaderRule;
let csp: Map<string, string[]>;

function headerValue(key: string): string | undefined {
  return globalRule.headers.find(
    (h) => h.key.toLowerCase() === key.toLowerCase(),
  )?.value;
}

beforeAll(async () => {
  const mod = await import('../../next.config');
  const cfg = mod.default as { headers?: () => Promise<HeaderRule[]> };
  const rules = (await cfg.headers?.()) ?? [];

  const found = rules.find((r) => r.source === '/(.*)');
  expect(found, 'expected a site-wide header rule for /(.*)').toBeDefined();
  globalRule = found!;

  const cspValue = headerValue('Content-Security-Policy') ?? '';
  csp = new Map(
    cspValue
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name.toLowerCase(), values] as [string, string[]];
      }),
  );
});

describe('P2-5: CSP contains the execution path a sanitiser bypass needs', () => {
  it('sets a Content-Security-Policy at all', () => {
    expect(csp.size).toBeGreaterThan(0);
  });

  it("blocks every inline event-handler attribute via script-src-attr 'none'", () => {
    // This is the containment that matters without a nonce: `onerror=`,
    // `onload=`, `ontoggle=` and friends are how the canary payloads in
    // canary-payloads.test.ts would execute if the sanitiser ever let one
    // through. Next's own inline <script> blocks are unaffected.
    expect(csp.get('script-src-attr')).toEqual(["'none'"]);
  });

  it("sets base-uri 'self' so an injected <base> cannot repoint script URLs", () => {
    expect(csp.get('base-uri')).toEqual(["'self'"]);
  });

  it("sets form-action 'self' so an injected form cannot exfiltrate off-origin", () => {
    expect(csp.get('form-action')).toEqual(["'self'"]);
  });

  it("sets object-src 'none'", () => {
    expect(csp.get('object-src')).toEqual(["'none'"]);
  });

  it("sets frame-ancestors 'none' alongside X-Frame-Options", () => {
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('keeps a default-src fallback of self', () => {
    expect(csp.get('default-src')).toEqual(["'self'"]);
  });

  it('never allows unsafe-eval', () => {
    const scriptSrc = (csp.get('script-src') ?? []).join(' ');
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('does not use a wildcard script-src', () => {
    const scriptSrc = csp.get('script-src') ?? [];
    expect(scriptSrc).not.toContain('*');
    expect(scriptSrc).not.toContain('https:');
  });

  /**
   * Honest record of the remaining gap rather than a silent omission.
   * When the middleware nonce lands (docs/31 §3.6), `'unsafe-inline'` leaves
   * `script-src` and this test is replaced by its inverse.
   */
  it("still carries 'unsafe-inline' in script-src — nonce work is NOT done", () => {
    expect(csp.get('script-src')).toContain("'unsafe-inline'");
    expect(csp.get('script-src')).not.toContain("'strict-dynamic'");
  });

  it('documents the exact middleware follow-up in the config', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const source = readFileSync(
      resolve(__dirname, '../../next.config.ts'),
      'utf-8',
    );
    expect(source).toMatch(/nonce/i);
    expect(source).toMatch(/middleware/i);
  });
});

describe('docs/29 §5: headers already assessed as sound must not regress', () => {
  it('X-Frame-Options: DENY', () => {
    expect(headerValue('X-Frame-Options')).toBe('DENY');
  });

  it('X-Content-Type-Options: nosniff', () => {
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
  });

  it('HSTS with a two-year max-age, subdomains and preload', () => {
    const hsts = headerValue('Strict-Transport-Security') ?? '';
    expect(hsts).toContain('preload');
    expect(hsts).toContain('includeSubDomains');
    const maxAge = /max-age=(\d+)/.exec(hsts)?.[1];
    expect(Number(maxAge)).toBeGreaterThanOrEqual(63072000);
  });

  it('Referrer-Policy is strict-origin-when-cross-origin', () => {
    expect(headerValue('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('Permissions-Policy denies camera, microphone and geolocation', () => {
    const pp = headerValue('Permissions-Policy') ?? '';
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });
});

describe('image optimiser keeps its own hardened CSP', () => {
  it("serves optimised images under script-src 'none' and a sandbox", async () => {
    const mod = await import('../../next.config');
    const cfg = mod.default as {
      images?: { contentSecurityPolicy?: string; contentDispositionType?: string };
    };
    const imageCsp = cfg.images?.contentSecurityPolicy ?? '';
    expect(imageCsp).toContain("script-src 'none'");
    expect(imageCsp).toContain('sandbox');
    // `dangerouslyAllowSVG` is required for the category fallback SVGs; the
    // attachment disposition is what keeps a hostile SVG from rendering
    // in-origin.
    expect(cfg.images?.contentDispositionType).toBe('attachment');
  });
});
