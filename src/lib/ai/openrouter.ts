import OpenAI from 'openai';

const sharedHeaders = {
  'HTTP-Referer': 'https://lastdonor.org',
  'X-Title': 'LastDonor.org',
};

/**
 * Per-HTTP-request timeout, in milliseconds.
 *
 * Remediation P1-12 (`docs/29` / `docs/31` §2.11): neither client set `timeout`
 * or `maxRetries`, so `openai@6`'s defaults applied — a **10-minute** timeout
 * and 2 internal retries. Combined with the attempt ladder in `call-ai.ts` a
 * single `callAI` could issue up to 24 HTTP requests and hang far past the
 * calling route's `maxDuration`. Every other outbound fetch in this repo has a
 * timeout; these were the only unbounded callers.
 *
 * 60s default rationale (assumption, not a vendor-published figure): the
 * longest caller budget is `maxDuration = 300`, and `publish-campaigns` makes
 * 3 `callAI` calls per story across 5 stories, so a single HTTP request must
 * not be able to eat the whole budget. Tune with `AI_REQUEST_TIMEOUT_MS`.
 */
export const AI_REQUEST_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 60_000;
  // Clamp: below 5s legitimate generations get cut off; above 120s a single
  // request can outlive the shortest cron budget (maxDuration = 120).
  return Math.min(Math.max(Math.floor(raw), 5_000), 120_000);
})();

/**
 * `maxRetries: 0` is deliberate and load-bearing.
 *
 * `call-ai.ts` owns retry policy: it rotates keys, rotates models, honours
 * per-day exhaustion and backs off on 429. The SDK retrying underneath that
 * multiplied every one of those attempts by 3 and hid the real request count
 * from the attempt ceiling. Exactly one layer gets to retry; it is `call-ai.ts`.
 * Do not raise this without lowering the ladder there.
 */
const SHARED_CLIENT_BOUNDS = {
  timeout: AI_REQUEST_TIMEOUT_MS,
  maxRetries: 0,
} as const;

let _ai: OpenAI | null = null;

function getAi(): OpenAI {
  if (!_ai) {
    _ai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: sharedHeaders,
      ...SHARED_CLIENT_BOUNDS,
    });
  }
  return _ai;
}

export const ai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    return Reflect.get(getAi(), prop, receiver);
  },
});

/** Second OpenRouter key to rotate on 429 rate limits */
let _aiFallback: OpenAI | null | undefined = undefined;

export function getAiFallbackClient(): OpenAI | null {
  if (_aiFallback === undefined) {
    _aiFallback = process.env.OPENROUTER_API_KEY_FALLBACK
      ? new OpenAI({
          apiKey: process.env.OPENROUTER_API_KEY_FALLBACK,
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: sharedHeaders,
          ...SHARED_CLIENT_BOUNDS,
        })
      : null;
  }
  return _aiFallback;
}

/** @internal Test seam — drops the memoised clients so env changes take effect. */
export function __resetAiClientsForTests(): void {
  _ai = null;
  _aiFallback = undefined;
}

/*
  Model identity is configuration, not a transport concern. The fallback
  ladder (paid primary -> two free models -> the `openrouter/free`
  meta-router) is intentional; P1-12 bounds the transport only.

  ── Slugs rot. These were dead and nothing noticed ───────────────────

  Probed against OpenRouter on 2026-10-18, every rung of the ladder
  failed:

    qwen/qwen3-coder                        402 Insufficient credits
    nvidia/nemotron-3-nano-30b-a3b:free     404 no longer free
    meta-llama/llama-3.3-70b-instruct:free  404 no longer free
    openrouter/free                         429 free-models-per-day

  Both `:free` slugs had been WITHDRAWN from the free tier. A 404 is
  not a transient failure and no retry recovers it, so every
  classification in `fetch-news` failed: 1,461 articles fetched, 9
  classified, 32 identical errors.

  It went unseen because nothing ran. The news pipeline had no
  scheduler for the platform's whole life (docs/65) and was deployed
  on 2026-10-18 (docs/66); the first scheduled run is what surfaced
  it. A model slug is a dependency on someone else's catalogue, and
  it decays silently.

  The two free rungs below were chosen from OpenRouter's live model
  list on 2026-10-18 and each returns 429 (daily free quota) rather
  than 404, which proves the slug resolves. **They are slug-verified,
  NOT output-verified** - the account's free-models-per-day quota was
  exhausted at the time, so no completion could be obtained to check
  that either model returns parseable JSON for the classifier.
  Verify that before trusting a classification run.

  ⛔ The live blocker is not the slugs. It is the account: the paid
  rungs answer 402 "never purchased credits" and the free tier answers
  429 "Add 10 credits to unlock 1000 free model requests per day". No
  code change fixes that one.
*/
export const PRIMARY_MODEL = 'qwen/qwen3-coder';
export const FALLBACK_MODEL = 'nvidia/nemotron-3.5-lightning:free';
export const TERTIARY_MODEL = 'xingchen-agi/xing4.0-29b-a4b:free';
