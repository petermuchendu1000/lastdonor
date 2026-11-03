/**
 * IndexNow: telling search engines a URL changed, at the moment it changes.
 *
 * ## Why this exists
 *
 * `docs/27-TOOLING-STACK.md:164` chose IndexNow and nothing was ever built.
 * The consequence was measured on 2026-11-03 from Google Search Console and
 * from the codebase:
 *
 * - Google finds this site through the `Sitemap:` directive in
 *   `src/app/robots.ts`, which it reads out of robots.txt unprompted. That
 *   channel has always existed.
 * - **Every other engine has no channel at all.** There is no Bing
 *   verification file (`public/` held only `bimi-logo.svg`, `llms.txt`,
 *   fonts and images), no submission call anywhere in `src/`, and
 *   [VERIFIED] the only page on the web linking to this domain is the
 *   GitHub repository - so there are no inbound links to crawl either.
 *
 * One submission reaches Bing, Yandex, Seznam, Naver and Yep: the receiving
 * engine shares it with the others. ⛔ **Google does not participate**, and
 * nothing here should be described as helping Google - its channel is the
 * sitemap, and the owner submitted that by hand on 2026-11-03.
 *
 * ## The protocol, verified against the live API rather than recalled
 *
 * [VERIFIED 2026-11-03 by probe, with a fabricated-path control]:
 *
 * - `POST https://api.indexnow.org/indexnow`, `Content-Type:
 *   application/json; charset=utf-8`, body `{host, key, keyLocation,
 *   urlList}`. A well-formed body with a bad key reaches key validation and
 *   answers **403 `UserForbiddedToAccessSite`**; a body missing `urlList`
 *   is rejected at parse with **400 `InvalidRequestParameters`** and
 *   `"The urlList field is required."`. That pair is what confirms the field
 *   names - the server itself distinguishes them.
 * - ⚠️ A bare GET to ANY path on that host answers **400**, including
 *   `/definitely-not-a-real-path-control`. A path-existence probe run that
 *   way cannot discriminate and is void (`docs/135` §5). With full query
 *   parameters it does: `/indexnow` and `/IndexNow` answer 403 with a JSON
 *   API error, while `/submit-bulk` - which a third-party guide
 *   recommends - answers 400 with an Edge HTML error page, identical to the
 *   fabricated control. **`/submit-bulk` is not a real endpoint.**
 *
 * ## The invariant that makes or breaks it
 *
 * ⛔ **The key appears in three places and all three must agree**: the
 * filename `public/<key>.txt`, that file's contents, and the `key` field in
 * the payload. Any divergence answers 403 and submissions silently stop
 * working. `indexnow.test.ts` reads the file off disk and compares all
 * three, because this is exactly the kind of triple that drifts when
 * somebody rotates one of them.
 *
 * ⛔ **Every submitted URL must be on `INDEXNOW_HOST`**, or the request is
 * refused 422 as a whole - one foreign URL loses the entire batch. So
 * `buildIndexNowSubmission` filters rather than trusting its caller.
 *
 * ## What this module does not do
 *
 * No network and no database, so it can be unit-tested in full. The call
 * lives in `indexnow.server.ts`, the same split `facebook-rescrape.ts` uses.
 */

/**
 * The key. Public by design - it is served at `/<key>.txt` so engines can
 * verify we control the host, so there is nothing here to keep secret and
 * nothing that belongs in an environment variable.
 *
 * ⛔ Rotating it means renaming `public/<key>.txt` in the same commit.
 */
export const INDEXNOW_KEY = 'dbaa121132e753ce8af5cfc1905073b4';

/**
 * The canonical origin. Must equal `BASE_URL` in `src/app/sitemap.ts`:
 * IndexNow submits the same URLs the sitemap advertises, and a URL whose
 * host differs from the `host` field is refused 422.
 *
 * ⚠️ Deliberately NOT read from `NEXT_PUBLIC_APP_URL` or `NEXTAUTH_URL`.
 * Those resolve to `lastdonor.fly.dev` or a preview host in some
 * environments, and submitting a `fly.dev` URL under `host:
 * "lastdonor.org"` is the 422 case. `indexnow.test.ts` asserts the equality
 * against the sitemap's own source.
 */
export const INDEXNOW_ORIGIN = 'https://lastdonor.org';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** 8 to 128 characters, `a-z A-Z 0-9 -`. From the published specification. */
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/** Per-request ceiling from the specification. Nowhere near reachable here. */
export const INDEXNOW_MAX_URLS = 10_000;

/** Host only, no scheme - what the `host` field takes. */
export const INDEXNOW_HOST = new URL(INDEXNOW_ORIGIN).host;

/** `<key>.txt`, served from `public/` at the site root. */
export const INDEXNOW_KEY_FILENAME = `${INDEXNOW_KEY}.txt`;

/** Absolute URL of the key file, for the `keyLocation` field. */
export const INDEXNOW_KEY_LOCATION = `${INDEXNOW_ORIGIN}/${INDEXNOW_KEY_FILENAME}`;

/**
 * What happened to a submission.
 *
 * ⛔ `submitted` means **received**, never indexed. The specification is
 * explicit that 200 confirms receipt only, and this codebase does not get to
 * claim more than it knows (`docs/158`, `docs/160`, `docs/162`). Nothing
 * downstream may render this as "indexed".
 */
export type IndexNowOutcome =
  /** 200 - received. Not a statement about indexing. */
  | 'submitted'
  /** 202 - received, key validation still pending. Expected on a first call. */
  | 'pending_key_validation'
  /** 400 - our body was malformed. A defect here, not a transient failure. */
  | 'invalid_request'
  /** 403 - the key file is missing, unreachable, or does not contain the key. */
  | 'invalid_key'
  /** 422 - a URL is not on `host`, or the key breaks the schema. */
  | 'wrong_host'
  /** 429 - throttled. Retrying later is the correct response. */
  | 'rate_limited'
  /** Anything else, including a network failure with no response at all. */
  | 'error';

export interface IndexNowSubmission {
  readonly host: string;
  readonly key: string;
  readonly keyLocation: string;
  readonly urlList: readonly string[];
}

export interface IndexNowResult {
  readonly outcome: IndexNowOutcome;
  /** Safe to log. There is no secret in this protocol to redact. */
  readonly detail: string;
  readonly submittedCount: number;
}

/**
 * Is this a URL we are allowed to submit?
 *
 * Same host and HTTPS only. A URL on another host loses the whole batch to a
 * 422, so this is a filter and not an assertion - a caller that accidentally
 * includes one should still get the rest submitted.
 */
export function isSubmittableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.host === INDEXNOW_HOST;
}

/**
 * Build the payload, or `null` when there is nothing legitimate to send.
 *
 * Returning `null` rather than an empty `urlList` is deliberate: an empty
 * list is a 400 from the API (its own error names `urlList` as required), so
 * the caller must be able to tell "nothing to do" from "send this".
 *
 * Duplicates are removed because a republish calls this with the same URL set
 * as the first publication, and order is preserved so the changed page leads.
 */
export function buildIndexNowSubmission(
  urls: readonly string[],
): IndexNowSubmission | null {
  const seen = new Set<string>();
  const urlList: string[] = [];
  for (const url of urls) {
    if (!isSubmittableUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    urlList.push(url);
    if (urlList.length >= INDEXNOW_MAX_URLS) break;
  }
  if (urlList.length === 0) return null;
  return {
    host: INDEXNOW_HOST,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList,
  };
}

/**
 * The URLs a campaign's publication changes.
 *
 * Exactly the set the two publication routes already pass to
 * `revalidatePath` - the campaign page, the listing and the homepage - which
 * is not a coincidence: the pages whose cached HTML we invalidate are the
 * pages whose content a crawler now holds a stale copy of.
 */
export function campaignPublicationUrls(slug: string): string[] {
  return [
    `${INDEXNOW_ORIGIN}/campaigns/${slug}`,
    `${INDEXNOW_ORIGIN}/campaigns`,
    `${INDEXNOW_ORIGIN}/`,
  ];
}

/**
 * Decide what happened, from the HTTP status and the parsed body.
 *
 * ⚠️ This codebase's standing warning is that a status code is not an
 * outcome - PayHero answers `success: true` beside `status: "FAILED"`
 * (`docs/92`) and the FX provider reports its own errors with HTTP 200
 * (`docs/102`). IndexNow is **not** such an API: [VERIFIED by probe] it uses
 * distinct status codes and a JSON `errorCode` that agrees with them. So the
 * status is the decision and the body only enriches the detail - and that is
 * a finding about this API, not an assumption carried over from the others.
 */
export function classifyIndexNowResponse(
  httpStatus: number,
  body: unknown,
  submittedCount: number,
): IndexNowResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = typeof b.errorCode === 'string' ? b.errorCode : '';
  const message = typeof b.message === 'string' ? b.message : '';
  const suffix = code || message ? ` (${[code, message].filter(Boolean).join(': ')})` : '';

  const outcome: IndexNowOutcome =
    httpStatus === 200 ? 'submitted'
    : httpStatus === 202 ? 'pending_key_validation'
    : httpStatus === 400 ? 'invalid_request'
    : httpStatus === 403 ? 'invalid_key'
    : httpStatus === 422 ? 'wrong_host'
    : httpStatus === 429 ? 'rate_limited'
    : 'error';

  return {
    outcome,
    detail: `HTTP ${httpStatus}${suffix}`,
    submittedCount,
  };
}

/**
 * Does an outcome mean somebody must act?
 *
 * `invalid_key`, `invalid_request` and `wrong_host` are configuration
 * defects: they will not fix themselves and every later submission fails the
 * same way. `rate_limited` and `error` are transient. This is what decides
 * the audit severity, so a broken key is findable in `audit_logs` rather
 * than being one `console.error` nobody reads (`docs/123`, `docs/136`).
 */
export function isIndexNowConfigurationFault(outcome: IndexNowOutcome): boolean {
  return outcome === 'invalid_key' || outcome === 'invalid_request' || outcome === 'wrong_host';
}
