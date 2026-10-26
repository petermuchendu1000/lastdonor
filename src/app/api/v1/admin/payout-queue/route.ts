/**
 * Campaigns designated to an institution, and what stands between each one
 * and being paid (`docs/113` §11, screen D1).
 *
 * ⛔ READ-ONLY. There is no POST, no "send", and no code path from this file
 * to a payment. `resolvePayoutRail()` returns null and the UI prints why.
 * Sending is the one thing `docs/113` §8 and §10.4 leave for later: it needs
 * a probed rail and an answer to the licensing question in §5.
 *
 * ⚠️ Every figure this returns is expected to be **zero** today. Money has
 * never left this platform - `campaign_withdrawals` has 0 rows, there are 0
 * Connect accounts, and 0 campaigns are verified enough to withdraw
 * (`docs/113` §2). A screen that showed plausible numbers here would be
 * lying about the state of production.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import {
  campaignPayoutDesignations,
  campaigns,
  institutionPayoutAccounts,
  trustedInstitutions,
} from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { NO_RAIL_REASON, resolvePayoutRail } from '@/lib/institutional-payout/rail';
import type { ApiError } from '@/types/api';

const PAGE_LIMIT = 200;

export async function GET(_request: NextRequest) {
  const requestId = randomUUID();
  try {
    await requireRole(['admin']);

    /*
      ONE query. `docs/87` caps a request at three concurrent queries and the
      admin layout's `auth()` already takes a connection from a pool of five;
      `docs/88` F8 is the screen that fetched a whole table and tallied it in
      JS, so the join does the work here.
    */
    const rows = await db
      .select({
        designationId: campaignPayoutDesignations.id,
        campaignId: campaigns.id,
        campaignTitle: campaigns.title,
        campaignSlug: campaigns.slug,
        campaignStatus: campaigns.status,
        verificationStatus: campaigns.verificationStatus,
        currency: campaigns.currency,
        /*
          ⚠️ `raised_amount` is blended with fabricated seed money
          (`docs/101`), so it is NOT what anybody would be paid. It is
          labelled on the screen as the headline figure, and the real
          payable amount is deliberately absent until a rail exists to pay
          it - inventing one here would be the first lie on a money screen.
        */
        headlineRaisedMinor: campaigns.raisedAmount,
        accountReference: campaignPayoutDesignations.accountReference,
        designatedAt: campaignPayoutDesignations.designatedAt,
        lockedAt: campaignPayoutDesignations.lockedAt,
        institutionName: trustedInstitutions.name,
        institutionKind: trustedInstitutions.kind,
        accountIdentifier: institutionPayoutAccounts.accountIdentifier,
        accountReferenceLabel: institutionPayoutAccounts.accountReferenceLabel,
        rail: institutionPayoutAccounts.rail,
      })
      .from(campaignPayoutDesignations)
      .innerJoin(campaigns, eq(campaigns.id, campaignPayoutDesignations.campaignId))
      .innerJoin(
        institutionPayoutAccounts,
        eq(institutionPayoutAccounts.id, campaignPayoutDesignations.payoutAccountId),
      )
      .innerJoin(
        trustedInstitutions,
        eq(trustedInstitutions.id, institutionPayoutAccounts.institutionId),
      )
      .where(eq(campaignPayoutDesignations.status, 'active'))
      .orderBy(desc(campaignPayoutDesignations.designatedAt))
      .limit(PAGE_LIMIT);

    const rail = resolvePayoutRail();

    return NextResponse.json({
      ok: true,
      data: {
        rows,
        /*
          The screen must say WHY nothing can be sent, not merely disable a
          button. `docs/88` F9 is the admin page that was inert and did not
          say so, and took 15.8s to render an error boundary inside a 200.
        */
        rail: rail ? { name: rail.name, available: true } : { available: false, reason: NO_RAIL_REASON },
        /*
          A cap and a count, because `docs/88` F16 found all eight capped
          admin lists stating two totals at once.
        */
        limit: PAGE_LIMIT,
        loaded: rows.length,
      },
    });
  } catch (error) {
    const name = (error as Error).name;
    if (name === 'UnauthorizedError') {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if (name === 'ForbiddenError') {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error('GET payout-queue error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
