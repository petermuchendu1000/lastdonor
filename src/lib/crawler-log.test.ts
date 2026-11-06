/**
 * The crawler log, checked for the two properties it has to have.
 *
 * It exists to answer one question - did Meta fetch us at all - so the rules
 * are (1) it recognises the crawlers that question is about, and (2) it writes
 * NOTHING for anybody else, which is what keeps a public route from becoming a
 * store of personal data.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KNOWN_CRAWLERS,
  MAX_LOGGED_AGENT_CHARS,
  crawlerHitLine,
  identifyCrawler,
  logCrawlerHit,
} from '@/lib/crawler-log';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Real strings, as these agents actually send them. */
const REAL_AGENTS: ReadonlyArray<readonly [string, string]> = [
  ['whatsapp', 'WhatsApp/2.23.20.0 A'],
  ['whatsapp', 'WhatsApp/2.2412.54 N'],
  ['facebook', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['facebook', 'facebookexternalhit/1.1'],
  ['facebook', 'Facebot'],
  ['twitter', 'Twitterbot/1.0'],
  ['linkedin', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; +http://www.linkedin.com)'],
  ['slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
  ['telegram', 'TelegramBot (like TwitterBot)'],
  ['discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
  ['apple', 'Mozilla/5.0 (Macintosh) AppleWebKit/605 (KHTML, like Gecko) Applebot/0.1'],
  ['google', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['bing', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  ['openai', 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)'],
];

describe('⛔ it recognises the crawlers the question is about', () => {
  for (const [expected, agent] of REAL_AGENTS) {
    it(`"${agent.slice(0, 44)}" -> ${expected}`, () => {
      expect(identifyCrawler(agent)).toBe(expected);
    });
  }

  it('matches case-insensitively, because a header is free text', () => {
    expect(identifyCrawler('FACEBOOKEXTERNALHIT/1.1')).toBe('facebook');
    expect(identifyCrawler('whatsapp/2.0')).toBe('whatsapp');
  });

  it('⛔ Telegram is not recorded as Twitter', () => {
    /*
      Telegram's real agent is `TelegramBot (like TwitterBot)` - it CONTAINS
      the token `twitterbot`. With `twitter` ordered first, every Telegram
      fetch was attributed to Twitter, and this row is what caught it. A
      substring matcher is an ordered matcher whether or not its author meant
      it to be.
    */
    expect(identifyCrawler('TelegramBot (like TwitterBot)')).toBe('telegram');
    const telegramIndex = KNOWN_CRAWLERS.findIndex((c) => c.token === 'telegrambot');
    const twitterIndex = KNOWN_CRAWLERS.findIndex((c) => c.token === 'twitterbot');
    expect(telegramIndex).toBeLessThan(twitterIndex);

    // The control: a plain Twitterbot is still Twitter, so the fix is not
    // "call everything telegram".
    expect(identifyCrawler('Twitterbot/1.0')).toBe('twitter');
  });

  it('⚠️ WhatsApp wins when an agent carries BOTH names', () => {
    /*
      WhatsApp sends its own string on some surfaces and
      `facebookexternalhit` on others, and a request carrying both is more
      specifically WhatsApp. Collapsing the two is exactly what would make
      this log unable to answer the question it was built for.
    */
    expect(identifyCrawler('WhatsApp/2.23 facebookexternalhit/1.1')).toBe('whatsapp');
    const whatsappIndex = KNOWN_CRAWLERS.findIndex((c) => c.token === 'whatsapp');
    const facebookIndex = KNOWN_CRAWLERS.findIndex((c) => c.token === 'facebookexternalhit');
    expect(whatsappIndex).toBeLessThan(facebookIndex);
  });
});

describe('⛔ it writes NOTHING for anybody who is not a crawler', () => {
  /*
    THE ANTI-VACUITY CONTROL, and the reason this file exists at all. A rule
    that only checks "crawlers are recognised" is satisfied by a function that
    returns a name for EVERY request - which on a public route would log a
    real visitor's user agent, creating the undisclosed personal-data store
    `docs/140` PART B refused to create.
  */
  const HUMANS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
    'curl/8.5.0',
  ];

  for (const agent of HUMANS) {
    it(`no match for "${agent.slice(0, 40)}…"`, () => {
      expect(identifyCrawler(agent)).toBeNull();
    });
  }

  it('an absent or empty user agent is not a crawler', () => {
    expect(identifyCrawler(null)).toBeNull();
    expect(identifyCrawler(undefined)).toBeNull();
    expect(identifyCrawler('')).toBeNull();
  });

  it('…and logCrawlerHit stays silent for all of them', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    for (const agent of [...HUMANS, null, undefined, '']) {
      expect(logCrawlerHit({ surface: 'og-card', subject: 's', userAgent: agent })).toBeNull();
    }
    expect(spy, 'a non-crawler produced a log line').not.toHaveBeenCalled();
  });

  it('…and DOES speak for a crawler, or the rule above is satisfied by silence', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const got = logCrawlerHit({
      surface: 'og-card',
      subject: 'keisha-wallace',
      userAgent: 'facebookexternalhit/1.1',
      version: '3',
    });
    expect(got).toBe('facebook');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('keisha-wallace');
  });
});

describe('the line is greppable and bounded', () => {
  it('carries the crawler, the surface and the subject', () => {
    const line = crawlerHitLine(
      { surface: 'og-card', subject: 'tuan-nguyen', userAgent: 'WhatsApp/2.23', version: '3' },
      'whatsapp',
    );
    expect(line.startsWith('[crawler] ')).toBe(true);
    expect(line).toContain('whatsapp');
    expect(line).toContain('og-card');
    expect(line).toContain('subject=tuan-nguyen');
    expect(line).toContain('v=3');
  });

  it('omits the version when there is none, rather than printing undefined', () => {
    const line = crawlerHitLine(
      { surface: 'og-page', subject: '(default)', userAgent: 'Twitterbot/1.0' },
      'twitter',
    );
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('v=');
  });

  it('truncates an over-long agent', () => {
    const line = crawlerHitLine(
      { surface: 'og-card', subject: 's', userAgent: `Googlebot/${'x'.repeat(500)}` },
      'google',
    );
    expect(line.length).toBeLessThan(MAX_LOGGED_AGENT_CHARS + 120);
  });
});

describe('⛔ no IP address is recorded, and the routes call this', () => {
  const MODULE = readFileSync(join(process.cwd(), 'src/lib/crawler-log.ts'), 'utf8');
  const code = MODULE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('the module never reads a client IP', () => {
    /*
      `docs/140` PART B refused to populate `actor_ip` across 27 admin routes
      because nothing displays it, nothing purges it, erasure never reaches it
      and `/privacy` discloses no IP collection. That reasoning binds harder on
      a public route than on an admin one.
    */
    for (const forbidden of ['getClientIp', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip']) {
      expect(code, `the crawler log reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('both OG routes log before they do any work', () => {
    for (const file of [
      'src/app/api/v1/og/campaign/[slug]/route.tsx',
      'src/app/api/v1/og/page/route.tsx',
    ]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src, `${file} does not call logCrawlerHit`).toContain('logCrawlerHit({');

      /*
        A crawler that fails midway is the interesting case, so the call has to
        come before the database read and the render - logging afterwards would
        drop exactly the requests worth seeing.
      */
      const callAt = src.indexOf('logCrawlerHit({');
      const renderAt = src.indexOf('new ImageResponse');
      expect(callAt, `${file} logs after it renders`).toBeLessThan(renderAt);
    }
  });
});
