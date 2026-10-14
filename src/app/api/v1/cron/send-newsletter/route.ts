import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  campaigns,
  newsletterSubscribers,
  auditLogs,
} from '@/db/schema';
import { eq, isNull, desc, sql } from 'drizzle-orm';
import { buildGenerateNewsletterPrompt } from '@/lib/ai/prompts/generate-newsletter';
import { callAI } from '@/lib/ai/call-ai';
import { resend } from '@/lib/resend';
import { logError } from '@/lib/errors';
import { verifyCronAuth } from '@/lib/cron-auth';
import crypto from 'crypto';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type NewsletterContent = {
  subject: string;
  preheader: string;
  featuredHtml: string;
  impactHtml: string;
  contextHtml: string;
};

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron authorization.' } }, { status: 401 });
  }

  // ── Overlap guard (P1-11, docs/26 §4) ──────────────────────────────────
  // TTL is derived from this route's maxDuration; see CRON_LOCKS for this job's
  // lock-backend-unavailable policy and why.
  const lockSpec = CRON_LOCKS['send-newsletter'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    // Find the hottest active campaign (most recent with most donations)
    const [featuredCampaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.status, 'active'))
      .orderBy(desc(campaigns.donorCount))
      .limit(1);

    if (!featuredCampaign) {
      return NextResponse.json({
        ok: true,
        data: { sent: 0, reason: 'No active campaigns to feature' },
      });
    }

    // Find recent completed campaign for impact section
    const [recentImpact] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.status, 'completed'))
      .orderBy(desc(campaigns.completedAt))
      .limit(1);

    // Count active subscribers
    const [{ count: subscriberCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(newsletterSubscribers)
      .where(isNull(newsletterSubscribers.unsubscribedAt));

    if (subscriberCount === 0) {
      return NextResponse.json({
        ok: true,
        data: { sent: 0, reason: 'No active subscribers' },
      });
    }

    // Generate newsletter content via AI
    const prompt = buildGenerateNewsletterPrompt({
      featuredCampaign: {
        title: featuredCampaign.title,
        subjectName: featuredCampaign.subjectName,
        category: featuredCampaign.category,
        raisedAmount: featuredCampaign.raisedAmount,
        goalAmount: featuredCampaign.goalAmount,
        slug: featuredCampaign.slug,
      },
      recentImpact: recentImpact
        ? {
            subjectName: recentImpact.subjectName,
            raisedAmount: recentImpact.raisedAmount,
            donorCount: recentImpact.donorCount,
          }
        : undefined,
      subscriberCount,
    });

    const content = await callAI<NewsletterContent>({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      promptType: 'generate-newsletter',
    });

    // Get all active subscriber emails
    const subscribers = await db
      .select({ id: newsletterSubscribers.id, email: newsletterSubscribers.email })
      .from(newsletterSubscribers)
      .where(isNull(newsletterSubscribers.unsubscribedAt));

    // Send via Resend in batches
    let sent = 0;
    const batchSize = 50;

    for (let i = 0; i < subscribers.length; i += batchSize) {
      const batch = subscribers.slice(i, i + batchSize);

      for (const subscriber of batch) {
        // Create signed unsubscribe token
        const unsubToken = createUnsubscribeToken(subscriber.id);
        const unsubUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lastdonor.org'}/api/v1/newsletter/unsubscribe?token=${unsubToken}`;

        try {
          await resend.emails.send({
            from: 'LastDonor.org <newsletter@lastdonor.org>',
            to: subscriber.email,
            subject: content.subject,
            html: buildNewsletterHtml(content, unsubUrl),
            headers: {
              'List-Unsubscribe': `<${unsubUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          });
          sent++;
        } catch (error) {
          console.error(`Failed to send to ${subscriber.email}:`, error);
        }
      }
    }

    await db.insert(auditLogs).values({
      eventType: 'cron.send_newsletter',
      severity: 'info',
      details: {
        sent,
        totalSubscribers: subscriberCount,
        subject: content.subject,
        featuredCampaign: featuredCampaign.slug,
      },
    });

    return NextResponse.json({ ok: true, data: { sent, totalSubscribers: subscriberCount } });
  } catch (error) {
    const requestId = crypto.randomUUID();
    logError(error, { requestId, route: '/api/v1/cron/send-newsletter', method: 'GET' });

    await db.insert(auditLogs).values({
      eventType: 'cron.send_newsletter',
      severity: 'error',
      details: { error: 'Newsletter processing failed', requestId },
    }).catch(() => {});

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Newsletter processing failed.', requestId } },
      { status: 500 },
    );
  } finally {
    await lock.lock.release();
  }
}

function createUnsubscribeToken(subscriberId: string): string {
  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  if (!secret) {
    throw new Error('NEWSLETTER_UNSUBSCRIBE_SECRET is not set - cannot generate unsubscribe tokens. Do not reuse NEXTAUTH_SECRET for this purpose.');
  }
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(subscriberId);
  const signature = hmac.digest('hex');
  return `${subscriberId}.${signature}`;
}

function buildNewsletterHtml(content: NewsletterContent, unsubUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="color-scheme" content="light"/>
  <title>${content.subject}</title>
  <style>
    body { margin: 0; padding: 0; background: #F8F6F2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1A1A1A; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: #0F766E; padding: 24px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 24px; margin: 0; font-family: 'DM Serif Display', Georgia, serif; }
    .section { padding: 24px; }
    .section h2 { font-size: 18px; margin: 0 0 12px; color: #0F766E; }
    .divider { border: none; border-top: 1px solid #E5E7EB; margin: 0; }
    .footer { padding: 24px; text-align: center; font-size: 12px; color: #6B7280; }
    .footer a { color: #0F766E; }
    .cta { display: inline-block; background: #D97706; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>LastDonor.org</h1>
    </div>
    <div class="section">
      <h2>Featured Campaign</h2>
      ${content.featuredHtml}
    </div>
    <hr class="divider"/>
    <div class="section">
      <h2>Impact Update</h2>
      ${content.impactHtml}
    </div>
    <hr class="divider"/>
    <div class="section">
      <h2>One Thing to Know</h2>
      ${content.contextHtml}
    </div>
    <hr class="divider"/>
    <div class="footer">
      <p>LastDonor.org - Every campaign has a last donor. Will it be you?</p>
      <p>1234 Main St, Suite 100, Washington, DC 20001</p>
      <p><a href="${unsubUrl}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`;
}
