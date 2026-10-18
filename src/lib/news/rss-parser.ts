import type { NormalizedNewsItem } from './gnews-client';

type RssFeedConfig = {
  url: string;
  source: string;
};

/*
  Every feed below answered 200 with at least one item WHEN FETCHED FROM
  THE PRODUCTION MACHINE on 2026-10-18. That qualifier is the whole
  point of this comment.

  ── What was found ───────────────────────────────────────────────────

  Nothing had ever checked this list. `fetchRssFeed` returns `[]` on any
  failure and `fetchAllRssFeeds` settles and drops rejections, so a feed
  that has 404'd for years is indistinguishable from a feed with nothing
  new. In `fetch-rss` mode this list is the pipeline's entire reach.

  Measured over all 125 configured feeds from inside the Fly machine:
  **72 live, 5 answering 200 with zero items, 48 dead.** Both wire
  services were gone - `feeds.reuters.com` does not resolve (NXDOMAIN)
  and `feeds.apnews.com` has no A record - and ALL FIVE first-responder
  feeds were dead, in a category the platform runs campaigns for.

  ── Measure the path the actual calls take (docs/66) ─────────────────

  The same probe run from the development sandbox reported 49 live and
  72 dead. The difference is not the feeds: BBC, The Guardian, the New
  York Times and the LA Times answer 403 to the sandbox's egress proxy
  and 200 to Fly. A feed list verified from a laptop would have deleted
  nine working feeds. Only the production result is used here.

  ── A negative result worth keeping ──────────────────────────────────

  The 403s were tested against a full browser `User-Agent`, `Accept` and
  `Accept-Language` as well as the bot UA below. Identical in every
  case. The blocking is at the IP/ASN level, not the header, so there is
  nothing to gain by disguising the crawler - and we would not.

  ── Feeds deliberately NOT removed ───────────────────────────────────

  A hard, repeatable failure (404, 403, 402, 406, or 200 with no items)
  is treated as dead and the entry is replaced or dropped. A timeout,
  429, 502 or 503 is treated as transient and kept; `fetchAllRssFeeds`
  now reports per-feed health so a "transient" failure that persists
  shows up instead of being swallowed for another four years.
*/
export const RSS_FEEDS: RssFeedConfig[] = [
  // ─── Wire Services & Global ─────────────────────────────────────
  // AP (`feeds.apnews.com`) and Reuters (`feeds.reuters.com`) were
  // removed: neither hostname resolves any more. No public RSS endpoint
  // for either could be found that returns articles; the only route to
  // AP is Google News RSS, rejected in docs/90 because its links are
  // opaque `news.google.com` tokens the body fetcher cannot follow.
  { url: 'https://rss.upi.com/news/top_news.rss', source: 'UPI' },

  // ─── US · Military / Veterans ───────────────────────────────────
  { url: 'https://www.dvidshub.net/rss/news', source: 'DVIDS' },
  { url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945', source: 'Defense.gov' },
  { url: 'https://www.militarytimes.com/arc/outboundfeeds/rss/', source: 'Military Times' },
  { url: 'https://www.armytimes.com/arc/outboundfeeds/rss/', source: 'Army Times' },
  { url: 'https://www.navytimes.com/arc/outboundfeeds/rss/', source: 'Navy Times' },
  { url: 'https://taskandpurpose.com/feed/', source: 'Task & Purpose' },
  { url: 'https://news.va.gov/feed/', source: 'VA News' },

  // ─── US · First Responders ──────────────────────────────────────
  // All five configured feeds here were dead. Lexipol retired the RSS
  // endpoints for Police1, FireRescue1, EMS1 and Firehouse (404 on every
  // path tried), so the category is now carried by ODMP's current feed,
  // USFA, and two line-of-duty-death organisations.
  { url: 'https://www.odmp.org/feed', source: 'ODMP' },
  { url: 'https://apps.usfa.fema.gov/firefighter-fatalities/api/fatalityDatums/feed', source: 'USFA' },
  { url: 'https://www.firefighterclosecalls.com/feed/', source: 'Firefighter Close Calls' },
  { url: 'https://www.firehero.org/feed/', source: 'National Fallen Firefighters Foundation' },

  // ─── US · National News ─────────────────────────────────────────
  { url: 'https://feeds.npr.org/1001/rss.xml', source: 'NPR' },
  { url: 'https://feeds.npr.org/1003/rss.xml', source: 'NPR National' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml', source: 'NY Times US' },
  { url: 'https://feeds.washingtonpost.com/rss/national', source: 'Washington Post' },
  { url: 'https://www.latimes.com/california/rss2.0.xml', source: 'LA Times' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', source: 'NY Times' },
  { url: 'https://feeds.abcnews.com/abcnews/topstories', source: 'ABC News' },
  { url: 'https://www.cbsnews.com/latest/rss/main', source: 'CBS News' },
  { url: 'https://feeds.nbcnews.com/nbcnews/public/news', source: 'NBC News' },
  { url: 'https://www.pbs.org/newshour/feeds/rss/headlines', source: 'PBS NewsHour' },
  // USA Today removed: 402 Payment Required (Gannett closed its `arcio`
  // feeds behind the paywall), as did the Arizona Republic and the
  // Detroit News on the same platform.

  // ─── US · Regional ──────────────────────────────────────────────
  // Nine regional feeds were dropped as hard failures: Chicago Tribune
  // and Denver Post (403), Houston Chronicle, Dallas Morning News,
  // Atlanta Journal-Constitution and SF Chronicle (404), Seattle Times
  // (202 with no body), and the two Gannett 402s above. Miami Herald
  // and Kansas City Star timed out rather than refusing, so they stay.
  { url: 'https://www.miamiherald.com/latest-news/index.rss', source: 'Miami Herald' },
  { url: 'https://www.bostonglobe.com/rss/bigpicture', source: 'Boston Globe' },
  { url: 'https://www.startribune.com/local/index.rss2', source: 'Star Tribune' },
  { url: 'https://www.kansascity.com/latest-news/index.rss', source: 'Kansas City Star' },
  { url: 'https://www.oregonlive.com/arc/outboundfeeds/rss/', source: 'The Oregonian' },
  { url: 'https://www.phillymag.com/feed/', source: 'Philadelphia Magazine' },

  // ─── Canada ─────────────────────────────────────────────────────
  { url: 'https://www.cbc.ca/webfeed/rss/rss-topstories', source: 'CBC News' },
  { url: 'https://www.cbc.ca/cmlink/rss-world', source: 'CBC World' },
  { url: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/', source: 'Globe and Mail' },
  { url: 'https://nationalpost.com/feed', source: 'National Post' },
  { url: 'https://globalnews.ca/feed/', source: 'Global News Canada' },

  // ─── UK & Ireland ───────────────────────────────────────────────
  { url: 'https://feeds.bbci.co.uk/news/rss.xml', source: 'BBC News' },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World' },
  { url: 'https://feeds.bbci.co.uk/news/uk/rss.xml', source: 'BBC UK' },
  { url: 'https://www.theguardian.com/world/rss', source: 'The Guardian World' },
  { url: 'https://www.theguardian.com/uk/rss', source: 'The Guardian UK' },
  { url: 'https://www.theguardian.com/society/rss', source: 'The Guardian Society' },
  { url: 'https://feeds.skynews.com/feeds/rss/home.xml', source: 'Sky News' },
  { url: 'https://www.independent.co.uk/news/world/rss', source: 'The Independent' },
  { url: 'https://www.telegraph.co.uk/rss.xml', source: 'The Telegraph' },
  { url: 'https://www.irishmirror.ie/news/?service=rss', source: 'Irish Mirror' },
  { url: 'https://www.rte.ie/news/rss/news-headlines.xml', source: 'RTÉ News' },

  // ─── Europe ─────────────────────────────────────────────────────
  // `www.dw.com/rss/...` answers 200 with an empty document; the live
  // feeds are on `rss.dw.com`.
  { url: 'https://rss.dw.com/rdf/rss-en-all', source: 'DW News' },
  { url: 'https://rss.dw.com/rdf/rss-en-eu', source: 'DW Europe' },
  { url: 'https://www.france24.com/en/rss', source: 'France 24' },
  { url: 'https://www.euronews.com/rss', source: 'Euronews' },
  { url: 'https://www.thelocal.de/feed', source: 'The Local Germany' },
  { url: 'https://www.thelocal.fr/feed', source: 'The Local France' },
  { url: 'https://www.thelocal.it/feed', source: 'The Local Italy' },
  { url: 'https://www.thelocal.es/feed', source: 'The Local Spain' },
  { url: 'https://www.thelocal.se/feed', source: 'The Local Sweden' },
  { url: 'https://www.thelocal.no/feed', source: 'The Local Norway' },
  { url: 'https://www.dutchnews.nl/feed/', source: 'DutchNews' },

  // ─── Asia-Pacific ───────────────────────────────────────────────
  { url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', source: 'Channel News Asia' },
  { url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/', source: 'NHK World' },
  { url: 'https://www.scmp.com/rss/91/feed', source: 'South China Morning Post' },
  { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', source: 'Times of India' },
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss', source: 'The Hindu' },
  { url: 'https://feeds.feedburner.com/ndtvnews-top-stories', source: 'NDTV' },
  { url: 'https://www.straitstimes.com/news/asia/rss.xml', source: 'Straits Times' },
  { url: 'https://www.bangkokpost.com/rss/data/topstories.xml', source: 'Bangkok Post' },
  { url: 'https://www.japantimes.co.jp/feed/', source: 'Japan Times' },
  { url: 'https://www.rappler.com/feed/', source: 'Rappler Philippines' },
  { url: 'https://en.vietnamplus.vn/rss/home.rss', source: 'VietnamPlus' },
  { url: 'https://www.dawn.com/feeds/home', source: 'Dawn Pakistan' },
  { url: 'https://www.thedailystar.net/frontpage/rss.xml', source: 'Daily Star Bangladesh' },

  // ─── Oceania ────────────────────────────────────────────────────
  { url: 'https://www.abc.net.au/news/feed/2942460/rss.xml', source: 'ABC Australia' },
  { url: 'https://www.abc.net.au/news/feed/51120/rss.xml', source: 'ABC Australia Top' },
  { url: 'https://www.sbs.com.au/news/feed', source: 'SBS News' },
  { url: 'https://www.smh.com.au/rss/feed.xml', source: 'Sydney Morning Herald' },
  { url: 'https://www.stuff.co.nz/rss', source: 'Stuff NZ' },
  { url: 'https://www.rnz.co.nz/rss/national.xml', source: 'RNZ' },

  // ─── Middle East ────────────────────────────────────────────────
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera' },
  { url: 'https://www.middleeasteye.net/rss', source: 'Middle East Eye' },
  { url: 'https://www.arabnews.com/rss.xml', source: 'Arab News' },
  { url: 'https://www.timesofisrael.com/feed/', source: 'Times of Israel' },
  { url: 'https://www.dailysabah.com/rssFeed/world', source: 'Daily Sabah' },

  // ─── Africa ─────────────────────────────────────────────────────
  // The thinnest region before this pass: four of ten dead and a fifth
  // answering 200 with nothing. It also happens to be the region no
  // keyword news API we looked at covers - GNews's `country` parameter
  // accepts 37 values and Egypt is the only African one (docs/90).
  { url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', source: 'AllAfrica' },
  { url: 'https://feeds.capi24.com/v1/Search/articles/news24/TopStories/rss', source: 'News24 South Africa' },
  { url: 'https://www.iol.co.za/rss', source: 'IOL South Africa' },
  { url: 'https://nation.africa/kenya/rss.xml', source: 'Daily Nation Kenya' },
  { url: 'https://www.standardmedia.co.ke/rss/headlines.php', source: 'The Standard Kenya' },
  { url: 'https://punchng.com/feed/', source: 'Punch Nigeria' },
  { url: 'https://www.vanguardngr.com/feed/', source: 'Vanguard Nigeria' },
  { url: 'https://www.premiumtimesng.com/feed', source: 'Premium Times Nigeria' },
  { url: 'https://www.monitor.co.ug/rss.xml', source: 'Daily Monitor Uganda' },
  { url: 'https://www.thecitizen.co.tz/rss.xml', source: 'The Citizen Tanzania' },
  { url: 'https://www.myjoyonline.com/feed/', source: 'Joy Online Ghana' },

  // ─── Latin America & Caribbean ──────────────────────────────────
  { url: 'https://www.batimes.com.ar/feed', source: 'Buenos Aires Times' },
  { url: 'https://ticotimes.net/feed', source: 'Tico Times' },
  { url: 'https://www.jamaicaobserver.com/feed/', source: 'Jamaica Observer' },
  { url: 'https://trinidadexpress.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc', source: 'Trinidad Express' },
  { url: 'https://mexiconewsdaily.com/feed/', source: 'Mexico News Daily' },

  // ─── Humanitarian / Disaster / Relief ───────────────────────────
  // Eight of the thirteen configured here were dead. UNICEF, ICRC, the
  // IRC and Global Citizen 404 on every path tried; UNHCR and Devex 403
  // at the IP level; ReliefWeb answers 406 to every Accept header
  // offered, including `application/rss+xml`. WHO's feed had moved.
  { url: 'https://www.who.int/rss-feeds/news-english.xml', source: 'WHO News' },
  { url: 'https://www.thenewhumanitarian.org/rss.xml', source: 'The New Humanitarian' },
  { url: 'https://www.ifrc.org/rss.xml', source: 'IFRC' },
  { url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', source: 'UN News' },
  { url: 'https://www.undispatch.com/feed/', source: 'UN Dispatch' },
  { url: 'https://www.gofundme.com/c/feed', source: 'GoFundMe Stories' },
];

/**
 * Parse an RSS/Atom XML feed into normalized news items.
 * Uses native DOMParser-style parsing (regex-based for Node.js without heavy XML deps).
 */
export async function fetchRssFeed(config: RssFeedConfig): Promise<NormalizedNewsItem[]> {
  return (await fetchRssFeedWithOutcome(config)).items;
}

/** What one feed did on one run. */
export type FeedOutcome = {
  source: string;
  url: string;
  /** HTTP status, or 0 when the request never completed. */
  status: number;
  items: number;
  /** `ok` only when the feed answered 200 AND yielded at least one item. */
  verdict: 'ok' | 'empty' | 'http-error' | 'transport-error';
  detail?: string;
};

/**
 * As `fetchRssFeed`, but says what happened.
 *
 * The silent-`[]` version above is what let 48 of 125 feeds die
 * unnoticed (see the comment on `RSS_FEEDS`). A caller that wants to
 * know uses this one.
 */
export async function fetchRssFeedWithOutcome(
  config: RssFeedConfig,
): Promise<{ items: NormalizedNewsItem[]; outcome: FeedOutcome }> {
  const base = { source: config.source, url: config.url };
  try {
    const response = await fetch(config.url, {
      headers: { 'User-Agent': 'LastDonor.org News Aggregator' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`RSS fetch failed for ${config.source}: ${response.status}`);
      return {
        items: [],
        outcome: { ...base, status: response.status, items: 0, verdict: 'http-error' },
      };
    }

    const xml = await response.text();
    const items = parseRssXml(xml, config.source);
    return {
      items,
      outcome: {
        ...base,
        status: 200,
        items: items.length,
        verdict: items.length > 0 ? 'ok' : 'empty',
      },
    };
  } catch (error) {
    console.error(`RSS fetch error for ${config.source}:`, error);
    return {
      items: [],
      outcome: {
        ...base,
        status: 0,
        items: 0,
        verdict: 'transport-error',
        detail: String(error).slice(0, 120),
      },
    };
  }
}

/**
 * Parse RSS/Atom XML into normalized items using regex.
 * Handles both RSS 2.0 (<item>) and Atom (<entry>) formats.
 */
function parseRssXml(xml: string, source: string): NormalizedNewsItem[] {
  const items: NormalizedNewsItem[] = [];

  // Try RSS 2.0 format first
  const rssItemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = rssItemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTagContent(itemXml, 'title');
    const link = extractTagContent(itemXml, 'link') ?? extractAttr(itemXml, 'link', 'href');
    const description = extractTagContent(itemXml, 'description');
    const pubDate = extractTagContent(itemXml, 'pubDate');
    const imageUrl = extractImageUrl(itemXml);

    if (title && link) {
      items.push({
        title: decodeXmlEntities(title),
        url: link.trim(),
        summary: description ? decodeXmlEntities(stripHtml(description)).slice(0, 500) : '',
        source,
        publishedAt: pubDate ? new Date(pubDate) : null,
        imageUrl,
      });
    }
  }

  // If no RSS items found, try Atom format
  if (items.length === 0) {
    const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((match = atomEntryRegex.exec(xml)) !== null) {
      const entryXml = match[1];
      const title = extractTagContent(entryXml, 'title');
      const link = extractAttr(entryXml, 'link', 'href');
      const summary = extractTagContent(entryXml, 'summary') ?? extractTagContent(entryXml, 'content');
      const updated = extractTagContent(entryXml, 'updated') ?? extractTagContent(entryXml, 'published');

      if (title && link) {
        const imageUrl = extractImageUrl(entryXml);
        items.push({
          title: decodeXmlEntities(title),
          url: link.trim(),
          summary: summary ? decodeXmlEntities(stripHtml(summary)).slice(0, 500) : '',
          source,
          publishedAt: updated ? new Date(updated) : null,
          imageUrl,
        });
      }
    }
  }

  return items;
}

function extractTagContent(xml: string, tag: string): string | null {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1];

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = regex.exec(xml);
  return match?.[1] ?? null;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i');
  const match = regex.exec(xml);
  return match?.[1] ?? null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Extract image URL from RSS/Atom item XML.
 * Checks <enclosure>, <media:content>, <media:thumbnail>, and inline <img> tags.
 */
function extractImageUrl(xml: string): string | undefined {
  // <enclosure url="..." type="image/...">
  const enclosureMatch = /<enclosure[^>]+url="([^"]+)"[^>]*type="image\/[^"]*"/i.exec(xml)
    ?? /<enclosure[^>]+type="image\/[^"]*"[^>]*url="([^"]+)"/i.exec(xml);
  if (enclosureMatch) return enclosureMatch[1];

  // <media:content url="...">
  const mediaMatch = /<media:content[^>]+url="([^"]+)"/i.exec(xml);
  if (mediaMatch) return mediaMatch[1];

  // <media:thumbnail url="...">
  const thumbMatch = /<media:thumbnail[^>]+url="([^"]+)"/i.exec(xml);
  if (thumbMatch) return thumbMatch[1];

  // Inline <img> in description/content
  const imgMatch = /<img[^>]+src="(https?:\/\/[^"]+)"/i.exec(xml);
  if (imgMatch) return imgMatch[1];

  return undefined;
}

/**
 * Fetch all configured RSS feeds in parallel.
 */
/** Max items to keep per individual RSS feed to prevent any single source from dominating */
const MAX_ITEMS_PER_FEED = 25;

export async function fetchAllRssFeeds(): Promise<NormalizedNewsItem[]> {
  return (await fetchAllRssFeedsWithHealth()).items;
}

/** Per-run roll-up of which feeds answered and which did not. */
export type FeedHealth = {
  total: number;
  ok: number;
  /** Everything that is not `ok`: empty, HTTP error, or transport error. */
  failing: FeedOutcome[];
};

/**
 * Fetch every configured feed and report what each one did.
 *
 * The health half is not decoration. This list IS the pipeline's reach
 * in `fetch-rss` mode, and until 2026-10-18 nothing had ever looked at
 * it: 48 of 125 feeds were dead, including both wire services and every
 * feed in the first-responders category. The failures were invisible
 * because they are indistinguishable, by return value, from a feed with
 * no new items.
 */
export async function fetchAllRssFeedsWithHealth(): Promise<{
  items: NormalizedNewsItem[];
  health: FeedHealth;
}> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map((config) => fetchRssFeedWithOutcome(config)),
  );

  const items: NormalizedNewsItem[] = [];
  const failing: FeedOutcome[] = [];
  let ok = 0;

  for (const [i, result] of results.entries()) {
    if (result.status !== 'fulfilled') {
      // `fetchRssFeedWithOutcome` catches its own errors, so this is a
      // bug rather than a dead feed - but it must not be silent either.
      failing.push({
        source: RSS_FEEDS[i].source,
        url: RSS_FEEDS[i].url,
        status: 0,
        items: 0,
        verdict: 'transport-error',
        detail: String(result.reason).slice(0, 120),
      });
      continue;
    }

    if (result.value.outcome.verdict === 'ok') ok++;
    else failing.push(result.value.outcome);

    // Cap per feed - keep the most recent items
    const feedItems = result.value.items
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
      .slice(0, MAX_ITEMS_PER_FEED);
    items.push(...feedItems);
  }

  return { items, health: { total: RSS_FEEDS.length, ok, failing } };
}
