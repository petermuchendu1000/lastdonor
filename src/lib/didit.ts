/**
 * Didit ID verification.
 *
 * Replaces Stripe Identity as the identity-verification provider. See
 * `docs/81` for why, and for what was rejected.
 *
 * ── Which API version, and why ────────────────────────────────────────────
 *
 * Didit exposes two. Probed against the live service with this account's
 * key on 2026-10-17:
 *
 *   POST /v2/session/   -> 400 {"workflow_id":["This field is required."]}
 *   POST /v1/session/   -> 201, session created
 *   GET  /v1/session/<id>/decision/ -> 200
 *   GET  /v1/workflows/ -> 404   (and /v2/workflows/ -> 404)
 *
 * v2 is the newer, workflow-based API: a workflow is configured in the
 * Didit console and its id passed on every create. We have no workflow id
 * and no endpoint to discover one, so **v2 cannot be exercised at all from
 * here** — writing a v2 branch would mean shipping a code path never once
 * executed. v1 works end to end and returns the features this product
 * needs (`OCR + LIVENESS + FACE_MATCH + IP_ANALYSIS`), so v1 is what ships.
 *
 * To move to v2 later: create a workflow in the console, set
 * `DIDIT_WORKFLOW_ID`, and add the v2 calls **with the same probe-first
 * discipline** — confirm each endpoint and its response shape against the
 * live service before wiring it to anything.
 */

const DIDIT_BASE = 'https://verification.didit.me/v1';

/** Didit's own status vocabulary, as returned by the decision endpoint. */
export type DiditStatus =
  | 'Not Started'
  | 'In Progress'
  | 'In Review'
  | 'Approved'
  | 'Declined'
  | 'Abandoned'
  | 'Expired';

export interface DiditSession {
  sessionId: string;
  /** The hosted page the person is sent to. */
  url: string;
  status: DiditStatus;
}

export interface DiditDecision {
  sessionId: string;
  status: DiditStatus;
  /** Whatever we attached at creation, used to tie the session to a campaign. */
  vendorData: string | null;
  /**
   * The person's name as read off their identity document, when Didit
   * supplies one. Null whenever it is absent, which is every status before
   * `Approved` and possibly after - see `readVerifiedName`.
   *
   * This is the ONLY trustworthy name the platform has. `users.name` is
   * self-declared, so comparing a document against it proves nothing:
   * whoever uploaded the document also typed the name.
   */
  verifiedName: string | null;
}

/**
 * The shape of a decision response, as PROBED on 2026-10-24.
 *
 * A real (not-started) session returned exactly these top-level keys:
 *
 *   session_id, session_number, session_url, status, vendor_data, callback,
 *   features, kyc, aml, face, location, poa, phone, email, kyb, warnings,
 *   user_href, reviews, extra_images, questionnaire, document_ai_documents,
 *   environment, sandbox_scenario, created_at, expires_at
 *
 * `features` was `["ID_VERIFICATION","LIVENESS","FACE_MATCH","IP_ANALYSIS"]`
 * and the create response described the workflow as
 * `"OCR + LIVENESS + FACE_MATCH + IP_ANALYSIS"` - so Didit DOES read the ID,
 * and the result belongs under `kyc`.
 *
 * ⚠️ `kyc` was **null**, because the session had not been completed, so the
 * KEYS INSIDE IT ARE UNVERIFIED. Populating it needs a real person finishing
 * the hosted flow, which cannot be done from a sandbox. `readVerifiedName`
 * therefore tries several conventional shapes AND REPORTS WHAT IT ACTUALLY
 * FOUND, so the first real session answers the question in the logs instead
 * of leaving it to be guessed again.
 */
const NAME_KEY_CANDIDATES = ['full_name', 'name', 'legal_name'] as const;
const FIRST_KEY_CANDIDATES = ['first_name', 'given_name', 'given_names', 'forenames'] as const;
const LAST_KEY_CANDIDATES = ['last_name', 'surname', 'family_name'] as const;

function pickString(source: Record<string, unknown>, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'string' && v.trim()) return { key, value: v.trim() };
  }
  return null;
}

/**
 * Extract the ID name from a decision payload, and say where it came from.
 *
 * Returns the name plus the key path it was read from, so the caller can log
 * it once. An unrecognised shape returns the keys that WERE present, which is
 * the information needed to fix this properly rather than guess again.
 */
export function readVerifiedName(data: Record<string, unknown>): {
  name: string | null;
  source: string;
} {
  const kyc = data.kyc;
  if (!kyc || typeof kyc !== 'object') {
    return { name: null, source: 'kyc absent or null' };
  }
  const obj = kyc as Record<string, unknown>;

  const whole = pickString(obj, NAME_KEY_CANDIDATES);
  if (whole) return { name: whole.value, source: `kyc.${whole.key}` };

  const first = pickString(obj, FIRST_KEY_CANDIDATES);
  const last = pickString(obj, LAST_KEY_CANDIDATES);
  if (first && last) return { name: `${first.value} ${last.value}`, source: `kyc.${first.key} + kyc.${last.key}` };
  if (last) return { name: last.value, source: `kyc.${last.key}` };
  if (first) return { name: first.value, source: `kyc.${first.key}` };

  // Nothing recognised. Report the shape, NOT the values: these are the
  // fields of someone's identity document and must not reach a log.
  return { name: null, source: `kyc present, no known name key; keys=[${Object.keys(obj).sort().join(',')}]` };
}

function apiKey(): string {
  const key = process.env.DIDIT_API_KEY;
  if (!key) {
    // Thrown, not defaulted: a verification provider that silently does
    // nothing is worse than one that is plainly unavailable. The route
    // above turns this into a 503 the person can act on.
    throw new DiditNotConfiguredError();
  }
  return key;
}

export class DiditNotConfiguredError extends Error {
  constructor() {
    super('DIDIT_API_KEY is not set; identity verification is unavailable.');
    this.name = 'DiditNotConfiguredError';
  }
}

export class DiditApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    // The body is Didit's validation detail, never our key.
    super(`Didit API error ${status}: ${body.slice(0, 300)}`);
    this.name = 'DiditApiError';
  }
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${DIDIT_BASE}${path}`, {
    ...init,
    headers: {
      'x-api-key': apiKey(),
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    // A person is waiting on a redirect; do not hang the request thread.
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  if (!res.ok) throw new DiditApiError(res.status, text);

  try {
    return JSON.parse(text);
  } catch {
    throw new DiditApiError(res.status, `non-JSON response: ${text.slice(0, 200)}`);
  }
}

/**
 * Start a verification and get the hosted URL to send the person to.
 *
 * `vendorData` is Didit's passthrough field and is the ONLY thing tying a
 * returning webhook back to a campaign, so it always carries the campaign
 * id. Verified present on the create response and echoed on the decision
 * response.
 */
export async function createDiditSession(opts: {
  campaignId: string;
  callbackUrl: string;
}): Promise<DiditSession> {
  const data = (await call('/session/', {
    method: 'POST',
    body: JSON.stringify({
      vendor_data: opts.campaignId,
      callback: opts.callbackUrl,
    }),
  })) as Record<string, unknown>;

  const sessionId = typeof data.session_id === 'string' ? data.session_id : null;
  const url = typeof data.url === 'string' ? data.url : null;
  if (!sessionId || !url) {
    throw new DiditApiError(200, `create returned no session_id/url: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return { sessionId, url, status: (data.status as DiditStatus) ?? 'Not Started' };
}

/** Ask Didit what it decided. The webhook is a hint; this is the source of truth. */
export async function getDiditDecision(sessionId: string): Promise<DiditDecision> {
  const data = (await call(`/session/${encodeURIComponent(sessionId)}/decision/`, {
    method: 'GET',
  })) as Record<string, unknown>;

  const { name, source } = readVerifiedName(data);
  if (!name) {
    // Logged at info, once per decision fetch, because the keys inside `kyc`
    // are the one thing about this integration that could not be probed.
    console.info(`[didit] no verified name read: ${source}`);
  }

  return {
    sessionId: (data.session_id as string) ?? sessionId,
    status: (data.status as DiditStatus) ?? 'Not Started',
    vendorData: typeof data.vendor_data === 'string' ? data.vendor_data : null,
    verifiedName: name,
  };
}

/**
 * Map Didit's vocabulary onto `verification_status`.
 *
 * Only three outcomes move our state. "In Review" is Didit's manual-review
 * queue and is deliberately NOT mapped to `verified`: it means a human at
 * Didit has not finished, and treating it as a pass would publish an
 * unverified identity. Everything unresolved stays `pending`, which is the
 * state the campaign was already in.
 */
export function mapDiditStatus(
  status: DiditStatus,
): 'identity_verified' | 'rejected' | 'pending' {
  switch (status) {
    case 'Approved':
      return 'identity_verified';
    case 'Declined':
      return 'rejected';
    default:
      return 'pending';
  }
}

/** A decision Didit will not revisit on its own. */
export function isTerminal(status: DiditStatus): boolean {
  return status === 'Approved' || status === 'Declined' || status === 'Expired';
}
