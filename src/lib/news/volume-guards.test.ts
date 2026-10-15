/**
 * Volume guards for automated campaign creation.
 *
 * These limits already existed in `runNewsPipeline`; the defect was that the
 * OTHER two publish paths (`cron/publish-campaigns` and the admin "Create"
 * button, both via `publishCampaignFromNewsItem`) enforced none of them, which
 * is how four manual runs produced 12 campaigns past a daily limit of 10 and a
 * `simulation.max_concurrent` of 10.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockCalculateAutoVolume = vi.fn<() => Promise<number>>();
vi.mock('@/lib/seed/phase-out', () => ({
  calculateAutoVolume: () => mockCalculateAutoVolume(),
}));

const mockGetSetting = vi.fn();
vi.mock('@/lib/settings.server', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

// `db.select(...).from(...).where(...)` is awaited directly in this module, so
// `where` is the terminal promise-returning call.
const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('@/db', () => ({
  db: { select: (..._args: unknown[]) => mockSelect() },
}));

vi.mock('@/db/schema', () => ({
  campaigns: {
    source: 'source',
    publishedAt: 'published_at',
    simulationFlag: 'simulation_flag',
    status: 'status',
  },
  siteSettings: { key: 'key', value: 'value' },
}));

const { checkCampaignVolumeGuards, DEFAULT_CAMPAIGN_DAILY_LIMIT, DEFAULT_MAX_CONCURRENT_SIMULATED } =
  await import('./volume-guards');

/**
 * Queue the three queries the module makes, in order:
 *   1. `campaign_creation_daily_limit` row from `site_settings`
 *   2. count of automated campaigns published today
 *   3. count of active simulated campaigns
 */
function setupDb(opts: {
  dailyLimitRow?: { value: unknown }[];
  todayCount?: number;
  activeCount?: number;
}) {
  mockWhere
    .mockResolvedValueOnce(opts.dailyLimitRow ?? [])
    .mockResolvedValueOnce([{ count: opts.todayCount ?? 0 }])
    .mockResolvedValueOnce([{ count: opts.activeCount ?? 0 }]);
}

describe('checkCampaignVolumeGuards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` keeps queued `mockResolvedValueOnce` values, and a guard
    // that refuses early leaves its unconsumed values behind to shift the next
    // test's query sequence. Reset the terminal mock explicitly.
    mockWhere.mockReset();
    mockCalculateAutoVolume.mockResolvedValue(1.0);
    mockGetSetting.mockResolvedValue(DEFAULT_MAX_CONCURRENT_SIMULATED);
  });

  it('allows when every count is below its limit', async () => {
    setupDb({ todayCount: 3, activeCount: 4 });

    await expect(checkCampaignVolumeGuards()).resolves.toEqual({ allowed: true });
  });

  it('refuses at the daily limit', async () => {
    setupDb({ todayCount: DEFAULT_CAMPAIGN_DAILY_LIMIT, activeCount: 0 });

    const outcome = await checkCampaignVolumeGuards();

    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) {
      expect(outcome.guard).toBe('daily_limit');
      expect(outcome.reason).toContain('10/10');
    }
  });

  it('refuses past the daily limit, not only exactly at it', async () => {
    // The 12-campaign incident ended ABOVE the limit, so the comparison has to
    // be >=, not ===.
    setupDb({ todayCount: 12, activeCount: 0 });

    const outcome = await checkCampaignVolumeGuards();
    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) expect(outcome.guard).toBe('daily_limit');
  });

  it('honours a daily limit configured in site_settings over the default', async () => {
    setupDb({ dailyLimitRow: [{ value: 2 }], todayCount: 2, activeCount: 0 });

    const outcome = await checkCampaignVolumeGuards();
    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) expect(outcome.reason).toContain('2/2');
  });

  it('falls back to the coded default when the setting row is unparseable', async () => {
    setupDb({ dailyLimitRow: [{ value: 'not-a-number' }], todayCount: 9, activeCount: 0 });

    await expect(checkCampaignVolumeGuards()).resolves.toEqual({ allowed: true });
  });

  it('refuses at simulation.max_concurrent', async () => {
    mockGetSetting.mockResolvedValue(10);
    setupDb({ todayCount: 0, activeCount: 10 });

    const outcome = await checkCampaignVolumeGuards();

    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) {
      expect(outcome.guard).toBe('max_concurrent');
      expect(outcome.reason).toContain('10/10');
    }
  });

  it('refuses at the phase-out floor before spending any query', async () => {
    mockCalculateAutoVolume.mockResolvedValue(0);

    const outcome = await checkCampaignVolumeGuards();

    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) expect(outcome.guard).toBe('phase_out');
    // Phase-out means "stop", so nothing else is worth asking.
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it('treats phase-out disabled (-1) as no constraint', async () => {
    mockCalculateAutoVolume.mockResolvedValue(-1);
    setupDb({ todayCount: 0, activeCount: 0 });

    await expect(checkCampaignVolumeGuards()).resolves.toEqual({ allowed: true });
  });

  it('shares its daily-limit default with news-pipeline', () => {
    // news-pipeline.ts imports this constant rather than repeating `10`.
    expect(DEFAULT_CAMPAIGN_DAILY_LIMIT).toBe(10);
    expect(DEFAULT_MAX_CONCURRENT_SIMULATED).toBe(10);
  });
});
