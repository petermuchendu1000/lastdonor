/**
 * Recording that a link-preview crawler actually reached us.
 *
 * ── THE QUESTION THIS EXISTS TO ANSWER ──────────────────────────────────────
 *
 * A campaign shared into WhatsApp rendered no card - bare domain, the URL as
 * the description, no image - while every measurable property of the response
 * was correct: tags in `<head>` at byte 5,627 (Meta's limit is 1 MB), gzip and
 * deflate both honoured (Meta requires both), TTFB under one second against a
 * ~10s budget, `Range` ignored, identical output to four crawler user agents
 * and to none, A+ TLS on both the IPv4 and IPv6 endpoints, and the card itself
 * 200 `image/jpeg` in 0.69s cold.
 *
 * Thirteen hypotheses were measured and every one was refuted, which left one
 * question that **no measurement from outside can answer**:
 *
 *   did Meta fetch us and reject what it got, or did it never fetch us at all?
 *
 * [VERIFIED] production keeps no access log - `flyctl logs` carries none, and
 * `docs/142` established the same thing with its own probe's user agent absent
 * as the control. So the two cases are indistinguishable, which is exactly the
 * shape `docs/123` paid for: a silent path cannot be told from one that never
 * ran.
 *
 * ── WHAT THIS OBSERVES, AND WHAT IT CANNOT ──────────────────────────────────
 *
 * ⚠️ This sees the **card fetch**, not the page fetch, and the difference is
 * load-bearing when you read the output:
 *
 *   a line appears  -> the crawler read our HTML, parsed `og:image`, and came
 *                      back for the bytes. Everything up to rendering works.
 *   no line at all  -> it never got that far. Either it never fetched the page,
 *                      or it fetched and extracted nothing.
 *
 * ⛔ The PAGE cannot be observed without a regression, and that was checked
 * rather than assumed. `/campaigns/[slug]` is ISR (`revalidate = 60`), so its
 * server component does not run per request and cannot log one. The only
 * per-request hook above it is the middleware - and `middleware.ts` is wrapped
 * in `auth()` and calls `checkRateLimitAsync` as its first statement, so adding
 * `/campaigns/:path*` to its matcher would put a session decode **and rate
 * limiting** on the busiest public route. `docs/169` records that no public
 * page is rate limited today. A log line is not worth that.
 *
 * ── NO PERSONAL DATA, BY CONSTRUCTION ───────────────────────────────────────
 *
 * ⛔ No IP address is recorded, ever. `docs/140` PART B refused to fill
 * `actor_ip` across 27 admin routes precisely because nothing displays it,
 * nothing purges it, erasure never reaches it and `/privacy` discloses no IP
 * collection - filling it would have created this project's first store of
 * undisclosed, never-purged personal data. That reasoning applies here with
 * more force, on a public route.
 *
 * And the user agent is only ever written when `identifyCrawler` has already
 * matched a known BOT. A human's user agent is never logged, because a human's
 * request produces no line at all - the function answers `null` and the caller
 * returns. That is a property of the control flow, not a promise in a comment.
 *
 * ⚠️ A user agent is a free-text header, so a line here is a CLAIM that the
 * caller was that crawler, never proof. Meta publishes no IP list for
 * `facebookexternalhit` to check it against. Read it as evidence of a fetch,
 * not as attribution.
 *
 * ── WHY `console` AND NOT AN AUDIT ROW ──────────────────────────────────────
 *
 * This is a diagnostic for a question being actively investigated, not a
 * permanent record. An `audit_logs` row per hit would put an unbounded write on
 * a public route that a crawler can call as often as it likes, and `docs/87`
 * caps an entry point at three concurrent queries. The Fly log is readable
 * (it answered twice while this was being diagnosed) and costs nothing.
 */

/** A crawler we can recognise, newest-question-first. */
export interface CrawlerMatch {
  /** Stable name to group by when reading the log. */
  readonly name: string;
  /** Substring looked for in the user agent, compared case-insensitively. */
  readonly token: string;
}

/**
 * Ordered because the first match wins and some agents carry two names.
 *
 * ⚠️ WhatsApp sends BOTH its own `WhatsApp/<version>` string and
 * `facebookexternalhit/1.1` depending on the surface, so `whatsapp` is checked
 * first: a request carrying both is more specifically WhatsApp, and conflating
 * them is what makes the log unable to answer the question it was built for.
 *
 * ⛔ AND THE SAME TRAP CAUGHT A SECOND PAIR, which is why the real agent
 * strings are in the test rather than invented ones. Telegram identifies
 * itself as **`TelegramBot (like TwitterBot)`** - it contains the word
 * `twitterbot` - so with `twitter` checked first every Telegram fetch was
 * recorded as Twitter. A substring matcher is an ORDERED matcher whether or
 * not its author meant it to be; the more specific token goes above the one it
 * contains.
 */
export const KNOWN_CRAWLERS: readonly CrawlerMatch[] = [
  // The question that prompted this file.
  { name: 'whatsapp', token: 'whatsapp' },
  { name: 'facebook', token: 'facebookexternalhit' },
  { name: 'facebook', token: 'facebot' },
  // Other link-preview surfaces, so a comparison is possible.
  // ⛔ `telegram` MUST stay above `twitter`: see the note above.
  { name: 'telegram', token: 'telegrambot' },
  { name: 'twitter', token: 'twitterbot' },
  { name: 'linkedin', token: 'linkedinbot' },
  { name: 'slack', token: 'slackbot' },
  { name: 'slack', token: 'slack-imgproxy' },
  { name: 'discord', token: 'discordbot' },
  { name: 'skype', token: 'skypeuripreview' },
  { name: 'apple', token: 'applebot' },
  { name: 'reddit', token: 'redditbot' },
  { name: 'pinterest', token: 'pinterest' },
  // Search and AI fetchers, which also read the card.
  { name: 'google', token: 'googlebot' },
  { name: 'bing', token: 'bingbot' },
  { name: 'duckduckgo', token: 'duckduckbot' },
  { name: 'yandex', token: 'yandexbot' },
  { name: 'openai', token: 'gptbot' },
  { name: 'openai', token: 'oai-searchbot' },
  { name: 'openai', token: 'chatgpt-user' },
  { name: 'anthropic', token: 'claudebot' },
  { name: 'perplexity', token: 'perplexitybot' },
  { name: 'meta-ai', token: 'meta-externalagent' },
] as const;

/**
 * The crawler name for a user agent, or `null` for anything unrecognised.
 *
 * ⛔ Answering `null` for a human is what keeps this free of personal data:
 * the caller logs nothing at all in that case, so no ordinary visitor's user
 * agent is ever written.
 */
export function identifyCrawler(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return null;
  for (const crawler of KNOWN_CRAWLERS) {
    if (ua.includes(crawler.token)) return crawler.name;
  }
  return null;
}

/** Keeps one oddly long agent string from dominating a log line. */
export const MAX_LOGGED_AGENT_CHARS = 120;

export interface CrawlerHit {
  /** What was fetched, e.g. `og-card`. */
  readonly surface: string;
  /** The campaign or page it was fetched for. */
  readonly subject: string;
  /** The raw `user-agent` header. */
  readonly userAgent: string | null | undefined;
  /** Card version requested, when the caller has one. */
  readonly version?: string | null;
}

/**
 * Builds the log line, separately from writing it, so a test can read it
 * without capturing `console`.
 */
export function crawlerHitLine(hit: CrawlerHit, crawler: string): string {
  const agent = (hit.userAgent ?? '').slice(0, MAX_LOGGED_AGENT_CHARS);
  const version = hit.version ? ` v=${hit.version}` : '';
  return `[crawler] ${crawler} ${hit.surface} subject=${hit.subject}${version} ua="${agent}"`;
}

/**
 * Writes one line if - and only if - the caller is a recognised crawler.
 *
 * Returns the crawler name when it logged, so a caller or a test can tell a
 * recognised fetch from an ordinary one without reading `console`.
 */
export function logCrawlerHit(hit: CrawlerHit): string | null {
  const crawler = identifyCrawler(hit.userAgent);
  if (!crawler) return null;
  console.info(crawlerHitLine(hit, crawler));
  return crawler;
}
