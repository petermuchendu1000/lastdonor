/**
 * Seed a THROWAWAY database with enough to walk the institutional-payout
 * journey in a real browser (`docs/113` §11-12).
 *
 * ⛔ REFUSES any non-local database. The only connection string this project
 * really has is production (`docs/98` §1), and this script inserts rows.
 *
 * Run:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54329/ldshots \
 *     npx tsx scripts/seed-payout-journey.ts
 */
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { hashPassword } from '../src/lib/password';

export const ORGANISER_EMAIL = 'organiser@payout.test';
export const ADMIN_EMAIL = 'admin@payout.test';
export const PASSWORD = 'JourneyShots!2026';

function assertLocal(url: string | undefined) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  const local = ['localhost', '127.0.0.1', '::1'];
  if (!local.includes(host)) {
    throw new Error(
      `Refusing to seed ${host}. This script writes rows and only a throwaway database may be used.`,
    );
  }
  if (/supabase|pooler|fly\.dev|\.internal/.test(url)) {
    throw new Error('Refusing: that looks like a managed or production host.');
  }
}

async function main() {
  assertLocal(process.env.DATABASE_URL);

  const passwordHash = await hashPassword(PASSWORD);

  const [organiser] = await db
    .insert(schema.users)
    .values({
      email: ORGANISER_EMAIL,
      name: 'Grace Wanjiru',
      role: 'donor',
      passwordHash,
      emailVerified: new Date(),
    })
    .returning();

  const [admin] = await db
    .insert(schema.users)
    .values({
      email: ADMIN_EMAIL,
      name: 'Amina Otieno',
      role: 'admin',
      passwordHash,
      emailVerified: new Date(),
    })
    .returning();

  /*
    KES, because that is the rail that actually collects money (`docs/92`)
    and the only currency an institution account can be recorded in that a
    campaign could match. `under_review` would be truer to production
    (`docs/79`) but the public page does not serve it, and screen C1 is a
    public-page screenshot - so this one is `active`.
  */
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      creatorId: organiser.id,
      title: 'Treatment for Baby Amani',
      slug: 'treatment-for-baby-amani',
      heroImageUrl:
        'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1200&q=70',
      storyHtml:
        '<p>Amani was born early and needs to stay in the newborn unit. Her family is asking for help with the hospital bill.</p>',
      goalAmount: 5_000_000, // KES 50,000.00
      raisedAmount: 1_840_000, // KES 18,400.00
      donorCount: 31,
      category: 'medical',
      subjectName: 'Amani',
      subjectHometown: 'Nairobi',
      currency: 'KES',
      status: 'active',
      publishedAt: new Date(),
    })
    .returning();

  // A second campaign with no destination, so the dashboard shows both states.
  await db.insert(schema.campaigns).values({
    creatorId: organiser.id,
    title: 'School fees for Baraka',
    slug: 'school-fees-for-baraka',
    heroImageUrl:
      'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1200&q=70',
    storyHtml: '<p>Baraka needs help with one term of school fees.</p>',
    goalAmount: 2_000_000,
    raisedAmount: 0,
    category: 'education',
    subjectName: 'Baraka',
    subjectHometown: 'Nakuru',
    currency: 'KES',
    status: 'under_review',
  });

  const [hospital] = await db
    .insert(schema.trustedInstitutions)
    .values({
      name: 'Kenyatta National Hospital',
      kind: 'hospital',
      country: 'KE',
      website: 'https://knh.or.ke',
      verifiedBy: admin.id,
      verificationNotes:
        'Called the billing office on the number printed on an official invoice and confirmed the shortcode with J. Mwangi.',
    })
    .returning();

  const [funeralHome] = await db
    .insert(schema.trustedInstitutions)
    .values({
      name: 'Lee Funeral Home',
      kind: 'funeral_home',
      country: 'KE',
      verifiedBy: admin.id,
      verificationNotes: 'Confirmed the paybill in person at the office on 24 Oct.',
    })
    .returning();

  await db.insert(schema.institutionPayoutAccounts).values([
    {
      institutionId: hospital.id,
      currency: 'KES',
      rail: 'mpesa_paybill',
      accountIdentifier: '403480',
      accountReferenceLabel: 'patient file number',
      confirmedBy: admin.id,
      confirmationNotes:
        'Called the billing office on the number printed on an official invoice and read the shortcode back to them. Spoke to J. Mwangi, 24 Oct.',
    },
    {
      institutionId: funeralHome.id,
      currency: 'KES',
      rail: 'mpesa_paybill',
      accountIdentifier: '509800',
      accountReferenceLabel: 'funeral reference',
      confirmedBy: admin.id,
      confirmationNotes: 'Confirmed in person at the office with the accounts manager, 24 Oct.',
    },
  ]);

  console.log(
    JSON.stringify(
      {
        organiser: ORGANISER_EMAIL,
        admin: ADMIN_EMAIL,
        password: PASSWORD,
        campaignId: campaign.id,
        campaignSlug: campaign.slug,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
