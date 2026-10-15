/**
 * FEMA and NWS clients must SIGNAL failure, not swallow it.
 *
 * `news-pipeline.ts` decides whether a news blackout happened from
 * `Promise.allSettled` rejections. Both of these clients used to `catch`
 * everything and `return []`, so they could never be counted as failed and the
 * `pipeline.all_sources_failed` critical audit row was unreachable code.
 *
 * The distinction these tests pin down: `[]` means "fetched fine, nothing
 * matched" (the common case for NWS — no severe weather active), while a
 * transport error or a non-2xx response means "this source is down".
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchFemaDeclarations } from './fema-client';
import { fetchWeatherAlerts } from './weather-alerts';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('news source failure signalling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchFemaDeclarations', () => {
    it('rejects when the network is unreachable', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENETDOWN')) as never;

      await expect(fetchFemaDeclarations()).rejects.toThrow('ENETDOWN');
    });

    it('rejects on a non-2xx response rather than returning []', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, 503)) as never;

      await expect(fetchFemaDeclarations()).rejects.toThrow(/503/);
    });

    it('still returns [] when the fetch succeeds with no declarations', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(jsonResponse({ DisasterDeclarationsSummaries: [] })) as never;

      await expect(fetchFemaDeclarations()).resolves.toEqual([]);
    });

    it('normalises declarations on success, deduplicating by disaster number', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({
          DisasterDeclarationsSummaries: [
            {
              disasterNumber: 4001,
              declarationTitle: 'SEVERE STORM',
              state: 'IA',
              declarationType: 'DR',
              declarationDate: '2026-10-01',
              incidentType: 'Severe Storm',
              designatedArea: 'Linn County',
              placeCode: '99113',
            },
            {
              disasterNumber: 4001,
              declarationTitle: 'SEVERE STORM',
              state: 'IA',
              declarationType: 'DR',
              declarationDate: '2026-10-01',
              incidentType: 'Severe Storm',
              designatedArea: 'Johnson County',
              placeCode: '99103',
            },
          ],
        }),
      ) as never;

      const items = await fetchFemaDeclarations();
      expect(items).toHaveLength(1);
      expect(items[0].source).toBe('FEMA');
    });
  });

  describe('fetchWeatherAlerts', () => {
    it('rejects when the network is unreachable', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENETDOWN')) as never;

      await expect(fetchWeatherAlerts()).rejects.toThrow('ENETDOWN');
    });

    it('rejects on a non-2xx response rather than returning []', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, 500)) as never;

      await expect(fetchWeatherAlerts()).rejects.toThrow(/500/);
    });

    it('still returns [] when no severe events are active', async () => {
      // The ordinary case: NWS answered, nothing on the severe list.
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({
          features: [
            {
              id: 'a',
              properties: {
                headline: 'Dense Fog Advisory',
                event: 'Dense Fog Advisory',
                severity: 'Minor',
                certainty: 'Likely',
                areaDesc: 'Somewhere',
                description: 'Fog.',
                onset: '2026-10-15T00:00:00Z',
                expires: '2026-10-15T12:00:00Z',
                '@id': 'https://api.weather.gov/alerts/a',
              },
            },
          ],
        }),
      ) as never;

      await expect(fetchWeatherAlerts()).resolves.toEqual([]);
    });

    it('returns severe events on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({
          features: [
            {
              id: 'b',
              properties: {
                headline: 'Tornado Warning issued',
                event: 'Tornado Warning',
                severity: 'Extreme',
                certainty: 'Observed',
                areaDesc: 'Linn County, IA',
                description: 'Take shelter.',
                onset: '2026-10-15T00:00:00Z',
                expires: '2026-10-15T01:00:00Z',
                '@id': 'https://api.weather.gov/alerts/b',
              },
            },
          ],
        }),
      ) as never;

      const items = await fetchWeatherAlerts();
      expect(items).toHaveLength(1);
      expect(items[0].source).toBe('NWS');
    });
  });
});
