import type { NormalizedNewsItem } from './gnews-client';

const FEMA_API_URL = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries';

type FemaDeclaration = {
  disasterNumber: number;
  declarationTitle: string;
  state: string;
  declarationType: string;
  declarationDate: string;
  incidentType: string;
  designatedArea: string;
  placeCode: string;
};

/**
 * Fetch recent FEMA disaster declarations (last 30 days, US only).
 *
 * THROWS on transport or HTTP failure. Until 2026-10-15 this caught everything
 * and returned `[]`, which made the "all news sources failed" critical alert in
 * `news-pipeline.ts` unreachable: the pipeline derives `allFailed` from
 * `Promise.allSettled` rejections, and a client that never rejects can never be
 * counted as failed. A total news blackout therefore surfaced as HTTP 200 with
 * severity 'info' and `fetched: 0`.
 *
 * An empty array still means "fetched successfully, nothing matched" - that
 * distinction is the whole point of throwing here.
 */
export async function fetchFemaDeclarations(): Promise<NormalizedNewsItem[]> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateFilter = thirtyDaysAgo.toISOString().split('T')[0];

  const params = new URLSearchParams({
    $filter: `declarationDate ge '${dateFilter}'`,
    $orderby: 'declarationDate desc',
    $top: '20',
  });

  try {
    const response = await fetch(`${FEMA_API_URL}?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`FEMA API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      DisasterDeclarationsSummaries?: FemaDeclaration[];
    };

    if (!data.DisasterDeclarationsSummaries) return [];

    // Deduplicate by disaster number (multiple counties per declaration)
    const seen = new Set<number>();
    const items: NormalizedNewsItem[] = [];

    for (const decl of data.DisasterDeclarationsSummaries) {
      if (seen.has(decl.disasterNumber)) continue;
      seen.add(decl.disasterNumber);

      items.push({
        title: decl.declarationTitle,
        url: `https://www.fema.gov/disaster/${decl.disasterNumber}`,
        summary: `${decl.incidentType} - ${decl.declarationType} declaration for ${decl.designatedArea}, ${decl.state}`,
        source: 'FEMA',
        publishedAt: new Date(decl.declarationDate),
        category: 'disaster',
      });
    }

    return items;
  } catch (error) {
    console.error('FEMA API fetch error:', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
