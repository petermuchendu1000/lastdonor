/**
 * Seed enough data that every /admin screen renders a POPULATED state.
 *
 * The E2E fixture covers users, campaigns, donations, updates, collaborators,
 * blog posts and site settings. Twelve admin screens read tables it never
 * touches, so without this they would be measured empty - and an empty table
 * hides every defect that lives in a row.
 *
 * Column names and enum values were read from the LIVE local schema before
 * this file was written (information_schema + pg_enum), never inferred.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { seedE2EData, E2E_ADMIN_EMAIL, E2E_FIXTURE_IDS } from '../e2e/fixtures/seed-data';

async function main() {
  await seedE2EData();

  const [admin] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, E2E_ADMIN_EMAIL))
    .limit(1);
  if (!admin) throw new Error('admin fixture missing');

  const campaigns = await db
    .select({ id: schema.campaigns.id, currency: schema.campaigns.currency, creatorId: schema.campaigns.creatorId })
    .from(schema.campaigns)
    .limit(5);
  if (campaigns.length === 0) throw new Error('no campaigns seeded');
  const c0 = campaigns[0];

  const [donation] = await db.select({ id: schema.donations.id }).from(schema.donations).limit(1);

  // ── audit_logs: /admin/activity, /admin/audit-log, /admin/payouts, /admin/simulation
  await db.insert(schema.auditLogs).values([
    { eventType: 'campaign.published', actorId: admin.id, actorRole: 'admin', targetType: 'campaign', targetId: c0.id, severity: 'info', details: { slug: 'walk-fixture' } },
    { eventType: 'campaign.refused', actorId: admin.id, actorRole: 'admin', targetType: 'campaign', targetId: c0.id, severity: 'warning', details: { reason: 'Walk fixture reason' } },
    { eventType: 'cron.reconcile', actorRole: 'admin', severity: 'info', details: { fixed: 0 } },
    { eventType: 'user.role_changed', actorId: admin.id, actorRole: 'admin', targetType: 'user', targetId: admin.id, severity: 'critical', details: { from: 'donor', to: 'admin' } },
  ]);

  // ── blog_topic_queue: /admin/blog/topics
  await db.insert(schema.blogTopicQueue).values([
    { title: 'Walk fixture topic one', slug: 'walk-fixture-topic-one', primaryKeyword: 'medical fundraising', status: 'pending', priorityScore: 90 },
    { title: 'Walk fixture topic two', slug: 'walk-fixture-topic-two', primaryKeyword: 'funeral costs', status: 'rejected', priorityScore: 40, rejectedReason: 'Too close to an existing post' },
  ]);

  /*
    A KES campaign, because the designation below cannot exist without one.

    [VERIFIED from pg_constraint] `campaign_payout_designations` carries TWO
    composite FKs - `(campaign_id, currency)` into campaigns and
    `(payout_account_id, currency)` into the payout account - and
    `payout_rail` has exactly ONE value, `mpesa_paybill`, which is a KES rail.
    So a USD campaign can never be designated a payout account, and every
    campaign the E2E fixture seeds is USD.
  */
  const [kesCampaign] = await db.insert(schema.campaigns).values({
    title: 'Walk Fixture: Shilling Appeal',
    slug: 'walk-fixture-shilling-appeal',
    heroImageUrl: 'https://example.invalid/hero.jpg',
    storyHtml: '<p>A seeded KES campaign so the payout screens have a row.</p>',
    goalAmount: 500_000,
    category: 'medical',
    subjectName: 'Walk Fixture Subject',
    currency: 'KES',
    status: 'active',
    creatorId: c0.creatorId ?? admin.id,
    publishedAt: new Date(),
  }).returning({ id: schema.campaigns.id });

  // ── trusted_institutions + payout accounts: /admin/institutions
  const [inst] = await db.insert(schema.trustedInstitutions).values({
    name: 'Walk Fixture Hospital', kind: 'hospital', country: 'KE',
    website: 'https://example.invalid', status: 'active',
    verifiedBy: admin.id, verificationNotes: 'Seeded for the admin walk.',
  }).returning({ id: schema.trustedInstitutions.id });

  const [acct] = await db.insert(schema.institutionPayoutAccounts).values({
    institutionId: inst.id, currency: 'KES', rail: 'mpesa_paybill',
    accountIdentifier: '123456', accountReferenceLabel: 'Patient number',
    status: 'active', confirmedBy: admin.id, confirmationNotes: 'Confirmed by phone, walk fixture.',
  }).returning({ id: schema.institutionPayoutAccounts.id });

  // ── campaign_payout_designations: /admin/payout-queue
  await db.insert(schema.campaignPayoutDesignations).values({
    campaignId: kesCampaign.id, payoutAccountId: acct.id, currency: 'KES',
    accountReference: 'REF-WALK-001', status: 'active', designatedBy: admin.id,
  });

  // ── campaign_withdrawals: /admin/payouts
  await db.insert(schema.campaignWithdrawals).values([
    { campaignId: c0.id, requestedBy: c0.creatorId ?? admin.id, amount: 25_000, status: 'requested' },
    { campaignId: c0.id, requestedBy: c0.creatorId ?? admin.id, amount: 10_000, status: 'completed', processedBy: admin.id, processedAt: new Date() },
  ]);

  // ── verification_documents + document_screenings: /admin/verification, /admin/screening
  const [doc] = await db.insert(schema.verificationDocuments).values({
    campaignId: c0.id, uploadedBy: c0.creatorId ?? admin.id,
    documentType: 'national_id', fileUrl: 'supabase-private://verification/walk-fixture.pdf',
    fileName: 'walk-fixture-id.pdf', fileSize: 12_345, mimeType: 'application/pdf',
    description: 'Seeded for the admin walk.', status: 'pending',
  }).returning({ id: schema.verificationDocuments.id });

  /*
    ⚠️ `action`, `flags` and `name_match_kind` are `text`/`jsonb` with NO CHECK
    constraint, so `information_schema` says nothing about their permitted
    values and Postgres accepts anything. The first version of this fixture
    invented all three - `action: 'hold'`, `nameMatchKind: 'cannot_judge'` and
    `flags` as `[{code, detail}]` objects - and `/admin/screening` answered
    HTTP 500, which read exactly like a defect in the page.

    It was not. The real unions are `decide.ts:108` (`auto_approve` |
    `needs_human`), `decide.ts:66-82` (`ScreeningFlag`, string literals) and
    `name-match.ts:92-104` (`NameMatchKind`). A column whose domain lives in
    TypeScript rather than in a constraint can only be read from the code
    that writes it.
  */
  await db.insert(schema.documentScreenings).values({
    documentId: doc.id, campaignId: c0.id, action: 'needs_human',
    flags: ['no_trusted_name', 'low_text_yield'],
    summary: 'Held for a person to read: no verified organiser name exists to compare.',
    nameMatchKind: 'indeterminate', nameMatchScore: 0, modelUsed: 'walk-fixture', latencyMs: 1234, pageCount: 1,
  });

  // ── news_items: /admin/news-feed
  await db.insert(schema.newsItems).values([
    { title: 'Walk fixture news item', url: 'https://example.invalid/news/1', source: 'Fixture Wire', summary: 'A seeded item so the feed is not empty.', relevanceScore: 72, publishedAt: new Date() },
    { title: 'Walk fixture flagged item', url: 'https://example.invalid/news/2', source: 'Fixture Wire', summary: 'Flagged by an admin.', relevanceScore: 31, adminFlagged: true, adminNotes: 'Not suitable.', publishedAt: new Date() },
  ]);

  // ── notifications: /admin/notifications
  await db.insert(schema.notifications).values([
    { userId: admin.id, type: 'campaign_submitted', title: 'A campaign needs review', message: 'Seeded for the admin walk.', link: '/admin/campaigns', read: false },
    { userId: admin.id, type: 'verification_documents_submitted', title: 'Documents submitted', message: 'Seeded for the admin walk.', read: true },
  ]);

  // ── fund_pool_allocations: /admin/simulation/fund-pool, /admin/simulation/analytics
  if (donation) {
    await db.insert(schema.fundPoolAllocations).values({
      donationId: donation.id, sourceCampaignId: c0.id, targetCampaignId: campaigns[1]?.id ?? null,
      amount: 5_000, status: 'pending', notes: 'Seeded for the admin walk.',
    });
  }

  /*
    A PayHero / KES donation, and a refund batch.

    The E2E fixture seeds only `stripe` / `USD` donations, but the live rail
    is PayHero and every real donation this platform has taken is `payhero`
    in KES (`docs/92`, `docs/122`). The admin refund route branches on
    `provider !== 'stripe'` and that branch is where `docs/122` found a
    refund telling the donor nothing - so a money walk on Stripe-only rows
    exercises the branch real money never takes.

    The composite FK on `(campaign_id, currency)` (`docs/92`) means this has
    to hang off the KES campaign above, not the general fund.
  */
  const [kesDonation] = await db.insert(schema.donations).values({
    campaignId: kesCampaign.id,
    stripePaymentId: 'payhero_WALKFIXTURE001',
    provider: 'payhero',
    currency: 'KES',
    amount: 5_000,
    donorName: 'Walk Fixture Donor',
    donorEmail: 'walk-fixture-donor@example.invalid',
    donorLocation: 'Nairobi',
    message: 'Seeded for the money walk.',
    phaseAtTime: 'first_believers',
    source: 'real',
  }).returning({ id: schema.donations.id });

  await db.insert(schema.refundBatches).values({
    campaignId: c0.id,
    initiatedBy: admin.id,
    reason: 'Seeded for the money walk, so /admin/refunds is not measured empty.',
    totalDonations: 2,
    totalAmount: 480_000,
    refundedCount: 1,
    failedCount: 1,
    status: 'partial_failure',
  });

  // ── newsletter_subscribers: /admin/(index)
  await db.insert(schema.newsletterSubscribers).values([
    { email: 'walk-fixture-a@example.invalid', source: 'footer' },
    { email: 'walk-fixture-b@example.invalid', source: 'homepage' },
  ]);

  console.log(JSON.stringify({
    adminId: admin.id, adminEmail: E2E_ADMIN_EMAIL,
    campaignId: c0.id, kesCampaignId: kesCampaign.id, kesDonationId: kesDonation.id,
    institutionId: inst.id, documentId: doc.id,
    campaigns: campaigns.length, fixtureIds: E2E_FIXTURE_IDS.slugPrefix,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error('SEED FAILED', e); process.exit(1); });
