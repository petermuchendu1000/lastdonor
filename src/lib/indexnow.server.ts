import 'server-only';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import {
  INDEXNOW_ENDPOINT,
  buildIndexNowSubmission,
  classifyIndexNowResponse,
  isIndexNowConfigurationFault,
  type IndexNowResult,
} from '@/lib/indexnow';

/**
 * Performing an IndexNow submission, and recording that it happened.
 *
 * The protocol itself is in `@/lib/indexnow`, which has no network and no
 * database so it can be tested in full. This file is the call - the same
 * split `facebook-rescrape.ts` uses.
 *
 * ## Why this writes an audit row
 *
 * The defect this whole feature addresses is that nothing told search
 * engines anything. A submission that silently failed would be the identical
 * defect one level down, and it would be invisible: `docs/123` found
 * `blog-generate` answering `200 {skipped:true}` for nine days because the
 * cron Worker logs the status and never reads the body, and `docs/136` §4.1
 * states the general form - *a job that writes nothing when idle is
 * indistinguishable from the database from one that never ran*.
 *
 * So every production attempt leaves a row. `invalid_key`, `invalid_request`
 * and `wrong_host` are recorded at `error` severity because they are
 * configuration defects that will repeat on every later submission;
 * everything else is transient and recorded at `info`.
 *
 * ⚠️ The event type is a LITERAL, never assembled from a variable.
 * `docs/139` §6.1 produced `impact_update.rejectd` in production by building
 * one with a template string, and `docs/137` §5 records that such a site is
 * invisible to the event-type sweep.
 */

/** Outbound deadline. A publication must not block on a search engine. */
const INDEXNOW_TIMEOUT_MS = 10_000;

/**
 * Submit URLs, never throwing.
 *
 * Callers fire this and do not await it, exactly as they already do with
 * `notifyCampaignStatusChange`, so a rejected promise would be an unhandled
 * rejection rather than a visible failure. Every path here resolves.
 *
 * ⛔ Guarded on `NODE_ENV === 'production'` and deliberately NOT on a feature
 * flag. `docs/123` is this project's record of a flag defaulting to off and
 * the pipeline being silent for nine days with nobody able to tell; an
 * operator cannot get `NODE_ENV` wrong, and there is no switch to forget.
 * The consequence is that the test and E2E suites - which really do publish
 * campaigns through this route - make no outbound call.
 */
export async function submitUrlsToIndexNow(
  urls: readonly string[],
  context: { campaignId?: string; reason: string },
): Promise<IndexNowResult> {
  const submission = buildIndexNowSubmission(urls);

  if (!submission) {
    return { outcome: 'error', detail: 'no submittable URLs', submittedCount: 0 };
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info(
      `[indexnow] skipped outside production: would submit ${submission.urlList.length} URL(s)`,
    );
    return {
      outcome: 'submitted',
      detail: 'skipped outside production',
      submittedCount: 0,
    };
  }

  let result: IndexNowResult;
  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(submission),
      signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
    });

    /*
      The body is JSON on every error we have observed and EMPTY on 200.
      `response.json()` throws on an empty body, so a failure to parse is
      "no body", never a failed submission - reading it as one would
      misreport the success case as an error.
    */
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    result = classifyIndexNowResponse(response.status, body, submission.urlList.length);
  } catch (err) {
    result = {
      outcome: 'error',
      detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
      submittedCount: 0,
    };
  }

  try {
    await db.insert(auditLogs).values({
      eventType: 'seo.indexnow_submitted',
      targetType: context.campaignId ? 'campaign' : null,
      targetId: context.campaignId ?? null,
      severity: isIndexNowConfigurationFault(result.outcome) ? 'error' : 'info',
      details: {
        outcome: result.outcome,
        detail: result.detail,
        submittedCount: result.submittedCount,
        urls: submission.urlList,
        reason: context.reason,
      },
    });
  } catch (err) {
    // An audit failure must not turn a successful submission into a crash.
    console.error('[indexnow] audit write failed:', err);
  }

  return result;
}
