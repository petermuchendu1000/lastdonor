/**
 * Instant-Live Architecture - Comprehensive Tests
 *
 * Tests the complete instant-live campaign lifecycle:
 *  1. Document requirements (per-category, per-relationship)
 *  2. Email templates (first donation, completion, verification reminders)
 *  3. Notification functions (new functions + updated existing)
 *  4. Campaign instant-live creation (status: active, publishedAt, welcome email)
 *  5. Webhook triggers (first donation, campaign completion)
 *  6. Congratulations page (post-creation redirect target)
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { transformSync } from 'esbuild';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  getDocumentRequirements,
  formatDocumentRequirementsHtml,
} from '@/lib/document-requirements';
import {
  firstDonationCelebrationEmail,
  campaignCompletedCreatorEmail,
  verificationReminderEmail,
  welcomeCampaignerEmail,
  campaignSubmittedEmail,
} from '@/lib/email-templates';

const ROOT = resolve(__dirname, '../../..');

// ═══════════════════════════════════════════════════════════════════════════
// 1. DOCUMENT REQUIREMENTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Document requirements', () => {
  describe('getDocumentRequirements()', () => {
    it('returns category-specific documents for medical', () => {
      const { category } = getDocumentRequirements('medical', 'self');
      expect(category.label).toBe('Medical');
      expect(category.documents.length).toBeGreaterThanOrEqual(1);
      expect(category.documents.some(d => d.type === 'hospital_letter')).toBe(true);
    });

    it('returns category-specific documents for disaster', () => {
      const { category } = getDocumentRequirements('disaster', 'self');
      expect(category.label).toBe('Disaster Relief');
      expect(category.documents.some(d => d.type === 'official_letter')).toBe(true);
    });

    it('returns category-specific documents for education', () => {
      const { category } = getDocumentRequirements('education', 'self');
      expect(category.label).toBe('Education');
      expect(category.documents.some(d => d.label.includes('Enrollment'))).toBe(true);
    });

    it('returns category-specific documents for charity', () => {
      const { category } = getDocumentRequirements('charity', 'organization');
      expect(category.label).toBe('Charity');
      expect(category.documents.some(d => d.label.includes('Organization'))).toBe(true);
    });

    it('falls back to empty docs for unknown category', () => {
      const { category } = getDocumentRequirements('nonexistent', 'self');
      expect(category.label).toBe('nonexistent');
      expect(category.documents).toHaveLength(0);
    });

    it('returns relationship-specific documents for self', () => {
      const { relationship } = getDocumentRequirements('medical', 'self');
      expect(relationship.label).toBe('Raising for yourself');
      expect(relationship.documents.some(d => d.type === 'government_id')).toBe(true);
      expect(relationship.documents.some(d => d.type === 'selfie')).toBe(true);
    });

    it('returns relationship-specific documents for family', () => {
      const { relationship } = getDocumentRequirements('medical', 'family');
      expect(relationship.label).toBe('Raising for a family member');
      expect(relationship.documents.some(d => d.type === 'government_id')).toBe(true);
      expect(relationship.documents.some(d => d.label.includes('relationship'))).toBe(true);
    });

    it('returns relationship-specific documents for organization', () => {
      const { relationship } = getDocumentRequirements('charity', 'organization');
      expect(relationship.label).toBe('Raising for an organization');
      expect(relationship.documents.some(d => d.label.includes('Authorization'))).toBe(true);
      expect(relationship.documents.some(d => d.label.includes('Organization registration'))).toBe(true);
    });

    it('falls back to "other" for unknown relationship', () => {
      const { relationship } = getDocumentRequirements('medical', 'invalid_rel');
      expect(relationship.label).toBe('Raising for someone else');
    });

    it('combines category and relationship documents', () => {
      const { combined } = getDocumentRequirements('medical', 'self');
      // Should have at least relationship docs (id + selfie) + category docs (hospital letter)
      expect(combined.length).toBeGreaterThanOrEqual(3);
    });

    it('deduplicates documents by type+label', () => {
      const { combined } = getDocumentRequirements('charity', 'organization');
      // 'organization' relationship has an "Organization registration" doc
      // 'charity' category also has an "Organization registration" doc
      // type is 'official_letter' for both - should deduplicate
      const orgRegDocs = combined.filter(d => d.label === 'Organization registration');
      expect(orgRegDocs).toHaveLength(1);
    });

    it('relationship docs come before category docs', () => {
      const { combined, relationship } = getDocumentRequirements('medical', 'self');
      // First doc should be from relationship (government_id or selfie)
      const firstRelDoc = relationship.documents[0];
      expect(combined[0].type).toBe(firstRelDoc.type);
      expect(combined[0].label).toBe(firstRelDoc.label);
    });

    it('marks required documents correctly', () => {
      const { combined } = getDocumentRequirements('medical', 'self');
      const govId = combined.find(d => d.type === 'government_id');
      expect(govId?.required).toBe(true);
      const hospitalLetter = combined.find(d => d.type === 'hospital_letter');
      expect(hospitalLetter?.required).toBe(true);
    });

    it('marks optional documents correctly', () => {
      const { category } = getDocumentRequirements('medical', 'self');
      const receipt = category.documents.find(d => d.type === 'receipt');
      expect(receipt?.required).toBe(false);
    });

    it('handles all 23 categories without errors', () => {
      const categories = [
        'medical', 'disaster', 'military', 'veterans', 'memorial',
        'first-responders', 'community', 'essential-needs', 'emergency',
        'charity', 'education', 'animal', 'environment', 'business',
        'competition', 'creative', 'event', 'faith', 'family',
        'sports', 'travel', 'volunteer', 'wishes',
      ];
      for (const cat of categories) {
        const result = getDocumentRequirements(cat, 'self');
        expect(result.category.label).toBeTruthy();
        expect(result.combined.length).toBeGreaterThanOrEqual(2); // At minimum: id + selfie from 'self'
      }
    });

    it('handles all 7 relationships without errors', () => {
      const relationships = [
        'self', 'family', 'friend', 'colleague',
        'community_member', 'organization', 'other',
      ];
      for (const rel of relationships) {
        const result = getDocumentRequirements('medical', rel);
        expect(result.relationship.label).toBeTruthy();
        expect(result.relationship.documents.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('formatDocumentRequirementsHtml()', () => {
    it('returns HTML list items', () => {
      const html = formatDocumentRequirementsHtml('medical', 'self');
      expect(html).toContain('<li>');
      expect(html).toContain('</li>');
    });

    it('marks required documents with (required)', () => {
      const html = formatDocumentRequirementsHtml('medical', 'self');
      expect(html).toContain('(required)');
    });

    it('marks optional documents with (if available)', () => {
      const html = formatDocumentRequirementsHtml('medical', 'self');
      expect(html).toContain('(if available)');
    });

    it('includes bold label and description', () => {
      const html = formatDocumentRequirementsHtml('medical', 'self');
      expect(html).toContain('<strong>');
      expect(html).toContain('</strong>');
    });

    it('falls back to default docs for unknown category', () => {
      const html = formatDocumentRequirementsHtml('nonexistent_thing', 'self');
      // Should still return relationship docs (gov ID + selfie)
      expect(html).toContain('Government-issued photo ID');
    });

    it('includes category-specific content for medical', () => {
      const html = formatDocumentRequirementsHtml('medical', 'self');
      expect(html).toContain('Medical documentation');
    });

    it('includes category-specific content for education', () => {
      const html = formatDocumentRequirementsHtml('education', 'family');
      expect(html).toContain('Enrollment');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. EMAIL TEMPLATES - NEW TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

describe('Email templates - new lifecycle templates', () => {
  describe('firstDonationCelebrationEmail', () => {
    const email = firstDonationCelebrationEmail({
      campaignerName: 'Alice',
      campaignTitle: 'Help Alice',
      campaignSlug: 'help-alice-123',
      donorName: 'Bob',
      amount: 5000,
    });

    it('has a celebratory subject line', () => {
      expect(email.subject).toMatch(/first gift/i);
      expect(email.subject).toContain('Help Alice');
    });

    it('shows donor name in body', () => {
      expect(email.html).toContain('Bob');
    });

    it('formats donation amount in body ($50.00)', () => {
      expect(email.html).toContain('$50.00');
    });

    it('links to campaign page CTA', () => {
      expect(email.html).toContain('/campaigns/help-alice-123');
    });

    it('links to campaign page', () => {
      expect(email.html).toContain('/campaigns/help-alice-123');
    });

    it('includes sharing tips', () => {
      // Anchored on the advice, not on one word. The plain-language pass
      // (docs/94) dropped "momentum"; the three next steps are the point.
      expect(email.html).toMatch(/Tell people the news/i);
      expect(email.html).toMatch(/Send your link to 5 more people/i);
    });

    it('does NOT request verification documents', () => {
      expect(email.html).not.toContain('identity verification');
      expect(email.html).not.toContain('passport');
    });
  });

  describe('campaignCompletedCreatorEmail', () => {
    const docHtml = '<li><strong>Medical documentation</strong> (required)</li>';
    const email = campaignCompletedCreatorEmail({
      campaignerName: 'Alice',
      campaignTitle: 'Help Alice',
      campaignSlug: 'help-alice-123',
      goalAmount: 100000,
      donorCount: 42,
      documentRequirementsHtml: docHtml,
    });

    it('has a congratulatory subject line', () => {
      expect(email.subject).toMatch(/reached its goal/i);
      expect(email.subject).toContain('Help Alice');
    });

    it('shows the goal amount grouped ($1,000.00)', () => {
      expect(email.html).toContain('$1,000.00');
    });

    it('shows donor count', () => {
      expect(email.html).toContain('42');
    });

    it('includes per-category document requirements', () => {
      expect(email.html).toContain(docHtml);
    });

    it('links to verification page CTA', () => {
      expect(email.html).toContain('/dashboard/campaigns/help-alice-123/verification');
      expect(email.html).toMatch(/Start now/i);
    });

    it('explains the verification and withdrawal process', () => {
      // Still four steps, in order, in plain words (docs/94).
      expect(email.html).toMatch(/Show us who you are/i);
      expect(email.html).toMatch(/Send your papers/i);
      expect(email.html).toMatch(/Wait for our check/i);
      expect(email.html).toMatch(/Get your money/i);
    });

    it('mentions 14-day deadline', () => {
      expect(email.html).toContain('14 days');
    });

    it('includes verify@lastdonor.org support', () => {
      expect(email.html).toContain('verify@lastdonor.org');
    });

    it('handles singular donor count', () => {
      const singleEmail = campaignCompletedCreatorEmail({
        campaignerName: 'Alice',
        campaignTitle: 'Help Alice',
        campaignSlug: 'help-alice-123',
        goalAmount: 100000,
        donorCount: 1,
        documentRequirementsHtml: docHtml,
      });
      // Singular/plural still agrees; the adjective went in docs/94.
      expect(singleEmail.html).toContain('1 person gave');
      expect(singleEmail.html).not.toContain('people gave');
    });
  });

  describe('verificationReminderEmail', () => {
    const baseParams = {
      campaignerName: 'Alice',
      campaignTitle: 'Help Alice',
      campaignSlug: 'help-alice-123',
      daysSinceCompletion: 3,
      deadlineDays: 11,
    };

    it('gentle urgency has green heading', () => {
      const email = verificationReminderEmail({ ...baseParams, urgencyLevel: 'gentle' });
      expect(email.subject).toMatch(/reminder/i);
      expect(email.html).toMatch(/A reminder/i);
      expect(email.html).toContain('#0F766E');
    });

    it('firm urgency mentions days left', () => {
      const email = verificationReminderEmail({ ...baseParams, urgencyLevel: 'firm' });
      expect(email.subject).toMatch(/11 days left/i);
      expect(email.html).toMatch(/finish your checks/i);
    });

    it('warning urgency turns orange', () => {
      const email = verificationReminderEmail({ ...baseParams, deadlineDays: 5, urgencyLevel: 'warning' });
      expect(email.subject).toMatch(/only 5 days left/i);
      expect(email.html).toContain('#EA580C');
    });

    it('final urgency turns orange', () => {
      const email = verificationReminderEmail({ ...baseParams, deadlineDays: 2, urgencyLevel: 'final' });
      expect(email.subject).toMatch(/last reminder/i);
      expect(email.html).toContain('#EA580C');
      // Still warns that the money goes back.
      expect(email.html).toMatch(/send the money back/i);
    });

    it('all urgency levels link to verification page', () => {
      for (const level of ['gentle', 'firm', 'warning', 'final'] as const) {
        const email = verificationReminderEmail({ ...baseParams, urgencyLevel: level });
        expect(email.html).toContain('/dashboard/campaigns/help-alice-123/verification');
        expect(email.html).toMatch(/Finish your checks/i);
      }
    });

    it('all urgency levels include support email', () => {
      for (const level of ['gentle', 'firm', 'warning', 'final'] as const) {
        const email = verificationReminderEmail({ ...baseParams, urgencyLevel: level });
        expect(email.html).toContain('verify@lastdonor.org');
      }
    });

    it('shows days since completion in body', () => {
      const email = verificationReminderEmail({ ...baseParams, daysSinceCompletion: 7, urgencyLevel: 'firm' });
      expect(email.html).toContain('7 days');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. EMAIL TEMPLATES - UPDATED TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

describe('Email templates - updated for instant-live', () => {
  describe('welcomeCampaignerEmail - sharing focus', () => {
    const email = welcomeCampaignerEmail({
      campaignerName: 'Alice',
      campaignTitle: 'Help Alice',
      campaignSlug: 'help-alice-123',
    });

    it('focuses on sharing, not review', () => {
      expect(email.subject).not.toContain('Review');
      expect(email.subject).not.toContain('Submitted');
    });

    it('links to campaign page, not verification', () => {
      expect(email.html).toContain('/campaigns/help-alice-123');
      expect(email.html).not.toContain('/verification');
    });

    it('includes sharing tips', () => {
      expect(email.html).toMatch(/Message 5 people/i);
    });

    it('explains why the first gift matters', () => {
      // Was 'first donation'; docs/94 says "gift" and explains the reason
      // rather than asserting a statistic we cannot source.
      expect(email.html).toMatch(/Give the first gift yourself/i);
      expect(email.html).toMatch(/Why the first gift matters/i);
    });

    it('does NOT request documents', () => {
      expect(email.html).not.toMatch(/government.issued/i);
      expect(email.html).not.toContain('passport');
    });
  });

  /*
    REVERSED 2026-10-17 (docs/78). This block used to assert that the admin
    email says the campaign is "live" and does NOT mention review, which
    was correct while creation published instantly. The owner chose to make
    the review claim true instead, so the admin email is now a request to
    review something nobody can see yet.
  */
  describe('campaignSubmittedEmail - review request', () => {
    const email = campaignSubmittedEmail({
      campaignTitle: 'Help Alice',
      creatorName: 'Alice',
      category: 'medical',
      goalAmount: 100000,
      campaignId: '00000000-0000-4000-a000-000000000001',
    });

    it('asks for a review', () => {
      expect(email.subject + email.html).toMatch(/review/i);
    });

    it('says the campaign is NOT public yet', () => {
      expect(email.html).toMatch(/not<\/strong>? ?public|not public/i);
    });

    it('does not tell an admin the campaign is already live', () => {
      expect(email.subject).not.toMatch(/\blive\b/i);
      expect(email.html).not.toMatch(/is <strong>active<\/strong> and live/i);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. NOTIFICATION FUNCTIONS - STATIC ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

describe('Notification functions - new lifecycle notifications', () => {
  const notifSource = readFileSync(resolve(ROOT, 'src/lib/notifications.ts'), 'utf-8');

  describe('notifyCreatorFirstDonation', () => {
    it('is exported', () => {
      expect(notifSource).toContain('export async function notifyCreatorFirstDonation');
    });

    it('uses campaign_donation_received type', () => {
      const fn = notifSource.match(/notifyCreatorFirstDonation[\s\S]*?type:\s*'([^']+)'/);
      expect(fn).not.toBeNull();
      expect(fn![1]).toBe('campaign_donation_received');
    });

    it('links to campaign page', () => {
      const fn = notifSource.match(/notifyCreatorFirstDonation[\s\S]*?link:\s*`([^`]+)`/);
      expect(fn).not.toBeNull();
      expect(fn![1]).toContain('/campaigns/');
    });

    it('handles anonymous donors', () => {
      expect(notifSource).toContain("p.isAnonymous ? 'An anonymous supporter' : p.donorName");
    });
  });

  describe('notifyCreatorCampaignCompleted', () => {
    it('is exported', () => {
      expect(notifSource).toContain('export async function notifyCreatorCampaignCompleted');
    });

    it('uses campaign_completed type', () => {
      const fn = notifSource.match(/notifyCreatorCampaignCompleted[\s\S]*?type:\s*'([^']+)'/);
      expect(fn).not.toBeNull();
      expect(fn![1]).toBe('campaign_completed');
    });

    it('links to campaign impact-update page', () => {
      const fn = notifSource.match(/notifyCreatorCampaignCompleted[\s\S]*?link:\s*`([^`]+)`/);
      expect(fn).not.toBeNull();
      expect(fn![1]).toContain('/dashboard/campaigns/');
      expect(fn![1]).toContain('/impact-update');
    });

    it('passes documentRequirementsHtml to email template', () => {
      expect(notifSource).toContain('documentRequirementsHtml: p.documentRequirementsHtml');
    });
  });

  describe('notifyVerificationReminder', () => {
    it('is exported', () => {
      expect(notifSource).toContain('export async function notifyVerificationReminder');
    });

    it('uses info_request type', () => {
      const fn = notifSource.match(/notifyVerificationReminder[\s\S]*?type:\s*'([^']+)'/);
      expect(fn).not.toBeNull();
      expect(fn![1]).toBe('info_request');
    });

    it('links to campaign verification page', () => {
      const fn = notifSource.match(/notifyVerificationReminder[\s\S]*?link:\s*`([^`]+)`/);
      expect(fn).not.toBeNull();
      expect(fn![1]).toContain('/verification');
    });

    it('has different title for final urgency', () => {
      expect(notifSource).toContain("p.urgencyLevel === 'final'");
      expect(notifSource).toContain('Last Reminder');
    });
  });

  describe('updated notifyWelcomeCampaigner', () => {
    it('takes campaignSlug parameter', () => {
      expect(notifSource).toContain('campaignSlug');
      // Verify the welcome function references campaignSlug
      const fn = notifSource.match(/notifyWelcomeCampaigner[\s\S]*?campaignSlug/);
      expect(fn).not.toBeNull();
    });

    it('links to campaign page, not verification', () => {
      const fn = notifSource.match(/notifyWelcomeCampaigner[\s\S]*?link:\s*`([^`]+)`/);
      expect(fn).not.toBeNull();
      expect(fn![1]).toContain('/campaigns/');
      expect(fn![1]).not.toContain('/verification');
    });
  });

  describe('imports new email templates', () => {
    it('imports firstDonationCelebrationEmail', () => {
      expect(notifSource).toContain('firstDonationCelebrationEmail');
    });

    it('imports campaignCompletedCreatorEmail', () => {
      expect(notifSource).toContain('campaignCompletedCreatorEmail');
    });

    it('imports verificationReminderEmail', () => {
      expect(notifSource).toContain('verificationReminderEmail');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. CAMPAIGN CREATION - INSTANT-LIVE
// ═══════════════════════════════════════════════════════════════════════════

/*
  REVERSED 2026-10-17 (docs/78): creation no longer publishes.

  What stays here is the one thing still true of the route's source and
  cheap to assert textually. Everything else this block used to grep for -
  the status, the publish stamp, the audit event, which notifications fire
  - is now asserted BEHAVIOURALLY in
  `src/app/api/v1/user-campaigns/review-gate.test.ts`, which drives the
  real route and inspects the row it tries to write.

  That is also the follow-up this file recorded for itself further down:
  source-text assertions break on every legitimate refactor. This block
  broke on a deliberate architecture change and told us nothing a
  behavioural test would not have told us better.
*/
describe('Campaign creation', () => {
  const routeSource = readFileSync(resolve(ROOT, 'src/app/api/v1/user-campaigns/route.ts'), 'utf-8');

  it('sets verificationStatus to unverified', () => {
    expect(routeSource).toContain("verificationStatus: 'unverified'");
  });

  it('does not publish on creation: see review-gate.test.ts for the rest', () => {
    expect(routeSource).toContain("status: 'under_review'");
    expect(routeSource).not.toMatch(/^\s+status: 'active',$/m);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. DONATION WEBHOOK - FIRST DONATION + COMPLETION TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════

describe('Donation webhook - lifecycle triggers', () => {
  const webhookSource = readFileSync(resolve(ROOT, 'src/lib/services/payment-service.ts'), 'utf-8');

  describe('transaction return values', () => {
    it('returns newRaised, goalAmount, justCompleted from transaction', () => {
      // Updated 2026-10-14: the P1-3 fix carries donorCount and isFirstDonation out of
      // the transaction so completion/first-donation are decided from RETURNING rather
      // than a stale pre-transaction read. The test drifted, not the code.
      // FOLLOW-UP: this whole file asserts payment-service SOURCE TEXT and so breaks on
      // every legitimate refactor (3rd time this session). Convert to behavioural tests.
      expect(webhookSource).toContain('return { newRaised, goalAmount, justCompleted, donorCount: newDonorCount, isFirstDonation, donationId }');
    });

    it('checks for duplicate (null txResult)', () => {
      expect(webhookSource).toContain('if (!txResult) return');
    });

    it('destructures transaction result', () => {
      // `newRaised` is bound as `_newRaised` where it is unused; assert the
      // destructuring shape rather than one spelling of the alias.
      expect(webhookSource).toMatch(
        /const \{[^}]*newRaised[^}]*goalAmount[^}]*justCompleted[^}]*\} = txResult/,
      );
    });
  });

  describe('first donation trigger', () => {
    it('detects first donation via campaign.donorCount === 0', () => {
      expect(webhookSource).toContain('campaign.donorCount === 0');
    });

    it('calls notifyCreatorFirstDonation', () => {
      expect(webhookSource).toContain('notifyCreatorFirstDonation(');
    });

    it('imports notifyCreatorFirstDonation', () => {
      const importLine = webhookSource.match(/import\s*\{[^}]*notifyCreatorFirstDonation[^}]*\}\s*from/);
      expect(importLine).not.toBeNull();
    });

    it('fetches creator for first donation notification', () => {
      // After donorCount === 0 check, it fetches the creator
      const afterFirstDonation = webhookSource.indexOf('campaign.donorCount === 0');
      const fetchCreator = webhookSource.indexOf('users.id, email: users.email, name: users.name', afterFirstDonation);
      expect(fetchCreator).toBeGreaterThan(afterFirstDonation);
    });
  });

  describe('campaign completion trigger', () => {
    it('tracks justCompleted flag in transaction', () => {
      expect(webhookSource).toContain('let justCompleted = false');
      expect(webhookSource).toContain('justCompleted = true');
    });

    it('triggers completion notification when justCompleted', () => {
      expect(webhookSource).toContain('if (justCompleted && creator)');
    });

    it('calls notifyCreatorCampaignCompleted', () => {
      expect(webhookSource).toContain('notifyCreatorCampaignCompleted(');
    });

    it('imports notifyCreatorCampaignCompleted', () => {
      const importLine = webhookSource.match(/import\s*\{[^}]*notifyCreatorCampaignCompleted[^}]*\}\s*from/);
      expect(importLine).not.toBeNull();
    });

    it('generates document requirements HTML for completion email', () => {
      expect(webhookSource).toContain('formatDocumentRequirementsHtml(');
    });

    it('imports formatDocumentRequirementsHtml', () => {
      expect(webhookSource).toContain("from '@/lib/document-requirements'");
    });
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 8. CONGRATULATIONS PAGE
// ═══════════════════════════════════════════════════════════════════════════

describe('Congratulations page', () => {
  const pageSource = readFileSync(
    resolve(ROOT, 'src/app/campaigns/[slug]/congratulations/page.tsx'),
    'utf-8',
  );
  const clientSource = readFileSync(
    resolve(ROOT, 'src/app/campaigns/[slug]/congratulations/client.tsx'),
    'utf-8',
  );

  describe('server component (page.tsx)', () => {
    it('is auth-gated', () => {
      expect(pageSource).toContain("redirect(`/login");
    });

    it('fetches campaign by slug and creator match', () => {
      expect(pageSource).toContain('eq(campaigns.slug, slug)');
      expect(pageSource).toContain('eq(campaigns.creatorId, session.user.id)');
    });

    it('returns 404 if campaign not found or not owned', () => {
      expect(pageSource).toContain('notFound()');
    });

    it('sets noindex robots directive', () => {
      expect(pageSource).toContain('index: false');
    });

    it('has correct page title', () => {
      expect(pageSource).toContain('Your Campaign Is Live!');
    });
  });

  describe('client component (client.tsx)', () => {
    it('is a client component', () => {
      expect(clientSource).toContain("'use client'");
    });

    it('has copy link functionality', () => {
      expect(clientSource).toContain('clipboard');
      expect(clientSource).toContain('setCopied');
    });

    it('has social sharing platform buttons', () => {
      expect(clientSource).toContain('facebook');
      expect(clientSource).toContain('whatsapp');
    });

    it('uses CampaignHeroImage component', () => {
      expect(clientSource).toContain('CampaignHeroImage');
    });

    it('links to campaign view page', () => {
      expect(clientSource).toContain('View');
      expect(clientSource).toContain('campaign.slug');
    });

    it('links to dashboard', () => {
      expect(clientSource).toContain('/dashboard');
    });

    it('renders the goal in the CAMPAIGN’s currency, not hardcoded dollars', () => {
      /*
        ⚠️ THIS ASSERTION WAS STALE, AND IT PINNED A DEFECT.

        It used to require `centsToDollars`, which hardcodes USD. Every
        amount column on this platform is an INTEGER in the minor units of
        its OWN row's currency (`docs/92`), so on the only campaigns that
        have ever taken money - two KES donations - this screen told the
        organiser their shilling goal in dollars. Same shape as the
        `?launched=true` assertion lower in this file: a test reading source
        text kept the wrong behaviour green.

        The fixed component renders through `<Money>` and is HANDED the
        currency by the server component, so the two halves are asserted
        together: the client must not print a currency of its own choosing.
      */
      expect(clientSource).not.toContain('centsToDollars');
      expect(clientSource).toContain('<Money');
      expect(clientSource).toContain('currency={campaign.currency}');
      // The page must actually supply it, or the prop above is `undefined`.
      expect(pageSource).toContain('currency: campaigns.currency');
      expect(pageSource).toContain('currency: campaign.currency');
    });

    it('shows category label', () => {
      expect(clientSource).toContain('CATEGORY_LABELS');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. FORM REDIRECT
// ═══════════════════════════════════════════════════════════════════════════

describe('ShareYourStoryForm - post-submit redirect', () => {
  /*
    ⚠️ THIS BLOCK WAS STALE, AND IT HELD THE DEFECT IN PLACE.

    It used to assert `formSource` contains `?launched=true` - pinning the
    instant-live redirect to `/campaigns/<slug>` that this whole file is named
    after. `docs/78` and `docs/79` replaced that architecture: the insert is
    `under_review` with `published_at: null`, and the public page does not
    serve that status, so every organiser who finished the wizard landed on a
    **404**. The test passed throughout, because it read the source text and
    the source still carried the old redirect.

    Section 5 of this file had already been reconciled (it asserts the route
    does NOT insert `status: 'active'`). This section had not, so the file
    asserted both halves of a contradiction. See `docs/109`.

    The real invariant - that the redirect target must be able to render the
    status the route inserts - is in
    `src/app/share-your-story/submit-redirect.test.ts`, which derives both
    ends from source instead of hard-coding either.
  */
  /*
    Comments stripped, because the file now EXPLAINS the old redirect in prose
    and a raw-text assertion trips on the explanation. A text test that cannot
    tell code from a comment is the `docs/101` trap in miniature.
  */
  const formSource = readFileSync(
    resolve(ROOT, 'src/app/share-your-story/ShareYourStoryForm.tsx'),
    'utf-8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('redirects to the organiser dashboard, not the public campaign page', () => {
    expect(formSource).toContain('router.push(');
    expect(formSource).toContain('/dashboard/campaigns?submitted=1');
  });

  it('⛔ does not send the organiser to a page their campaign cannot have yet', () => {
    expect(formSource).not.toMatch(/router\.push\([^)]*\/campaigns\/\$\{/);
    expect(formSource).not.toContain('?launched=true');
  });

  it('does not redirect to congratulations page', () => {
    expect(formSource).not.toContain('/congratulations');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. CROSS-CUTTING ARCHITECTURAL INVARIANTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Open redirect protection', () => {
  const loginSource = readFileSync(resolve(ROOT, 'src/app/login/page.tsx'), 'utf-8');
  const registerSource = readFileSync(resolve(ROOT, 'src/app/register/page.tsx'), 'utf-8');

  const ORIGIN = 'https://lastdonor.org';

  /**
   * `safeCallbackUrl` is duplicated in the login and register pages (both are
   * client components and neither exports it), so rather than assert on source
   * text we lift the real function out of each file, compile it and exercise
   * it. Source-text assertions are what let the backslash bypass survive: the
   * old tests checked that `startsWith('/')` and `startsWith('//')` appeared,
   * and both of those checks pass `/\evil.com`.
   */
  function loadSafeCallbackUrl(file: string): (raw: string | null) => string {
    const source = readFileSync(resolve(ROOT, file), 'utf-8');
    const fn = source.match(/^function safeCallbackUrl\([\s\S]*?^}/m);
    if (!fn) throw new Error(`safeCallbackUrl not found in ${file}`);
    const js = transformSync(`${fn[0]}\nreturn safeCallbackUrl;`, {
      loader: 'ts',
    }).code;
    return new Function(js)() as (raw: string | null) => string;
  }

  const implementations = [
    ['login', loadSafeCallbackUrl('src/app/login/page.tsx')],
    ['register', loadSafeCallbackUrl('src/app/register/page.tsx')],
  ] as const;

  /**
   * Payloads that a browser resolves OFF our origin. `/\evil.com` is the one
   * that shipped: it starts with '/', does not start with '//', and
   * `new URL('/\\evil.com', 'https://lastdonor.org').href` is
   * `https://evil.com/`.
   */
  const OFF_ORIGIN_PAYLOADS = [
    '/\\evil.com',
    '/\\/evil.com',
    '\\\\evil.com',
    '//evil.com',
    '///evil.com',
    '/\\\\evil.com',
    'https://evil.com/x',
    'http://evil.com',
    '//evil.com/dashboard',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ];

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN },
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('login page uses safeCallbackUrl to sanitize redirect', () => {
    expect(loginSource).toContain('safeCallbackUrl');
  });

  it('register page uses safeCallbackUrl to sanitize redirect', () => {
    expect(registerSource).toContain('safeCallbackUrl');
  });

  for (const [name, safeCallbackUrl] of implementations) {
    describe(`${name} page safeCallbackUrl()`, () => {
      it.each(OFF_ORIGIN_PAYLOADS)('rejects %j', (payload) => {
        // Sanity check the payload really is dangerous before the assertion,
        // so a browser-behaviour change cannot quietly make this vacuous.
        let resolved: URL | null = null;
        try {
          resolved = new URL(payload, ORIGIN);
        } catch {
          resolved = null;
        }
        if (resolved) expect(resolved.origin).not.toBe(ORIGIN);

        expect(safeCallbackUrl(payload)).toBe('/dashboard');
      });

      it('never returns a value that resolves off this origin', () => {
        const probes = [
          ...OFF_ORIGIN_PAYLOADS,
          'https:evil.com',
          'HTTPS://EVIL.COM',
          '/dashboard',
          '',
          null,
        ];
        for (const probe of probes) {
          const out = safeCallbackUrl(probe);
          expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
        }
      });

      it('treats a scheme-only absolute URL as a same-origin path', () => {
        // `https:evil.com` resolves to https://lastdonor.org/evil.com, which is
        // harmless, but it must not escape the origin.
        expect(new URL(safeCallbackUrl('https:evil.com'), ORIGIN).origin).toBe(ORIGIN);
      });

      it('preserves a same-origin path with its query string and hash', () => {
        expect(safeCallbackUrl('/dashboard/campaigns?status=active&page=3')).toBe(
          '/dashboard/campaigns?status=active&page=3',
        );
        expect(safeCallbackUrl('/dashboard/campaigns?a=1#top')).toBe(
          '/dashboard/campaigns?a=1#top',
        );
      });

      it('allows an absolute URL on our own origin, reduced to a path', () => {
        expect(safeCallbackUrl(`${ORIGIN}/dashboard/supported?x=1`)).toBe(
          '/dashboard/supported?x=1',
        );
      });

      it('falls back to /dashboard for empty input', () => {
        expect(safeCallbackUrl(null)).toBe('/dashboard');
        expect(safeCallbackUrl('')).toBe('/dashboard');
      });

      it('is safe when there is no window (SSR)', () => {
        delete (globalThis as { window?: unknown }).window;
        expect(safeCallbackUrl('/\\evil.com')).toBe('/dashboard');
        expect(safeCallbackUrl('https://evil.com/x')).toBe('/dashboard');
        expect(safeCallbackUrl('/dashboard?page=2')).toBe('/dashboard?page=2');
      });
    });
  }

  it('does not rely on string-prefix checks alone', () => {
    for (const source of [loginSource, registerSource]) {
      const fn = source.match(/^function safeCallbackUrl\([\s\S]*?^}/m)![0];
      expect(fn).toContain('new URL(');
      expect(fn).toContain('.origin');
    }
  });
});

describe('Login failure UI is reachable (audit: dead error branches)', () => {
  const loginSource = readFileSync(resolve(ROOT, 'src/app/login/page.tsx'), 'utf-8');
  const authSource = readFileSync(resolve(ROOT, 'src/lib/auth.ts'), 'utf-8');

  /** Every code `src/lib/auth.ts` can actually throw. */
  const emittedCodes = [
    ...authSource.matchAll(/code\s*=\s*'([a-z_]+)'/g),
  ].map((m) => m[1]);

  it('auth.ts emits exactly invalid_credentials and password_reset_required', () => {
    expect([...new Set(emittedCodes)].sort()).toEqual([
      'invalid_credentials',
      'password_reset_required',
    ]);
  });

  it('login page branches on no code that auth.ts cannot emit', () => {
    // These four were removed from auth.ts as an enumeration oracle (docs/32);
    // the login page kept switching on them, so every real failure fell
    // through to the "unexpected error" branch.
    for (const dead of ['no_account', 'oauth_only', 'invalid_password', 'account_locked']) {
      expect(loginSource).not.toContain(dead);
    }
    expect(loginSource).not.toContain('An unexpected error occurred');
  });

  /**
   * Updated 2026-10-15 (docs/46). The page used to render ONE message for
   * every failure other than a forced reset. That collapsed two opposite
   * instructions into one sentence: observed live, a wrong password and a
   * database outage produced the identical string. The split is now on the
   * server's failure mode (`invalid_credentials` vs anything else), never on
   * anything about the account, so the enumeration control in docs/32 is
   * untouched - see `src/lib/auth.enumeration.test.ts`.
   */
  it('renders a credential message and a distinct transient message', () => {
    expect(loginSource).toContain(
      'Incorrect email or password. Check both, or continue with Google.',
    );
    expect(loginSource).toContain(
      "We couldn't sign you in right now. Please try again shortly.",
    );
    expect(loginSource).toContain("code === 'invalid_credentials'");
    expect(loginSource).toContain("code === 'password_reset_required'");
  });

  it('keeps the password-reset route and the Google button on the failure path', () => {
    expect(loginSource).toContain('/login/forgot-password');
    expect(loginSource).toContain('handleGoogleSignIn');
  });
});

describe('OAuth error codes render an explanation', () => {
  const loginSource = readFileSync(resolve(ROOT, 'src/app/login/page.tsx'), 'utf-8');

  function loadOauthErrorMessage(): (
    code: string | null,
    credentialsCode?: string | null,
  ) => string | null {
    const map = loginSource.match(
      /^const INVALID_CREDENTIALS_MESSAGE[\s\S]*?^function oauthErrorMessage\([\s\S]*?^}/m,
    );
    if (!map) throw new Error('oauthErrorMessage not found in login page');
    const js = transformSync(`${map[0]}\nreturn oauthErrorMessage;`, {
      loader: 'ts',
    }).code;
    return new Function(js)() as (
      code: string | null,
      credentialsCode?: string | null,
    ) => string | null;
  }

  const oauthErrorMessage = loadOauthErrorMessage();

  it('reads the error param, not only callbackUrl', () => {
    expect(loginSource).toContain("searchParams.get('error')");
  });

  it('explains OAuthAccountNotLinked instead of rendering a blank page', () => {
    const message = oauthErrorMessage('OAuthAccountNotLinked');
    expect(message).toBe(
      'This email already has a LastDonor password. Sign in with your password below.',
    );
  });

  it('keeps the credentials-redirect path non-disclosing too', () => {
    // The redirect path carries ?error=CredentialsSignin&code=<code>, so it
    // gets the same two-way split as the inline path.
    expect(oauthErrorMessage('CredentialsSignin', 'invalid_credentials')).toBe(
      'Incorrect email or password. Check both, or continue with Google.',
    );
    expect(oauthErrorMessage('CredentialsSignin', 'credentials')).toBe(
      "We couldn't sign you in right now. Please try again shortly.",
    );
    // No code at all is a provider fault, not a typo.
    expect(oauthErrorMessage('CredentialsSignin')).toBe(
      "We couldn't sign you in right now. Please try again shortly.",
    );
  });

  it('returns actionable copy for every other NextAuth error code', () => {
    for (const code of [
      'OAuthCallbackError',
      'AccessDenied',
      'Verification',
      'OAuthSignin',
      'Configuration',
      'SomethingNextAuthAddsLater',
    ]) {
      const message = oauthErrorMessage(code);
      expect(message, code).toBeTruthy();
      expect(message!.length, code).toBeGreaterThan(20);
      // Actionable: always names a way forward.
      expect(message!.toLowerCase(), code).toMatch(/try again|password/);
    }
  });

  it('returns nothing when there is no error param', () => {
    expect(oauthErrorMessage(null)).toBeNull();
  });

  it('does not enable allowDangerousEmailAccountLinking as the cure', () => {
    const authSource = readFileSync(resolve(ROOT, 'src/lib/auth.ts'), 'utf-8');
    expect(authSource).not.toContain('allowDangerousEmailAccountLinking');
  });
});

describe('callbackUrl is carried from every sign-in entry point', () => {
  const middlewareSource = readFileSync(resolve(ROOT, 'src/middleware.ts'), 'utf-8');
  const navbarSource = readFileSync(resolve(ROOT, 'src/components/layout/Navbar.tsx'), 'utf-8');
  const messageFormSource = readFileSync(
    resolve(ROOT, 'src/components/campaign/MessageForm.tsx'),
    'utf-8',
  );

  it('middleware preserves the query string in callbackUrl', () => {
    // `pathname` alone turned /dashboard/campaigns?status=active&page=3 into
    // /dashboard/campaigns.
    const redirect = middlewareSource.match(
      /const callbackTarget[\s\S]{0,400}?NextResponse\.redirect\([\s\S]*?\);/,
    );
    expect(redirect).not.toBeNull();
    expect(redirect![0]).toContain('request.nextUrl.search');
    expect(middlewareSource).not.toContain('encodeURIComponent(pathname)');
  });

  it('the navbar sign-in links carry pathname and search', () => {
    expect(navbarSource).toContain('useSearchParams');
    expect(navbarSource).toContain('callbackUrl=');
    // Only one bare sign-in link is left: the Suspense prerender fallback.
    const bare = [...navbarSource.matchAll(/<Link\s+href="\/login"/g)];
    expect(bare.length).toBe(1);
    expect(navbarSource).toContain('<SignInLink');
  });

  it('MessageForm uses callbackUrl, the only param the login page reads', () => {
    expect(messageFormSource).not.toContain('/login?redirect=');
    expect(messageFormSource).toContain('/login?callbackUrl=');
  });
});

describe('Architectural invariants', () => {
  const notifSource = readFileSync(resolve(ROOT, 'src/lib/notifications.ts'), 'utf-8');
  const templateSource = readFileSync(resolve(ROOT, 'src/lib/email-templates.ts'), 'utf-8');

  it('welcome email focuses on sharing, not verification', () => {
    const fnMatch = templateSource.match(/function welcomeCampaignerEmail[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).not.toContain('/verification');
  });

  it('verification requests only happen post-completion (campaignCompletedCreatorEmail)', () => {
    // campaignCompletedCreatorEmail should reference verification
    const completedIdx = templateSource.indexOf('function campaignCompletedCreatorEmail');
    expect(completedIdx).toBeGreaterThan(-1);
    const completedFnBody = templateSource.slice(completedIdx, completedIdx + 3000);
    expect(completedFnBody).toContain('/verification');

    // verificationReminderEmail should reference verification
    const reminderIdx = templateSource.indexOf('function verificationReminderEmail');
    expect(reminderIdx).toBeGreaterThan(-1);
    const reminderFnBody = templateSource.slice(reminderIdx, reminderIdx + 3000);
    expect(reminderFnBody).toContain('/verification');
  });

  it('payout flow: campaign completion → verification → review → withdrawal', () => {
    // 1. On completion: → impact-update page link
    const completionFn = notifSource.match(/notifyCreatorCampaignCompleted[\s\S]*?link:\s*`([^`]+)`/);
    expect(completionFn![1]).toContain('/impact-update');

    // 2. Reminder: → verification page
    const reminderFn = notifSource.match(/notifyVerificationReminder[\s\S]*?link:\s*`([^`]+)`/);
    expect(reminderFn![1]).toContain('/verification');
  });
});
