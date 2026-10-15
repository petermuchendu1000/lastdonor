import type { NormalizedNewsItem } from './gnews-client';

const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';

type NwsAlert = {
  id: string;
  properties: {
    headline: string;
    event: string;
    severity: string;
    certainty: string;
    areaDesc: string;
    description: string;
    onset: string;
    expires: string;
    '@id': string;
  };
};

const SEVERE_EVENTS = new Set([
  'Tornado Warning',
  'Tornado Watch',
  'Hurricane Warning',
  'Hurricane Watch',
  'Tropical Storm Warning',
  'Flash Flood Warning',
  'Flood Warning',
  'Severe Thunderstorm Warning',
  'Blizzard Warning',
  'Ice Storm Warning',
  'Winter Storm Warning',
  'Extreme Wind Warning',
  'Storm Surge Warning',
]);

/**
 * Fetch active severe weather alerts from NWS.
 *
 * THROWS on transport or HTTP failure, for the same reason as
 * `fetchFemaDeclarations` - see the note there. An empty array means "fetched
 * successfully, no severe events active", which is the common case and must
 * stay distinguishable from a dead source.
 */
export async function fetchWeatherAlerts(): Promise<NormalizedNewsItem[]> {
  try {
    const response = await fetch(NWS_ALERTS_URL, {
      headers: {
        'Accept': 'application/geo+json',
        'User-Agent': '(lastdonor.org, contact@lastdonor.org)',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`NWS API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      features?: NwsAlert[];
    };

    if (!data.features) return [];

    const items: NormalizedNewsItem[] = [];

    for (const feature of data.features) {
      const props = feature.properties;

      // Only include severe events
      if (!SEVERE_EVENTS.has(props.event)) continue;

      items.push({
        title: props.headline,
        url: props['@id'],
        summary: `${props.event} - ${props.areaDesc}. ${props.description?.slice(0, 300) ?? ''}`,
        source: 'NWS',
        publishedAt: props.onset ? new Date(props.onset) : null,
        category: 'disaster',
      });
    }

    return items;
  } catch (error) {
    console.error('NWS API fetch error:', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
