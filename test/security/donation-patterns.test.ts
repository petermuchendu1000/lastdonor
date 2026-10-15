/**
 * M11 - 7.2 Statistical Donation Analysis Test
 *
 * Verifies that seed donation generation produces data that is
 * statistically indistinguishable from real crowdfunding patterns.
 *
 * Tests cover:
 *   1. Amount distribution - all amounts are psychologically priced
 *   2. Donor name uniqueness - low repeat rate across many donations
 *   3. Stripe payment ID format - matches real Stripe pi_ format
 *   4. Email domain diversity - at least 5 unique domains
 *   5. Amount distribution not dominated by round numbers
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock DB and schema - simulation-engine imports them
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => []),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock('@/db/schema', () => ({
  campaigns: {},
  donations: {},
  campaignSeedMessages: {},
  campaignUpdates: {},
  campaignMessages: {},
  donationSourceEnum: vi.fn(),
  donationPhaseEnum: vi.fn(),
}));

vi.mock('@/lib/ai/call-ai', () => ({
  callAI: vi.fn().mockResolvedValue('{}'),
}));

vi.mock('@/lib/ai/prompts/generate-update', () => ({
  buildGenerateUpdatePrompt: vi.fn(),
  buildPhaseTransitionTitle: vi.fn().mockReturnValue('Update'),
}));

vi.mock('@/lib/ai/prompts/generate-impact', () => ({
  buildGenerateImpactPrompt: vi.fn(),
}));

vi.mock('@/lib/settings.server', () => ({
  getSetting: vi.fn().mockResolvedValue(false),
}));

import { generateSeedAmount, validAmountsForTier } from '@/lib/seed/amount-generator';
import { generateSeedDonor, NAME_POOL_SIZE } from '@/lib/seed/name-generator';
import {
  generateSeedPaymentId,
  isSeedPaymentId,
  generateRealisticEmail,
  SEED_PAYMENT_ID_PREFIX,
  EMAIL_DOMAINS,
} from '@/lib/seed/simulation-engine';
import type { AmountTier } from '@/lib/seed/trajectory-profiles';

const SAMPLE_SIZE = 500;

describe('Statistical Donation Analysis', () => {
  describe('Amount Distribution', () => {
    const TIERS: AmountTier[] = ['low', 'mid', 'high'];

    for (const tier of TIERS) {
      it(`${tier} tier: all amounts are valid psychological prices`, () => {
        const valid = new Set(validAmountsForTier(tier));
        for (let i = 0; i < SAMPLE_SIZE; i++) {
          const amount = generateSeedAmount(tier);
          expect(valid.has(amount), `Invalid amount: $${amount} for ${tier} tier`).toBe(true);
        }
      });

      it(`${tier} tier: no single amount exceeds 50% of samples`, () => {
        const counts = new Map<number, number>();
        for (let i = 0; i < SAMPLE_SIZE; i++) {
          const amount = generateSeedAmount(tier);
          counts.set(amount, (counts.get(amount) ?? 0) + 1);
        }
        for (const [amount, count] of counts) {
          expect(count / SAMPLE_SIZE).toBeLessThan(0.5);
        }
      });
    }

    it('produces at least 4 distinct amounts across 500 mid-tier samples', () => {
      const unique = new Set<number>();
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        unique.add(generateSeedAmount('mid'));
      }
      expect(unique.size).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Donor Name Uniqueness', () => {
    it('repeat rate ≤ 30% across 500 donors', () => {
      const names: string[] = [];
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        names.push(generateSeedDonor().name);
      }
      const unique = new Set(names);
      const repeatRate = 1 - unique.size / names.length;
      expect(repeatRate).toBeLessThanOrEqual(0.30);
    });

    it('name pool has sufficient diversity (at least 100 entries)', () => {
      expect(NAME_POOL_SIZE).toBeGreaterThanOrEqual(100);
    });

    it('generates names with realistic structures (first + last or display names)', () => {
      for (let i = 0; i < 100; i++) {
        const donor = generateSeedDonor();
        // Name should be non-empty and not contain suspicious characters
        expect(donor.name.length).toBeGreaterThan(0);
        expect(donor.name).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b/i);
      }
    });
  });

  describe('Seed Payment ID Namespace', () => {
    // `donations.stripe_payment_id` carries the UNIQUE index that is the only
    // replay protection against a duplicated Stripe webhook. Seed ids share
    // that column, so they must share the uniqueness guarantee WITHOUT sharing
    // Stripe's namespace: a seed row occupying a real PaymentIntent id would
    // make `onConflictDoNothing` (payment-service.ts) drop a real
    // donation, leaving Stripe with the money and the DB with no row.
    it('never mints an ID inside Stripe\'s pi_ namespace', () => {
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const id = generateSeedPaymentId();
        expect(id.startsWith('pi_'), `seed id collided with Stripe namespace: ${id}`).toBe(false);
      }
    });

    it('all IDs are prefixed seed_ and greppable as fabricated', () => {
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const id = generateSeedPaymentId();
        expect(id.startsWith(SEED_PAYMENT_ID_PREFIX)).toBe(true);
        expect(isSeedPaymentId(id)).toBe(true);
      }
    });

    it('all IDs match ^seed_<uuid v4>$ format', () => {
      const pattern = /^seed_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        expect(generateSeedPaymentId()).toMatch(pattern);
      }
    });

    it('IDs are unique across 500 samples (UNIQUE index must hold)', () => {
      const ids = new Set<string>();
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        ids.add(generateSeedPaymentId());
      }
      expect(ids.size).toBe(SAMPLE_SIZE);
    });

    it('does not classify a real Stripe ID as a seed ID', () => {
      expect(isSeedPaymentId('pi_3QxYzAbCdEfGhIjKlMnOpQrS')).toBe(false);
    });
  });

  describe('Email Domain Diversity', () => {
    it('uses at least 5 unique domains across 500 emails', () => {
      const domains = new Set<string>();
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const donor = generateSeedDonor();
        const email = generateRealisticEmail(donor.name);
        const domain = email.split('@')[1];
        domains.add(domain);
      }
      expect(domains.size).toBeGreaterThanOrEqual(5);
    });

    it('all emails come from the known domain pool', () => {
      const validDomains = new Set(EMAIL_DOMAINS);
      for (let i = 0; i < 200; i++) {
        const email = generateRealisticEmail('Test User');
        const domain = email.split('@')[1];
        expect(validDomains.has(domain), `Unknown domain: ${domain}`).toBe(true);
      }
    });

    it('emails are valid format (local@domain.tld)', () => {
      const emailPattern = /^[a-z0-9]+[a-f0-9]{6}@[a-z]+\.[a-z]+$/;
      for (let i = 0; i < 100; i++) {
        const email = generateRealisticEmail('Jane Doe');
        expect(email).toMatch(emailPattern);
      }
    });

    it('no email uses @lastdonor.internal domain', () => {
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const email = generateRealisticEmail(generateSeedDonor().name);
        expect(email).not.toContain('lastdonor.internal');
      }
    });
  });
});
