'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { DonorScoreBadge } from '@/components/admin/DonorScoreBadge';
import { formatMoney } from '@/lib/money/format';
import type { CurrencyTotal } from '@/lib/admin/donation-totals.server';
import { formatDate } from '@/lib/utils/dates';

interface SegmentDonor {
  id: string;
  name: string | null;
  email: string;
  donorType: string;
  /**
   * What this donor has given, PER CURRENCY.
   *
   * ⛔ Was a currency-blind `totalDonated` (`users.total_donated` for
   * registered donors, `SUM(d.amount)` by email for guests) printed with a
   * dollar sign (`docs/92`).
   */
  totalsByCurrency: CurrencyTotal[];
  lastDonationAt: string | null;
  donorScore: number;
  tags: string[];
  createdAt: string;
  source?: 'registered' | 'guest';
}

interface SegmentResult {
  donors: SegmentDonor[];
  total: number;
}

interface SegmentCard {
  key: string;
  label: string;
  description: string;
}

const SEGMENTS: SegmentCard[] = [
  { key: 'champions', label: 'Champions', description: 'Score 81+' },
  { key: 'major_donors', label: 'Major Donors', description: '$500+ lifetime' },
  { key: 'recurring', label: 'Recurring', description: 'Active recurring donors' },
  { key: 'new_donors', label: 'New Donors', description: 'Joined < 30 days' },
  { key: 'at_risk', label: 'At Risk', description: '6-12 months inactive' },
  { key: 'lapsed', label: 'Lapsed', description: '12+ months inactive' },
];

const PAGE_SIZE = 25;

export function DonorSegmentation() {
  const [activeSegment, setActiveSegment] = useState<string | null>(null);
  const [result, setResult] = useState<SegmentResult | null>(null);
  const [segmentCounts, setSegmentCounts] = useState<Record<string, number>>({});
  const [, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  // Custom filter state
  const [customMode, setCustomMode] = useState(false);
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [minDonated, setMinDonated] = useState('');
  const [maxDonated, setMaxDonated] = useState('');
  const [donorType, setDonorType] = useState('all');
  const [tag, setTag] = useState('');
  const [search, setSearch] = useState('');

  // Load counts for all segments on mount
  useEffect(() => {
    const controller = new AbortController();
    async function loadCounts() {
      const counts: Record<string, number> = {};
      await Promise.all(
        SEGMENTS.map(async (seg) => {
          try {
            const res = await fetch(`/api/v1/admin/donors/segments?segment=${seg.key}&limit=1`, { signal: controller.signal });
            const json = await res.json();
            if (json.ok) counts[seg.key] = json.data.total;
          } catch { /* ignore */ }
        }),
      );
      if (!controller.signal.aborted) setSegmentCounts(counts);
    }
    loadCounts();
    return () => controller.abort();
  }, []);

  const fetchSegment = useCallback(async (params: URLSearchParams) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/donors/segments?${params.toString()}`);
      const json = await res.json();
      if (json.ok) setResult(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSegmentClick(segmentKey: string) {
    setCustomMode(false);
    setActiveSegment(segmentKey);
    setOffset(0);
    const params = new URLSearchParams({ segment: segmentKey, limit: String(PAGE_SIZE), offset: '0' });
    fetchSegment(params);
  }

  function handleCustomSearch() {
    setCustomMode(true);
    setActiveSegment(null);
    setOffset(0);
    const params = buildCustomParams(0);
    fetchSegment(params);
  }

  function buildCustomParams(pageOffset: number): URLSearchParams {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageOffset) });
    if (minScore) params.set('minScore', minScore);
    if (maxScore) params.set('maxScore', maxScore);
    if (minDonated) params.set('minDonated', String(Math.round(Number(minDonated) * 100)));
    if (maxDonated) params.set('maxDonated', String(Math.round(Number(maxDonated) * 100)));
    if (donorType !== 'all') params.set('donorType', donorType);
    if (tag) params.set('tag', tag);
    if (search) params.set('search', search);
    return params;
  }

  function handlePageChange(newOffset: number) {
    setOffset(newOffset);
    if (customMode) {
      fetchSegment(buildCustomParams(newOffset));
    } else if (activeSegment) {
      const params = new URLSearchParams({
        segment: activeSegment,
        limit: String(PAGE_SIZE),
        offset: String(newOffset),
      });
      fetchSegment(params);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Donor CRM</h2>
        <p className="text-sm text-muted-foreground">
          Segment donors, view engagement scores, and manage your donor pipeline.
        </p>
      </div>

      {/* Predefined segment cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SEGMENTS.map((seg) => {
          const isActive = activeSegment === seg.key && !customMode;
          return (
            <button
              key={seg.key}
              type="button"
              onClick={() => handleSegmentClick(seg.key)}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                isActive ? 'border-foreground/30 bg-muted/40' : 'hover:bg-muted/30'
              }`}
            >
              <div>
                <p className="text-sm font-medium">{seg.label}</p>
                <p className="text-xs text-muted-foreground">{seg.description}</p>
              </div>
              <span className="text-2xl font-semibold tabular-nums">
                {segmentCounts[seg.key] ?? '-'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Custom filters */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <p className="text-xs font-medium text-muted-foreground">Custom Filters</p>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label>Search (name/email)</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search donors..."
              />
            </div>
            <div>
              <Label>Donor Type</Label>
              <Select value={donorType} onValueChange={setDonorType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="corporate">Corporate</SelectItem>
                  <SelectItem value="foundation">Foundation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tag</Label>
              <Input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="e.g. vip"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Min Score</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(e) => setMinScore(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Max Score</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                  placeholder="100"
                />
              </div>
            </div>
            <div>
              <Label>Min Donated ($)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={minDonated}
                onChange={(e) => setMinDonated(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Max Donated ($)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={maxDonated}
                onChange={(e) => setMaxDonated(e.target.value)}
                placeholder="No limit"
              />
            </div>
          </div>
          <Button onClick={handleCustomSearch} size="sm">
            Apply Filters
          </Button>
        </div>
      </div>

      {/* Results table */}
      {result && (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">
              {customMode ? 'Custom Filter Results' : SEGMENTS.find((s) => s.key === activeSegment)?.label ?? 'Results'}
            </p>
            <Badge variant="secondary">{result.total} donors</Badge>
          </div>
          {result.donors.length === 0 ? (
            <p className="px-4 py-12 text-center text-muted-foreground">No donors match this criteria.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Donor</th>
                      <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">Type</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Score</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Total Donated</th>
                      <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground md:table-cell">Last Donation</th>
                      <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground lg:table-cell">Tags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.donors.map((donor) => (
                      <tr key={donor.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {donor.source === 'guest' ? (
                              <span className="font-medium">{donor.name ?? donor.email}</span>
                            ) : (
                              <Link href={`/admin/users/${donor.id}`} className="font-medium underline-offset-4 hover:underline">
                                {donor.name ?? donor.email}
                              </Link>
                            )}
                            {donor.source === 'guest' && (
                              <Badge variant="secondary" className="text-xs">Guest</Badge>
                            )}
                          </div>
                          {donor.name && (
                            <p className="text-xs text-muted-foreground">{donor.email}</p>
                          )}
                        </td>
                        <td className="hidden px-4 py-2.5 sm:table-cell">
                          <Badge variant="outline" className="capitalize">{donor.donorType}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <DonorScoreBadge score={donor.donorScore} size="sm" />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{donor.totalsByCurrency.length === 0 ? '-' : donor.totalsByCurrency.map((t) => formatMoney(t.totalMinor, t.currency, 'exact')).join(' · ')}</td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
                          {donor.lastDonationAt ? formatDate(donor.lastDonationAt) : 'Never'}
                        </td>
                        <td className="hidden px-4 py-2.5 lg:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {donor.tags.slice(0, 3).map((t) => (
                              <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                            ))}
                            {donor.tags.length > 3 && (
                              <Badge variant="outline" className="text-xs">+{donor.tags.length - 3}</Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.total > PAGE_SIZE && (
                <div className="flex items-center justify-between border-t px-4 py-2">
                  <p className="text-xs text-muted-foreground">
                    Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, result.total)} of {result.total}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => handlePageChange(Math.max(0, offset - PAGE_SIZE))}>
                      <ChevronLeftIcon className="h-4 w-4" /> Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= result.total} onClick={() => handlePageChange(offset + PAGE_SIZE)}>
                      Next <ChevronRightIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
