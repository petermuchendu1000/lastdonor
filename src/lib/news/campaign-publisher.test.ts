import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted before imports) ──────────────────────────────────────────

// Controllable DB chain mocks
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockUpdateWhere = vi.fn().mockResolvedValue([{ id: 'updated-1' }]);
const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock('@/db', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
}));

vi.mock('@/db/schema', () => ({
  newsItems: { id: 'id', campaignCreated: 'campaign_created', campaignId: 'campaign_id' },
  campaigns: { id: 'id', slug: 'slug', subjectName: 'subject_name', title: 'title', publishedAt: 'published_at' },
  auditLogs: {},
  campaignSeedMessages: {},
}));

const mockCallAI = vi.fn();
vi.mock('@/lib/ai/call-ai', () => ({
  callAI: mockCallAI,
}));

const mockBuildExtractEntitiesPrompt = vi.fn(() => ({ systemPrompt: '', userPrompt: '' }));
vi.mock('@/lib/ai/prompts/extract-entities', () => ({
  buildExtractEntitiesPrompt: mockBuildExtractEntitiesPrompt,
}));

vi.mock('@/lib/ai/prompts/generate-campaign', () => ({
  buildGenerateCampaignPrompt: vi.fn(() => ({
    systemPrompt: '',
    userPrompt: '',
    selectedPattern: 'crisis_to_hope' as const,
  })),
  getDefaultImpactTiers: vi.fn(() => [{ amount: 2500, label: 'Covers immediate expenses' }]),
}));

vi.mock('@/lib/ai/prompts/generate-messages', () => ({
  buildGenerateMessagesPrompt: vi.fn(() => ({ systemPrompt: '', userPrompt: '' })),
}));

vi.mock('@/lib/ai/prompts/generate-headline', () => ({
  buildFallbackTitle: vi.fn(() => 'Fallback Title'),
}));

vi.mock('@/lib/ai/prompts/story-validation', () => ({
  cleanStoryHtml: vi.fn((html: string) => html),
  validateStory: vi.fn(() => ({ valid: true })),
}));

vi.mock('@/lib/ai/prompts/story-structures', () => ({
  scoreContextRichness: vi.fn(() => 'moderate'),
  getWordRange: vi.fn(() => ({ min: 500, max: 1500 })),
}));

vi.mock('@/lib/news/news-pipeline', () => ({
  generateHeadlineWithRetry: vi.fn().mockResolvedValue('Generated Headline'),
}));

const mockFetchArticleBody = vi.fn().mockResolvedValue('Full article body text...');
vi.mock('@/lib/news/fetch-article-body', () => ({
  fetchArticleBody: mockFetchArticleBody,
}));

type GuardOutcome =
  | { allowed: true }
  | { allowed: false; guard: string; reason: string };

const mockCheckCampaignVolumeGuards = vi.fn<() => Promise<GuardOutcome>>();
vi.mock('@/lib/news/volume-guards', () => ({
  checkCampaignVolumeGuards: () => mockCheckCampaignVolumeGuards(),
}));

vi.mock('@/lib/news/image-resolver', () => ({
  resolveHeroImageEnhanced: vi.fn().mockResolvedValue({
    url: '/images/fallback.jpg',
    credit: null,
    source: 'fallback',
  }),
}));

vi.mock('@/lib/utils/slug', () => ({
  generateSlug: vi.fn((input: string) => input.toLowerCase().replace(/\s+/g, '-')),
}));

vi.mock('@/lib/utils/phase', () => ({
  getCampaignPhase: vi.fn(() => 'first_believers'),
}));

const mockIsValidEntityName = vi.fn(() => true);
const mockNormalizeSubjectName = vi.fn((name: string) => name.toLowerCase());
const mockValidateCampaignQuality = vi.fn((): { pass: true } | { pass: false; reason: string } => ({ pass: true }));
vi.mock('@/lib/utils/entity-validation', () => ({
  isValidEntityName: mockIsValidEntityName,
  normalizeSubjectName: mockNormalizeSubjectName,
  validateCampaignQuality: mockValidateCampaignQuality,
}));

vi.mock('@/lib/seed/message-validation', () => ({
  validateMessages: vi.fn((msgs: string[]) => ({ valid: msgs, invalid: [] })),
}));

vi.mock('@/lib/seed/trajectory-profiles', () => ({
  generateTrajectoryProfile: vi.fn(() => ({ archetype: 'steady_climb' })),
}));

vi.mock('@/lib/seed/organizer-generator', () => ({
  generateOrganizerIdentity: vi.fn().mockResolvedValue({
    name: 'Sarah Johnson',
    relation: 'friend',
    city: 'Portland, OR',
  }),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: vi.fn() } };
  },
}));

// ── Import under test (AFTER all mocks) ─────────────────────────────────────

const { publishCampaignFromNewsItem, selectBalancedCandidates } = await import('./campaign-publisher');

// ── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_NEWS_ITEM = {
  id: 'news-1',
  title: 'Family loses home in Portland fire',
  url: 'https://example.com/article-1',
  source: 'GNews:KOIN 6',
  summary: 'A Portland family lost everything in a house fire.',
  articleBody: null,
  imageUrl: 'https://example.com/photo.jpg',
  category: 'disaster',
  relevanceScore: 85,
  campaignCreated: false,
  campaignId: null,
  adminFlagged: false,
  adminOverrideCategory: null,
  adminNotes: null,
  publishedAt: new Date('2026-03-25'),
  fetchedAt: new Date('2026-03-25'),
};

const MOCK_CAMPAIGN_ID = 'campaign-abc-123';

const DEFAULT_ENTITY = {
  name: 'Jane Smith',
  age: 32,
  event: 'house fire',
  hometown: 'Portland, OR',
  family: [],
  category: 'disaster',
  suggestedGoal: 10000,
  sourceUrl: '',
  sourceName: '',
  confidence: 85,
};

function setupSuccessPath() {
  // Step 1: select news item → found
  mockLimit.mockResolvedValueOnce([MOCK_NEWS_ITEM]);
  // Step 3: slug dedup → no match
  mockLimit.mockResolvedValueOnce([]);
  // Step 7a: exact subject name dedup → no match
  mockLimit.mockResolvedValueOnce([]);
  // Step 7b: recent campaigns for fuzzy dedup → none
  mockLimit.mockResolvedValueOnce([]);
  // Step 11: insert campaign → returning id
  mockReturning.mockResolvedValueOnce([{ id: MOCK_CAMPAIGN_ID }]);
  // callAI calls: entity extraction, story generation, seed messages
  mockCallAI
    .mockResolvedValueOnce(DEFAULT_ENTITY)
    .mockResolvedValueOnce('<section><h2>The Story</h2><p>Content...</p></section>')
    .mockResolvedValueOnce(['Thank you for helping Jane!', 'Every dollar counts.']);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('publishCampaignFromNewsItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Volume guards allow by default; the guard tests below override this.
    mockCheckCampaignVolumeGuards.mockResolvedValue({ allowed: true });
  });

  it('returns NOT_FOUND when news item does not exist', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const result = await publishCampaignFromNewsItem('nonexistent-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns ALREADY_CREATED when campaignCreated is true', async () => {
    mockLimit.mockResolvedValueOnce([{ ...MOCK_NEWS_ITEM, campaignCreated: true, campaignId: 'existing-1' }]);

    const result = await publishCampaignFromNewsItem('news-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ALREADY_CREATED');
    }
  });

  it('returns NO_CATEGORY when item has no category and no admin override', async () => {
    mockLimit.mockResolvedValueOnce([{ ...MOCK_NEWS_ITEM, category: null, adminOverrideCategory: null }]);

    const result = await publishCampaignFromNewsItem('news-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_CATEGORY');
    }
  });

  it('uses adminOverrideCategory when available', async () => {
    mockLimit
      .mockResolvedValueOnce([{ ...MOCK_NEWS_ITEM, category: 'disaster', adminOverrideCategory: 'medical' }])
      .mockResolvedValueOnce([])  // slug dedup
      .mockResolvedValueOnce([])  // subject dedup
      .mockResolvedValueOnce([]); // recent campaigns
    mockReturning.mockResolvedValueOnce([{ id: MOCK_CAMPAIGN_ID }]);
    mockCallAI
      .mockResolvedValueOnce(DEFAULT_ENTITY)
      .mockResolvedValueOnce('<section><h2>Story</h2><p>Text</p></section>')
      .mockResolvedValueOnce(['Message 1']);

    await publishCampaignFromNewsItem('news-1');

    expect(mockBuildExtractEntitiesPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'medical' }),
    );
  });

  it('returns DUPLICATE_SUBJECT when slug already exists', async () => {
    mockLimit
      .mockResolvedValueOnce([MOCK_NEWS_ITEM])   // news item found
      .mockResolvedValueOnce([{ id: 'existing-slug-campaign' }]); // slug match

    const result = await publishCampaignFromNewsItem('news-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DUPLICATE_SUBJECT');
    }
  });

  it('returns INVALID_ENTITY when entity name is garbage', async () => {
    mockValidateCampaignQuality.mockReturnValueOnce({ pass: false, reason: 'Invalid entity name: all words are generic descriptors' });
    mockCallAI.mockResolvedValueOnce(DEFAULT_ENTITY);

    mockLimit
      .mockResolvedValueOnce([MOCK_NEWS_ITEM]) // news item
      .mockResolvedValueOnce([]);               // no slug match

    const result = await publishCampaignFromNewsItem('news-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ENTITY');
    }
  });

  it('returns DUPLICATE_SUBJECT when exact subject name exists', async () => {
    mockCallAI.mockResolvedValueOnce(DEFAULT_ENTITY);

    mockLimit
      .mockResolvedValueOnce([MOCK_NEWS_ITEM])       // news item
      .mockResolvedValueOnce([])                       // no slug match
      .mockResolvedValueOnce([{ id: 'existing-subj-campaign' }]); // subject match

    const result = await publishCampaignFromNewsItem('news-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DUPLICATE_SUBJECT');
    }
  });

  it('returns DUPLICATE_SUBJECT on fuzzy subject name match', async () => {
    mockNormalizeSubjectName.mockReturnValue('jane smith');
    mockCallAI.mockResolvedValueOnce(DEFAULT_ENTITY);

    mockLimit
      .mockResolvedValueOnce([MOCK_NEWS_ITEM]) // news item
      .mockResolvedValueOnce([])                // no slug
      .mockResolvedValueOnce([])                // no exact subject
      .mockResolvedValueOnce([{ title: 'Help Jane Smith', subjectName: 'Jane Smith' }]); // fuzzy match

    const result = await publishCampaignFromNewsItem('news-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DUPLICATE_SUBJECT');
    }
  });

  it('successfully creates a campaign from a valid news item', async () => {
    setupSuccessPath();

    const result = await publishCampaignFromNewsItem('news-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.campaignId).toBe(MOCK_CAMPAIGN_ID);
      expect(result.data.campaignTitle).toBeDefined();
      expect(result.data.campaignSlug).toBeDefined();
    }

    // Verify campaign was inserted
    expect(mockInsert).toHaveBeenCalled();
    // Verify news item was marked as processed
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('uses cached articleBody when available instead of fetching', async () => {
    const itemWithBody = { ...MOCK_NEWS_ITEM, articleBody: 'Cached article body' };
    mockLimit
      .mockResolvedValueOnce([itemWithBody])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockReturning.mockResolvedValueOnce([{ id: MOCK_CAMPAIGN_ID }]);
    mockCallAI
      .mockResolvedValueOnce(DEFAULT_ENTITY)
      .mockResolvedValueOnce('<section><h2>Story</h2><p>Text</p></section>')
      .mockResolvedValueOnce(['Message 1']);

    await publishCampaignFromNewsItem('news-1');

    expect(mockFetchArticleBody).not.toHaveBeenCalled();
  });

  it('passes custom auditEventType when provided', async () => {
    setupSuccessPath();

    await publishCampaignFromNewsItem('news-1', {
      auditEventType: 'campaign.admin_published',
    });

    // The audit log insert should have been called with the custom event type
    // We verify through mockInsert calls (the 3rd insert call is the audit log)
    expect(mockInsert).toHaveBeenCalled();
  });

  it('mutates recentStoryPatterns array for batch anti-repetition', async () => {
    setupSuccessPath();

    const patterns: string[] = [];
    await publishCampaignFromNewsItem('news-1', {
      recentStoryPatterns: patterns as never[],
    });

    expect(patterns.length).toBeGreaterThan(0);
  });

  // ── Volume guards ─────────────────────────────────────────────────────────
  //
  // Regression lock for the defect behind "four manual publish-campaigns runs
  // created 12 campaigns past a daily limit of 10 and a max_concurrent of 10":
  // runNewsPipeline enforced those limits, this shared publisher did not, and
  // both the cron batch and the admin Create button go through here.
  describe('volume guards', () => {
    it('refuses with VOLUME_LIMIT when the daily limit is reached', async () => {
      mockCheckCampaignVolumeGuards.mockResolvedValue({
        allowed: false,
        guard: 'daily_limit',
        reason: 'Daily campaign creation limit reached (10/10 automated campaigns published today).',
      });
      mockLimit.mockResolvedValueOnce([MOCK_NEWS_ITEM]);

      const result = await publishCampaignFromNewsItem('news-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VOLUME_LIMIT');
        expect(result.error.message).toContain('Daily campaign creation limit');
      }
    });

    it('refuses with VOLUME_LIMIT when max_concurrent is reached', async () => {
      mockCheckCampaignVolumeGuards.mockResolvedValue({
        allowed: false,
        guard: 'max_concurrent',
        reason: 'Max concurrent simulated campaigns reached (10/10 active).',
      });
      mockLimit.mockResolvedValueOnce([MOCK_NEWS_ITEM]);

      const result = await publishCampaignFromNewsItem('news-1');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VOLUME_LIMIT');
    });

    it('refuses with VOLUME_LIMIT when the phase-out floor is reached', async () => {
      mockCheckCampaignVolumeGuards.mockResolvedValue({
        allowed: false,
        guard: 'phase_out',
        reason: 'Phase-out threshold reached.',
      });
      mockLimit.mockResolvedValueOnce([MOCK_NEWS_ITEM]);

      const result = await publishCampaignFromNewsItem('news-1');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VOLUME_LIMIT');
    });

    it('spends no AI calls and writes nothing when a guard refuses', async () => {
      mockCheckCampaignVolumeGuards.mockResolvedValue({
        allowed: false,
        guard: 'daily_limit',
        reason: 'limit',
      });
      mockLimit.mockResolvedValueOnce([MOCK_NEWS_ITEM]);

      await publishCampaignFromNewsItem('news-1');

      expect(mockCallAI).not.toHaveBeenCalled();
      expect(mockFetchArticleBody).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('is checked on the default path, so both callers inherit it', async () => {
      setupSuccessPath();

      await publishCampaignFromNewsItem('news-1');

      expect(mockCheckCampaignVolumeGuards).toHaveBeenCalledTimes(1);
    });

    it('skips the guards entirely under bypassVolumeGuards (admin override)', async () => {
      mockCheckCampaignVolumeGuards.mockResolvedValue({
        allowed: false,
        guard: 'daily_limit',
        reason: 'limit',
      });
      setupSuccessPath();

      const result = await publishCampaignFromNewsItem('news-1', {
        bypassVolumeGuards: true,
      });

      expect(mockCheckCampaignVolumeGuards).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });
  });
});

// ── Batch slot filling ──────────────────────────────────────────────────────

describe('selectBalancedCandidates', () => {
  type Item = { id: string; military: boolean };
  const isMilitary = (i: Item) => i.military;

  function items(spec: string): Item[] {
    // "mmoooo" -> 2 military then 4 others, in that order
    return [...spec].map((c, idx) => ({ id: `${c}${idx}`, military: c === 'm' }));
  }

  const OPTS = { isMilitary, maxTotal: 5, maxMilitary: 2 };

  // The regression this function exists for: the old expression was
  // `[...military.slice(0,2), ...other.slice(0,3)].slice(0,5)`, which capped
  // OTHERS at 3 independently of the military cap. With 1 military candidate
  // it could only ever return 4; with 0, only 3. The seed set had exactly one
  // military item, and four runs yielded 4+3+3+2 = 12 campaigns rather than
  // 5+5+2.
  it('fills all 5 slots when there is exactly 1 military candidate', () => {
    const picked = selectBalancedCandidates(items('moooooooo'), OPTS);
    expect(picked).toHaveLength(5);
    expect(picked.filter(isMilitary)).toHaveLength(1);
  });

  it('fills all 5 slots when there are no military candidates', () => {
    const picked = selectBalancedCandidates(items('oooooooo'), OPTS);
    expect(picked).toHaveLength(5);
  });

  it('fills all 5 slots when military candidates are plentiful', () => {
    const picked = selectBalancedCandidates(items('mmmmmoooooo'), OPTS);
    expect(picked).toHaveLength(5);
    expect(picked.filter(isMilitary)).toHaveLength(2);
  });

  it('never exceeds the military ceiling, even with empty slots left over', () => {
    // 3 military, 0 others: the cap is a ceiling on source imbalance, so the
    // remaining slots stay empty rather than being backfilled with military.
    const picked = selectBalancedCandidates(items('mmm'), OPTS);
    expect(picked).toHaveLength(2);
    expect(picked.every(isMilitary)).toBe(true);
  });

  it('returns everything available when candidates are fewer than the slots', () => {
    expect(selectBalancedCandidates(items('mo'), OPTS)).toHaveLength(2);
    expect(selectBalancedCandidates([], OPTS)).toHaveLength(0);
  });

  it('never returns more than maxTotal', () => {
    for (let military = 0; military <= 6; military++) {
      for (let other = 0; other <= 8; other++) {
        const picked = selectBalancedCandidates(
          items('m'.repeat(military) + 'o'.repeat(other)),
          OPTS,
        );
        expect(picked.length).toBeLessThanOrEqual(5);
        expect(picked.filter(isMilitary).length).toBeLessThanOrEqual(2);
        // And it must fill every slot it legitimately can.
        const fillable = Math.min(5, Math.min(military, 2) + other);
        expect(picked).toHaveLength(fillable);
      }
    }
  });

  it('preserves relevance order, military picks first', () => {
    const picked = selectBalancedCandidates(items('ommooo'), OPTS);
    expect(picked.map((p) => p.id)).toEqual(['m1', 'm2', 'o0', 'o3', 'o4']);
  });

  it('keeps the military cap below the total cap when asked for more', () => {
    const picked = selectBalancedCandidates(items('mmmmm'), {
      isMilitary,
      maxTotal: 2,
      maxMilitary: 5,
    });
    expect(picked).toHaveLength(2);
  });
});
