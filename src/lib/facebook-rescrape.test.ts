/**
 * The re-scrape decisions.
 *
 * Two things here are worth more than the rest: that a token can never reach
 * a printed line, and that an accepted-but-useless response is NOT reported
 * as a refresh. Both are the shape this codebase keeps meeting - PayHero's
 * `success: true` beside `status: FAILED` (`docs/92`), the FX provider's
 * HTTP 200 errors (`docs/102`), Africa's Talking answering 201 for a failed
 * send (`docs/84`).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  GRAPH_ENDPOINT,
  GRAPH_VERSION,
  classifyScrape,
  heldCardVersion,
  redactToken,
  scrapeBody,
  summariseScraped,
} from '@/lib/facebook-rescrape';
import { CARD_VERSION } from '@/lib/og-card-metrics';

const TOKEN = 'EAAB-not-a-real-token-0123456789';
const URL_ = 'https://lastdonor.org/campaigns/mila-ostrowski';

describe('the request', () => {
  it('pins the Graph version rather than following Meta\'s default', () => {
    expect(GRAPH_ENDPOINT).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/`);
    expect(GRAPH_VERSION).toMatch(/^v\d+\.\d+$/);
  });

  it('⛔ carries scrape=true, which is what makes it a write', () => {
    // Without it the same call returns Facebook's CACHED view - exactly the
    // thing being replaced - and the run would report success having
    // changed nothing.
    const body = scrapeBody(URL_, TOKEN);
    expect(body.get('scrape')).toBe('true');
    expect(body.get('id')).toBe(URL_);
  });

  it('⛔ puts the token in the BODY, where it stays out of logs and history', () => {
    const body = scrapeBody(URL_, TOKEN);
    expect(body.get('access_token')).toBe(TOKEN);
    // The endpoint the script posts to must carry no credential at all.
    expect(GRAPH_ENDPOINT).not.toContain('access_token');
  });
});

describe('⛔ a token never reaches a printed line', () => {
  it('redacts the token wherever it appears', () => {
    expect(redactToken(`boom ${TOKEN} end`, TOKEN)).toBe('boom ***REDACTED*** end');
    expect(redactToken(`${TOKEN}${TOKEN}`, TOKEN)).toBe('***REDACTED******REDACTED***');
  });

  it('redacts a token echoed back inside a Graph error message', () => {
    // Graph does quote the offending input in some errors.
    const r = classifyScrape(400, {
      error: { code: 190, message: `Invalid OAuth access token ${TOKEN}` },
    }, TOKEN);
    expect(r.detail).not.toContain(TOKEN);
    expect(r.detail).toContain('***REDACTED***');
  });

  it('leaves text alone when no token was supplied', () => {
    expect(redactToken('nothing to hide', '')).toBe('nothing to hide');
  });
});

describe('classifying the response', () => {
  it('reports a real scrape as refreshed, with what Facebook now holds', () => {
    const r = classifyScrape(200, {
      id: '1234567890',
      og_object: {
        title: 'Help Amina Finish Her Cancer Treatment',
        updated_time: '2026-10-25T14:00:00+0000',
      },
      image: [{ url: `https://lastdonor.org/api/v1/og/campaign/x?v=${CARD_VERSION}` }],
    });
    expect(r.outcome).toBe('refreshed');
    expect(r.scraped?.title).toContain('Amina');
    expect(r.scraped?.updatedTime).toBeTruthy();
  });

  it('⛔ an accepted request that scraped NOTHING is not a refresh', () => {
    /*
      HTTP 200, no error object, and no `id`. Treating this as success is how
      a run reports "14 refreshed" having changed nothing.
    */
    const r = classifyScrape(200, {});
    expect(r.outcome).toBe('unreachable_page');
  });

  it('tells a dead token apart from a page it could not fetch', () => {
    // Both arrive as HTTP 400 with a body; the operator's next action differs.
    expect(classifyScrape(400, { error: { code: 190, message: 'bad token' } }).outcome)
      .toBe('auth');
    expect(classifyScrape(400, { error: { code: 100, message: 'must have a valid access token' } }).outcome)
      .toBe('auth');
    expect(classifyScrape(400, { error: { code: 1611016, message: 'could not fetch' } }).outcome)
      .toBe('error');
  });

  it('tells throttling apart, because the answer is "run it again later"', () => {
    for (const code of [4, 17, 32, 613, 80001]) {
      expect(classifyScrape(400, { error: { code, message: 'limit' } }).outcome, String(code))
        .toBe('rate_limited');
    }
  });

  it('⚠️ reads the BODY, not just the status', () => {
    // An error object alongside HTTP 200 is classified from the error.
    expect(classifyScrape(200, { error: { code: 190, message: 'x' } }).outcome).toBe('auth');
    // And a non-2xx with no error object is still a failure, not a refresh.
    expect(classifyScrape(500, {}).outcome).toBe('error');
  });

  it('survives a null or odd body without throwing', () => {
    expect(classifyScrape(200, null).outcome).toBe('unreachable_page');
    expect(classifyScrape(200, 'not an object').outcome).toBe('unreachable_page');
  });
});

describe('summariseScraped', () => {
  it('takes the first image URL from the array Graph returns', () => {
    expect(summariseScraped({ image: [{ url: 'a' }, { url: 'b' }] })?.image).toBe('a');
  });

  it('returns undefined fields rather than inventing them', () => {
    const s = summariseScraped({});
    expect(s?.title).toBeUndefined();
    expect(s?.image).toBeUndefined();
    expect(s?.updatedTime).toBeUndefined();
  });

  it('ignores a malformed image entry', () => {
    expect(summariseScraped({ image: [{ nope: 1 }] })?.image).toBeUndefined();
    expect(summariseScraped({ image: 'not an array' })?.image).toBeUndefined();
  });
});

describe('heldCardVersion - the evidence the cache actually turned over', () => {
  it('reads the version out of the image URL', () => {
    expect(heldCardVersion({ image: 'https://x/og/campaign/a?v=2' })).toBe(2);
    expect(heldCardVersion({ image: 'https://x/og/campaign/a?w=1&v=7' })).toBe(7);
  });

  it('⚠️ answers null for "unknown", never 0', () => {
    // Unknown and wrong are different answers, and the script branches on it.
    expect(heldCardVersion(undefined)).toBeNull();
    expect(heldCardVersion({})).toBeNull();
    expect(heldCardVersion({ image: 'https://x/og/campaign/a' })).toBeNull();
  });

  it('a stale cache is detectable: the old URL carries no version at all', () => {
    // Before CARD_VERSION the og:image URL had no query string, so anything
    // Facebook still holds from then reads as null, not as the current one.
    expect(heldCardVersion({ image: 'https://lastdonor.org/api/v1/og/campaign/mila-ostrowski' }))
      .not.toBe(CARD_VERSION);
  });
});
