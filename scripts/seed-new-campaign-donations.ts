/**
 * ⛔ DO NOT RUN. See docs/33-SEED-DATA-DISCLOSURE-DECISION.md.
 *
 * This script writes fabricated donations straight into `donations` with
 * `source = 'seed'`, then rewrites `campaigns.raised_amount`,
 * `donor_count`, `last_donor_name` and `last_donor_amount` from them - i.e. it
 * fabricates exactly the figures a stranger reads when deciding whether and
 * how much to give to a live appeal. `public-select.ts` suppresses `source`, so
 * nothing on the page distinguishes these rows from real money.
 *
 * docs/33 §3 records the engineering refusal to build that; docs/33 §7 records
 * the question as still OPEN. Running this file decides it unilaterally, and
 * §3 explains why the decision is not reversible once donors have seen the
 * inflated totals: removing seed rows later makes public totals visibly
 * DECREASE, and `cron/reconcile` flags the drawdown as drift against its
 * `expectedTotal = realTotal + seedTotal` invariant.
 *
 * It is also destructive on re-run: for every campaign it touches it DELETEs
 * all `source = 'seed'` donations and ALL `campaign_updates` rows, and resets
 * `status`/`completed_at`. Pointed at a database with real donations on those
 * campaigns, the totals it then recomputes are wrong.
 *
 * Three further facts about this file specifically:
 *   - the campaign updates it inserts are written in the voice of the
 *     beneficiary's family ("Our family is overwhelmed...") for people who have
 *     not consented to being quoted - the same forged-attribution defect that
 *     made `scripts/seed-news-items.ts` unrunnable (docs/36);
 *   - it resets `seed_donation_count` and `update_count`, echo columns that
 *     CLAUDE.md records as never incremented anywhere in `src/`, so the values
 *     it writes immediately start drifting;
 *   - it loads `.env.local` directly and talks to `DATABASE_URL` with no
 *     environment check, so there is nothing stopping it from running against
 *     production.
 *
 * If seeded CAMPAIGNS are wanted without fabricated DONATIONS - which docs/33
 * §6 identifies as the legitimate half of this - use the news pipeline, which
 * creates campaigns at `raised_amount = 0`.
 *
 * Kept, unrun, as the provenance of the funding plan below.
 */
/**
 * Seed donations, campaign updates for the 12 newly published campaigns.
 * Usage: ⛔ none - see the banner above.
 *
 * Funding distribution:
 *   3 fully funded (completed)
 *   2 in Last Donor Zone (90%+)
 *   4 active mid-range (35-68%)
 *   3 just starting (8-25%)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes, randomUUID } from 'crypto';
import postgres from 'postgres';

// ─── Load .env.local ────────────────────────────────────────────────────────
const __dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const envContent = readFileSync(join(__dir, '..', '.env.local'), 'utf8');
for (const line of envContent.split('\n')) {
  const clean = line.replace(/\r$/, '').trim();
  if (!clean || clean.startsWith('#')) continue;
  const idx = clean.indexOf('=');
  if (idx === -1) continue;
  process.env[clean.slice(0, idx).trim()] = clean.slice(idx + 1).trim();
}

const sql = postgres(process.env.DATABASE_URL!);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Seed payment identifier.
 *
 * `seed_<uuid>`, NOT `pi_<24 chars>`: `donations.stripe_payment_id` carries the
 * UNIQUE index that is the only replay protection against duplicate Stripe
 * webhooks, so a fabricated id inside Stripe's `pi_` namespace can collide with
 * a real PaymentIntent and make the `onConflictDoNothing` in
 * `payment-service.ts` silently swallow a real donation. Mirrors
 * `generateSeedPaymentId` in `src/lib/seed/simulation-engine.ts`.
 */
function fakePaymentId(): string {
  return `seed_${randomUUID()}`;
}

const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
function fakeEmail(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
  const hex = randomBytes(3).toString('hex');
  return `${slug}${hex}@${EMAIL_DOMAINS[Math.floor(Math.random() * EMAIL_DOMAINS.length)]}`;
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const DONOR_NAMES = [
  'Sarah Mitchell', 'James Rodriguez', 'Emily Chen', 'Michael Thompson',
  'Amanda Foster', 'David Kim', 'Rachel Martinez', 'Chris Anderson',
  'Jessica Lee', 'Robert Taylor', 'Maria Garcia', 'Daniel Wilson',
  'Laura Johnson', 'Kevin Brown', 'Sophia Davis', 'Andrew Clark',
  'Natalie Wright', 'Jason Patel', 'Hannah Moore', 'Brandon Scott',
  'Olivia Bennett', 'Tyler Hughes', 'Grace Walker', 'Ryan Murphy',
  'Megan Stewart', 'Joshua Reed', 'Samantha Price', 'Patrick Nelson',
  'Victoria Hill', 'Nathan Cook', 'Ashley Morgan', 'Benjamin Carter',
  'Stephanie Collins', 'Matthew Barnes', 'Jennifer Ross', 'Alexander White',
  'Katherine Young', 'William King', 'Rebecca Hall', 'Christopher Green',
  'Lisa Torres', 'Eric Ramirez', 'Angela Robinson', 'Steven Lewis',
  'Melissa Young', 'Jonathan Harris', 'Cynthia Brooks', 'Mark Phillips',
  'Diana Reyes', 'Gregory Campbell', 'Karen Hernandez', 'Timothy Evans',
  'Nicole Butler', 'Jeffrey Adams', 'Michelle Rivera', 'George Turner',
  'Deborah Powell', 'Kenneth Jenkins', 'Sandra Long', 'Frank Ross',
];

const LOCATIONS = [
  'New York, NY', 'Los Angeles, CA', 'Chicago, IL', 'Houston, TX',
  'Phoenix, AZ', 'San Diego, CA', 'Dallas, TX', 'Portland, OR',
  'Denver, CO', 'Seattle, WA', 'Austin, TX', 'Nashville, TN',
  'Atlanta, GA', 'Boston, MA', 'Miami, FL', 'Minneapolis, MN',
  'Charlotte, NC', 'San Francisco, CA', 'Detroit, MI', 'Columbus, OH',
  'Indianapolis, IN', 'Jacksonville, FL', 'San Antonio, TX', 'Philadelphia, PA',
];

const PHASES = ['first_believers', 'the_push', 'closing_in', 'last_donor_zone'] as const;

function getPhase(pct: number): typeof PHASES[number] {
  if (pct < 25) return 'first_believers';
  if (pct < 60) return 'the_push';
  if (pct < 90) return 'closing_in';
  return 'last_donor_zone';
}

// ─── Funding plans keyed by subject_name substring ──────────────────────────

// subject_name_contains -> { fundingPct, donationCount range, funded }
const FUNDING_PLANS: Record<string, { pct: number; minDonors: number; maxDonors: number; funded: boolean }> = {
  // Fully funded (3)
  'Marcus Delgado':   { pct: 105, minDonors: 18, maxDonors: 28, funded: true },
  'Ramon Vega':       { pct: 100, minDonors: 14, maxDonors: 22, funded: true },
  'Alicia Reeves':    { pct: 105, minDonors: 20, maxDonors: 30, funded: true },
  // Last Donor Zone (2)
  'Patrick Callahan': { pct: 93, minDonors: 12, maxDonors: 20, funded: false },
  'Tuan Nguyen':      { pct: 96, minDonors: 15, maxDonors: 22, funded: false },
  // Active mid-range (4)
  'Derek Thompson':   { pct: 68, minDonors: 10, maxDonors: 16, funded: false },
  'Antonio Rivera':   { pct: 55, minDonors: 8, maxDonors: 14, funded: false },
  'Keisha Wallace':   { pct: 45, minDonors: 6, maxDonors: 12, funded: false },
  'Harold Jennings':  { pct: 38, minDonors: 5, maxDonors: 10, funded: false },
  // Just starting (3)
  'David Nwosu':      { pct: 22, minDonors: 4, maxDonors: 8, funded: false },
  'Mila Ostrowski':   { pct: 12, minDonors: 3, maxDonors: 6, funded: false },
  'Danielle Sutton':  { pct: 8, minDonors: 2, maxDonors: 5, funded: false },
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  Seeding Donations & Updates for 12 New Campaigns');
  console.log('  ' + '='.repeat(55) + '\n');

  // Find our 12 campaigns by subject name
  const subjectNames = Object.keys(FUNDING_PLANS);
  const ourCampaigns = await sql`
    SELECT id, title, subject_name, location, category, status,
           goal_amount, raised_amount, donor_count, slug
    FROM campaigns
    WHERE ${sql.unsafe(subjectNames.map(n => `subject_name ILIKE '%${n}%'`).join(' OR '))}
    ORDER BY published_at DESC
  `;

  if (ourCampaigns.length === 0) {
    console.log('  ERROR: Could not find any campaigns by subject name.');
    await sql.end();
    return;
  }

  console.log(`  Found ${ourCampaigns.length} campaigns to seed:\n`);

  let totalDonationsCreated = 0;
  let totalAmountRaised = 0;
  let totalUpdatesCreated = 0;

  for (const campaign of ourCampaigns) {
    const subjectName = campaign.subject_name as string;
    const matchedKey = Object.keys(FUNDING_PLANS).find(k => subjectName.includes(k));

    if (!matchedKey) {
      console.log(`  SKIP: "${campaign.title}" - no funding plan for "${subjectName}"`);
      continue;
    }

    // Reset if already has seed donations (from previous bad run)
    if ((campaign.raised_amount as number) > 0) {
      console.log(`    Resetting previous seed data...`);
      await sql`DELETE FROM donations WHERE campaign_id = ${campaign.id} AND source = 'seed'`;
      await sql`DELETE FROM campaign_updates WHERE campaign_id = ${campaign.id}`;
      await sql`UPDATE campaign_seed_messages SET used = false WHERE campaign_id = ${campaign.id}`;
      await sql`UPDATE campaigns SET raised_amount = 0, donor_count = 0, seed_donation_count = 0, update_count = 0, status = 'active', completed_at = NULL, last_donor_name = NULL, last_donor_amount = NULL WHERE id = ${campaign.id}`;
    }

    const plan = FUNDING_PLANS[matchedKey];
    const goalCents = campaign.goal_amount as number;
    const targetCents = Math.round(goalCents * plan.pct / 100);
    const donationCount = rand(plan.minDonors, plan.maxDonors);

    console.log(`  Campaign: "${campaign.title}"`);
    console.log(`    Goal: $${(goalCents / 100).toLocaleString()} | Target: ${plan.pct}% ($${(targetCents / 100).toLocaleString()}) | ${donationCount} donations`);

    // Get seed messages for this campaign
    const seedMessages = await sql`
      SELECT id, message FROM campaign_seed_messages
      WHERE campaign_id = ${campaign.id} AND used = false
      ORDER BY random()
      LIMIT ${donationCount}
    `;

    let totalRaised = 0;
    const usedNames = new Set<string>();
    const donationRows: {
      id: string;
      campaign_id: string;
      stripe_payment_id: string;
      amount: number;
      donor_name: string;
      donor_email: string;
      donor_location: string | null;
      message: string | null;
      is_anonymous: boolean;
      phase_at_time: string;
      source: string;
      created_at: Date;
    }[] = [];
    const now = new Date();

    for (let i = 0; i < donationCount; i++) {
      // Scale amounts based on target per-donation average
      const avgPerDonation = targetCents / donationCount;
      let amountCents: number;
      const roll = Math.random();

      // Create a realistic distribution around the average
      if (roll < 0.30) {
        // Small donations: 10-40% of average
        amountCents = Math.round(avgPerDonation * (0.1 + Math.random() * 0.3));
      } else if (roll < 0.60) {
        // Medium donations: 40-120% of average
        amountCents = Math.round(avgPerDonation * (0.4 + Math.random() * 0.8));
      } else if (roll < 0.85) {
        // Large donations: 120-250% of average
        amountCents = Math.round(avgPerDonation * (1.2 + Math.random() * 1.3));
      } else {
        // Whale donations: 250-500% of average
        amountCents = Math.round(avgPerDonation * (2.5 + Math.random() * 2.5));
      }

      // Enforce minimum $5, and round to nice amounts
      amountCents = Math.max(500, amountCents);
      // Round to nearest $5 for cleaner display
      amountCents = Math.round(amountCents / 500) * 500;
      if (amountCents < 500) amountCents = 500;

      // For the last donation of funded campaigns, hit the exact target
      if (i === donationCount - 1 && plan.funded) {
        amountCents = Math.max(500, targetCents - totalRaised);
      } else {
        // Don't overshoot for non-funded campaigns
        const remaining = targetCents - totalRaised;
        if (remaining <= 0) break;
        if (amountCents > remaining) {
          amountCents = Math.max(500, remaining);
        }
      }

      totalRaised += amountCents;
      const pct = (totalRaised / goalCents) * 100;
      const phase = getPhase(pct);

      // Pick unique donor name
      let donorName: string;
      do { donorName = pick(DONOR_NAMES); } while (usedNames.has(donorName) && usedNames.size < DONOR_NAMES.length);
      usedNames.add(donorName);

      const isAnon = Math.random() < 0.12;
      // Last donor on funded campaigns must not be anonymous
      const actualAnon = (plan.funded && i === donationCount - 1) ? false : isAnon;

      const message = seedMessages[i]?.message ?? null;
      // Spread donations over 2-14 days
      const hoursBack = rand(2, 336);
      const createdAt = new Date(now.getTime() - hoursBack * 3_600_000 + i * rand(60_000, 1_800_000));

      donationRows.push({
        id: randomUUID(),
        campaign_id: campaign.id,
        stripe_payment_id: fakePaymentId(),
        amount: amountCents,
        donor_name: actualAnon ? 'Anonymous' : donorName,
        donor_email: fakeEmail(donorName),
        donor_location: Math.random() < 0.65 ? pick(LOCATIONS) : null,
        message,
        is_anonymous: actualAnon,
        phase_at_time: phase,
        source: 'seed',
        created_at: createdAt,
      });

      // Mark seed message as used
      if (seedMessages[i]) {
        await sql`UPDATE campaign_seed_messages SET used = true WHERE id = ${seedMessages[i].id}`;
      }
    }

    // Batch insert donations
    if (donationRows.length > 0) {
      await sql`
        INSERT INTO donations ${sql(donationRows,
          'id', 'campaign_id', 'stripe_payment_id', 'amount', 'donor_name',
          'donor_email', 'donor_location', 'message', 'is_anonymous',
          'phase_at_time', 'source', 'created_at'
        )}
      `;
    }

    // Update campaign totals
    const finalRaised = donationRows.reduce((sum, d) => sum + d.amount, 0);
    const finalDonorCount = donationRows.length;
    totalDonationsCreated += finalDonorCount;
    totalAmountRaised += finalRaised;

    if (plan.funded) {
      const lastDonor = donationRows[donationRows.length - 1];
      await sql`
        UPDATE campaigns SET
          raised_amount = ${finalRaised},
          donor_count = ${finalDonorCount},
          seed_donation_count = ${finalDonorCount},
          status = 'completed',
          completed_at = ${new Date()},
          last_donor_name = ${lastDonor.donor_name},
          last_donor_amount = ${lastDonor.amount}
        WHERE id = ${campaign.id}
      `;
      console.log(`    FUNDED! $${(finalRaised / 100).toLocaleString()} | ${finalDonorCount} donors | Last: ${lastDonor.donor_name} ($${(lastDonor.amount / 100).toLocaleString()})`);
    } else {
      const pct = (finalRaised / goalCents) * 100;
      const newStatus = pct >= 90 ? 'last_donor_zone' : 'active';
      await sql`
        UPDATE campaigns SET
          raised_amount = ${finalRaised},
          donor_count = ${finalDonorCount},
          seed_donation_count = ${finalDonorCount},
          status = ${newStatus}
        WHERE id = ${campaign.id}
      `;
      console.log(`    ${pct.toFixed(0)}% funded | $${(finalRaised / 100).toLocaleString()} of $${(goalCents / 100).toLocaleString()} | ${finalDonorCount} donors | Status: ${newStatus}`);
    }

    // Show sample messages
    const withMessages = donationRows.filter(d => d.message);
    if (withMessages.length > 0) {
      console.log(`    Messages: ${withMessages.length} of ${donationRows.length} have messages`);
    }

    // ── Campaign Updates ──────────────────────────────────────────────────
    const pctFunded = plan.pct;
    const updates: Array<{
      id: string; campaign_id: string; title: string; body_html: string;
      update_type: string; created_at: Date;
    }> = [];

    if (plan.funded) {
      updates.push({
        id: randomUUID(), campaign_id: campaign.id as string,
        title: 'Goal Reached - Thank You All!',
        body_html: `<p>We are deeply grateful to announce that this campaign for ${subjectName} has reached its goal thanks to ${finalDonorCount} generous donors.</p><p>Every contribution made a real difference. The outpouring of support from this community has been truly remarkable.</p><p>We will be posting updates on how these funds are being used in the coming weeks.</p>`,
        update_type: 'celebration',
        created_at: new Date(now.getTime() - rand(30_000, 300_000)),
      });
      updates.push({
        id: randomUUID(), campaign_id: campaign.id as string,
        title: `A Message from ${subjectName.split(' ')[0]}'s Family`,
        body_html: `<p>Our family is overwhelmed by the kindness we have received. When we started this campaign, we were not sure anyone would listen. But you did.</p><p>To every single person who donated, shared, or sent a kind message: you gave us hope during one of the hardest times of our lives. We will never forget this generosity.</p>`,
        update_type: 'thank_you',
        created_at: new Date(now.getTime() - rand(300_000, 3_600_000)),
      });
    }

    if (pctFunded >= 50) {
      updates.push({
        id: randomUUID(), campaign_id: campaign.id as string,
        title: 'Your Support is Making a Difference',
        body_html: `<p>We are thrilled to share that this campaign has now passed ${pctFunded >= 90 ? '90' : '50'}% of its goal! The generosity of this community continues to amaze us.</p><p>${subjectName.split(' ')[0]} wanted us to share how much your support means. Every notification of a new donation brings renewed strength and hope.</p><p>If you have not had a chance to contribute yet, there is still time to help. And if you have already given, please consider sharing this campaign with someone who might want to pitch in.</p>`,
        update_type: 'milestone_reflection',
        created_at: new Date(now.getTime() - rand(3_600_000, 86_400_000)),
      });
    }

    if (pctFunded >= 25) {
      updates.push({
        id: randomUUID(), campaign_id: campaign.id as string,
        title: 'Community Response Has Been Incredible',
        body_html: `<p>We wanted to take a moment to acknowledge the incredible response from the community. ${finalDonorCount} people have come together to support ${subjectName}, and the messages of encouragement have been just as meaningful as the financial support.</p><p>Reading through your messages has reminded us that there are so many good people willing to help a stranger in need.</p>`,
        update_type: 'community_response',
        created_at: new Date(now.getTime() - rand(86_400_000, 259_200_000)),
      });
    }

    if (pctFunded < 25) {
      updates.push({
        id: randomUUID(), campaign_id: campaign.id as string,
        title: 'Every Dollar Counts',
        body_html: `<p>We just launched this campaign for ${subjectName} and already the early support has been incredible. We know the goal is ambitious, but every single donation, no matter the size, brings us one step closer.</p><p>Please share this campaign with anyone who might want to help. Together we can make a real difference.</p>`,
        update_type: 'early_momentum',
        created_at: new Date(now.getTime() - rand(43_200_000, 172_800_000)),
      });
    }

    // Insert updates
    if (updates.length > 0) {
      await sql`INSERT INTO campaign_updates ${sql(updates, 'id', 'campaign_id', 'title', 'body_html', 'update_type', 'created_at')}`;
      await sql`UPDATE campaigns SET update_count = ${updates.length} WHERE id = ${campaign.id}`;
      totalUpdatesCreated += updates.length;
      console.log(`    Updates: ${updates.length} (${updates.map(u => u.update_type).join(', ')})`);
    }

    console.log();
  }

  // ─── Final Summary ──────────────────────────────────────────────────────
  console.log('  ' + '='.repeat(55));
  console.log('  SUMMARY');
  console.log('  ' + '='.repeat(55));

  const allCampaigns = await sql`
    SELECT c.id, c.title, c.subject_name, c.status, c.goal_amount, c.raised_amount,
           c.donor_count, c.update_count, c.last_donor_name, c.last_donor_amount, c.category
    FROM campaigns c
    WHERE ${sql.unsafe(subjectNames.map(n => `c.subject_name ILIKE '%${n}%'`).join(' OR '))}
    ORDER BY c.raised_amount DESC
  `;

  const statusIcons: Record<string, string> = {
    completed: 'FUNDED',
    last_donor_zone: 'LDZ',
    active: 'ACTIVE',
  };

  for (const c of allCampaigns) {
    const goalK = ((c.goal_amount as number) / 100).toLocaleString();
    const raisedK = ((c.raised_amount as number) / 100).toLocaleString();
    const pct = (c.goal_amount as number) > 0 ? Math.round(((c.raised_amount as number) / (c.goal_amount as number)) * 100) : 0;
    const icon = statusIcons[c.status as string] ?? c.status;
    const lastDonor = c.last_donor_name ? ` | Last: ${c.last_donor_name}` : '';

    console.log(`  [${icon}] ${c.subject_name} (${c.category})`);
    console.log(`    $${raisedK} / $${goalK} (${pct}%) | ${c.donor_count} donors | ${c.update_count ?? 0} updates${lastDonor}`);
  }

  console.log(`\n  Totals: ${totalDonationsCreated} donations | $${(totalAmountRaised / 100).toLocaleString()} raised | ${totalUpdatesCreated} updates`);
  console.log('  ' + '='.repeat(55) + '\n');

  await sql.end();
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  sql.end().finally(() => process.exit(1));
});
