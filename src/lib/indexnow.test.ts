/**
 * IndexNow: the protocol, and the three-way key invariant.
 *
 * The rules that matter here are not "does the function return the right
 * shape" - they are the two ways this feature fails SILENTLY in production:
 *
 *  1. The key diverges between the filename, the file contents and the
 *     payload. Every submission then answers 403 and nothing on this site
 *     changes, so there is no symptom to notice.
 *  2. A submitted URL is not on the submitted host. The API refuses the
 *     WHOLE batch with 422, so one bad URL loses every good one with it.
 *
 * Both are checked against reality - the key file is read off disk, and the
 * canonical origin is compared with the sitemap's own source - rather than
 * against a constant re-typed in this file, which would only prove the
 * constant equals itself.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  INDEXNOW_KEY,
  INDEXNOW_KEY_PATTERN,
  INDEXNOW_KEY_FILENAME,
  INDEXNOW_KEY_LOCATION,
  INDEXNOW_ORIGIN,
  INDEXNOW_HOST,
  INDEXNOW_ENDPOINT,
  INDEXNOW_MAX_URLS,
  isSubmittableUrl,
  buildIndexNowSubmission,
  campaignPublicationUrls,
  classifyIndexNowResponse,
  isIndexNowConfigurationFault,
} from './indexnow';

const ROOT = resolve(__dirname, '../..');
const KEY_FILE = resolve(ROOT, 'public', INDEXNOW_KEY_FILENAME);

describe('rule 1: the key is the same in all three places', () => {
  /*
    The filename, the file contents and the payload field. A mismatch in any
    direction is a 403 from the API and silence here.
  */
  it('has a key file on disk named after the key', () => {
    expect(
      existsSync(KEY_FILE),
      `public/${INDEXNOW_KEY_FILENAME} is missing. IndexNow verifies ownership by ` +
        'fetching it, so without it every submission answers 403.',
    ).toBe(true);
  });

  it('the file contains exactly the key', () => {
    const contents = readFileSync(KEY_FILE, 'utf8').trim();
    expect(contents).toBe(INDEXNOW_KEY);
  });

  it('keyLocation points at that exact file on the canonical origin', () => {
    expect(INDEXNOW_KEY_LOCATION).toBe(`${INDEXNOW_ORIGIN}/${INDEXNOW_KEY_FILENAME}`);
    // And it must be a real URL on the host we submit under, or 403.
    expect(new URL(INDEXNOW_KEY_LOCATION).host).toBe(INDEXNOW_HOST);
  });

  it('the key satisfies the published format', () => {
    expect(INDEXNOW_KEY).toMatch(INDEXNOW_KEY_PATTERN);
    expect(INDEXNOW_KEY.length).toBeGreaterThanOrEqual(8);
    expect(INDEXNOW_KEY.length).toBeLessThanOrEqual(128);
  });

  it('the pattern actually rejects things (anti-vacuity)', () => {
    // Without this, a pattern of /.*/ would satisfy the rule above.
    expect('short').not.toMatch(INDEXNOW_KEY_PATTERN); // under 8
    expect('has spaces in it').not.toMatch(INDEXNOW_KEY_PATTERN);
    expect('has_underscore_x').not.toMatch(INDEXNOW_KEY_PATTERN);
    expect('a'.repeat(129)).not.toMatch(INDEXNOW_KEY_PATTERN);
  });
});

describe('rule 2: the origin agrees with the sitemap', () => {
  /*
    IndexNow submits the URLs the sitemap advertises. If the two disagree
    about the host, submissions are refused 422 - and nothing else in the
    product would notice, because each is independently self-consistent.

    Derived from the sitemap's SOURCE rather than imported: importing it
    would pull in `@/db`, and re-typing the string here would only assert
    that this file equals itself.
  */
  it('INDEXNOW_ORIGIN equals BASE_URL in src/app/sitemap.ts', () => {
    const sitemapSrc = readFileSync(resolve(ROOT, 'src/app/sitemap.ts'), 'utf8');
    const m = /const BASE_URL = '([^']+)'/.exec(sitemapSrc);
    expect(m, 'could not find BASE_URL in sitemap.ts - the rule cannot run').not.toBeNull();
    expect(INDEXNOW_ORIGIN).toBe(m![1]);
  });

  it('the endpoint is the one verified by probe, not /submit-bulk', () => {
    /*
      A widely-copied third-party guide recommends
      `api.indexnow.org/submit-bulk`. [VERIFIED 2026-11-03] that path answers
      400 with an Edge HTML error page, byte-identical in shape to a
      fabricated control path, while `/indexnow` answers a JSON API error.
      It is not a real endpoint.
    */
    expect(INDEXNOW_ENDPOINT).toBe('https://api.indexnow.org/indexnow');
  });
});

describe('rule 3: only same-host HTTPS URLs are ever submitted', () => {
  it('accepts a canonical URL', () => {
    // Anti-vacuity: a predicate that rejected everything would pass the
    // rejection cases below while making the feature inert.
    expect(isSubmittableUrl(`${INDEXNOW_ORIGIN}/campaigns/some-slug`)).toBe(true);
    expect(isSubmittableUrl(`${INDEXNOW_ORIGIN}/`)).toBe(true);
  });

  it('rejects the duplicate hostnames, which is the 422 case', () => {
    expect(isSubmittableUrl('https://lastdonor.fly.dev/campaigns/x')).toBe(false);
    expect(isSubmittableUrl('https://origin.lastdonor.org/campaigns/x')).toBe(false);
    expect(isSubmittableUrl('https://www.lastdonor.org/campaigns/x')).toBe(false);
  });

  it('rejects other hosts, http, and malformed input', () => {
    expect(isSubmittableUrl('https://example.com/x')).toBe(false);
    expect(isSubmittableUrl(`http://${INDEXNOW_HOST}/x`)).toBe(false);
    expect(isSubmittableUrl('not a url')).toBe(false);
    expect(isSubmittableUrl('')).toBe(false);
  });

  it('filters a foreign URL out instead of losing the batch', () => {
    const built = buildIndexNowSubmission([
      `${INDEXNOW_ORIGIN}/a`,
      'https://example.com/evil',
      `${INDEXNOW_ORIGIN}/b`,
    ]);
    expect(built?.urlList).toEqual([`${INDEXNOW_ORIGIN}/a`, `${INDEXNOW_ORIGIN}/b`]);
  });
});

describe('rule 4: the payload shape the API confirmed', () => {
  it('carries exactly host, key, keyLocation, urlList', () => {
    const built = buildIndexNowSubmission([`${INDEXNOW_ORIGIN}/a`]);
    expect(built).not.toBeNull();
    expect(Object.keys(built!).sort()).toEqual(['host', 'key', 'keyLocation', 'urlList']);
    expect(built!.host).toBe(INDEXNOW_HOST);
    expect(built!.key).toBe(INDEXNOW_KEY);
  });

  it('every URL in a built payload is on the submitted host', () => {
    // The invariant the 422 case is about, asserted over the output.
    const built = buildIndexNowSubmission([
      `${INDEXNOW_ORIGIN}/a`,
      'https://example.com/b',
      `${INDEXNOW_ORIGIN}/c`,
    ]);
    for (const url of built!.urlList) {
      expect(new URL(url).host).toBe(built!.host);
    }
  });

  it('returns null rather than an empty urlList', () => {
    // An empty list is a 400 from the API, whose own error reads
    // "The urlList field is required." Callers must be able to tell
    // "nothing to do" from "send this".
    expect(buildIndexNowSubmission([])).toBeNull();
    expect(buildIndexNowSubmission(['https://example.com/x'])).toBeNull();
  });

  it('deduplicates while preserving order', () => {
    const built = buildIndexNowSubmission([
      `${INDEXNOW_ORIGIN}/b`,
      `${INDEXNOW_ORIGIN}/a`,
      `${INDEXNOW_ORIGIN}/b`,
    ]);
    expect(built!.urlList).toEqual([`${INDEXNOW_ORIGIN}/b`, `${INDEXNOW_ORIGIN}/a`]);
  });

  it('caps at the published per-request ceiling', () => {
    const many = Array.from({ length: INDEXNOW_MAX_URLS + 50 }, (_, i) => `${INDEXNOW_ORIGIN}/c/${i}`);
    expect(buildIndexNowSubmission(many)!.urlList.length).toBe(INDEXNOW_MAX_URLS);
  });
});

describe('rule 5: the publication URL set matches what the route revalidates', () => {
  /*
    Both ends derived from source (`docs/109`'s shape). The pages whose
    cached HTML the route purges are the pages whose content a crawler holds
    a stale copy of, so the two sets must not drift. If somebody adds a
    fourth `revalidatePath` and not a fourth submitted URL, this fails.
  */
  const ROUTE = resolve(ROOT, 'src/app/api/v1/admin/campaigns/[campaignId]/route.ts');

  function revalidatedPaths(): string[] {
    const src = readFileSync(ROUTE, 'utf8')
      // Comments quote paths while explaining them - strip first, or the
      // explanation counts as a call site (`docs/116` §4).
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    return [...src.matchAll(/revalidatePath\(\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => m[1]);
  }

  it('finds the route\'s revalidate calls at all (anti-vacuity)', () => {
    expect(revalidatedPaths().length).toBeGreaterThan(0);
  });

  it('submits one URL per revalidated path, on the canonical origin', () => {
    const paths = revalidatedPaths().map((p) => p.replace('${campaign.slug}', 'some-slug'));
    const submitted = campaignPublicationUrls('some-slug');
    expect(submitted.length).toBe(paths.length);
    for (const p of paths) {
      expect(submitted).toContain(`${INDEXNOW_ORIGIN}${p}`);
    }
  });

  it('every publication URL is submittable', () => {
    for (const url of campaignPublicationUrls('some-slug')) {
      expect(isSubmittableUrl(url)).toBe(true);
    }
  });
});

describe('rule 6: an outcome never claims more than the API said', () => {
  it('maps each documented status to its own outcome', () => {
    const at = (s: number) => classifyIndexNowResponse(s, null, 1).outcome;
    expect(at(200)).toBe('submitted');
    expect(at(202)).toBe('pending_key_validation');
    expect(at(400)).toBe('invalid_request');
    expect(at(403)).toBe('invalid_key');
    expect(at(422)).toBe('wrong_host');
    expect(at(429)).toBe('rate_limited');
    expect(at(500)).toBe('error');
    expect(at(0)).toBe('error');
  });

  it('distinguishes the statuses rather than collapsing them (anti-vacuity)', () => {
    // A classifier returning one constant would satisfy any single row above.
    const outcomes = [200, 202, 400, 403, 422, 429, 500].map(
      (s) => classifyIndexNowResponse(s, null, 1).outcome,
    );
    expect(new Set(outcomes).size).toBe(7);
  });

  it('carries the API errorCode into the detail', () => {
    const r = classifyIndexNowResponse(
      403,
      { errorCode: 'UserForbiddedToAccessSite', message: 'User is unauthorized' },
      3,
    );
    expect(r.detail).toContain('403');
    expect(r.detail).toContain('UserForbiddedToAccessSite');
    expect(r.submittedCount).toBe(3);
  });

  it('survives a 200 with no body, which is the success case', () => {
    // `response.json()` throws on an empty body and the caller passes null.
    // Reading that as a failure would misreport every success.
    expect(classifyIndexNowResponse(200, null, 2).outcome).toBe('submitted');
  });

  it('names receipt, never indexing', () => {
    /*
      The specification is explicit that 200 confirms receipt only. This
      codebase does not claim outcomes it cannot substantiate (`docs/158`,
      `docs/160`, `docs/162`), so no outcome may be spelled "indexed".
    */
    const all = [200, 202, 400, 403, 422, 429, 500].map(
      (s) => classifyIndexNowResponse(s, null, 1).outcome as string,
    );
    for (const outcome of all) {
      expect(outcome).not.toContain('indexed');
    }
  });
});

describe('rule 7: configuration faults are told apart from transient ones', () => {
  it('treats the three permanent failures as configuration faults', () => {
    expect(isIndexNowConfigurationFault('invalid_key')).toBe(true);
    expect(isIndexNowConfigurationFault('invalid_request')).toBe(true);
    expect(isIndexNowConfigurationFault('wrong_host')).toBe(true);
  });

  it('does not treat success or transient failure as one', () => {
    // Without this, `() => true` passes the rule above and every submission
    // is logged at error severity, which is the same as logging none.
    expect(isIndexNowConfigurationFault('submitted')).toBe(false);
    expect(isIndexNowConfigurationFault('pending_key_validation')).toBe(false);
    expect(isIndexNowConfigurationFault('rate_limited')).toBe(false);
    expect(isIndexNowConfigurationFault('error')).toBe(false);
  });
});
