import {
  ai,
  getAiFallbackClient,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  TERTIARY_MODEL,
  AI_REQUEST_TIMEOUT_MS,
} from './openrouter';
import { logAIUsage, estimateCostUsd } from '@/lib/monitoring/ai-cost-tracker';
import { pipelineLog, pipelineError } from '@/lib/server-logger';

// ─── Global Rate Limit Tracking ────────────────────────────────────────────
// Tracks last successful call timestamp to avoid blind delays.
// Also tracks models exhausted for the day to skip them entirely.
let lastFreeCallMs = 0;
const FREE_CALL_COOLDOWN_MS = 6_000; // 6s between free-tier calls (vs old 12s before every attempt)
const dailyExhaustedModels = new Set<string>();

// ─── Bounds (remediation P1-12) ────────────────────────────────────────────
// This was the only unbounded caller in the repo. `openrouter.ts` now sets a
// per-request `timeout` and `maxRetries: 0`; the three ceilings below bound the
// ladder this module builds on top of it, so a provider outage cannot turn one
// `callAI` into an open-ended spend of time or tokens.

/**
 * Hard cap on HTTP requests issued by a single `callAI`.
 *
 * With `maxRetries: 0` upstream, attempts map 1:1 onto HTTP requests, so this
 * is now a real request budget rather than a multiplier. The natural ladder is
 * 3 models × 2 keys + 2 `openrouter/free` = 8; the cap makes that a ceiling, so
 * adding a model to `modelOrder` can no longer silently widen the blast radius.
 */
export const MAX_ATTEMPTS_PER_CALL = 8;

/**
 * Wall-clock deadline for one `callAI`, after which no further attempt starts.
 *
 * Without it, 8 attempts × a 60s request timeout is 480s — longer than the
 * `maxDuration = 300` of every caller, so the route would be killed mid-write
 * rather than returning. Two request timeouts is enough for a genuine
 * slow-but-working provider and leaves the caller time to finish. Assumption,
 * not a vendor figure; tune with `AI_CALL_DEADLINE_MS`.
 */
export const AI_CALL_DEADLINE_MS = (() => {
  const raw = Number(process.env.AI_CALL_DEADLINE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return AI_REQUEST_TIMEOUT_MS * 2;
  return Math.max(Math.floor(raw), AI_REQUEST_TIMEOUT_MS);
})();

/**
 * Per-run runaway ceiling: a rolling window over attempts and estimated spend,
 * shared by every `callAI` in the process.
 *
 * The per-call caps above bound one call; they do nothing about a provider
 * erroring instantly while a cron loop calls `callAI` 15 times (3 per story ×
 * 5 stories in `publish-campaigns`) and each call burns its full ladder. This
 * breaker trips and fails fast instead.
 *
 * Defaults are assumptions sized to the heaviest legitimate run
 * (`publish-campaigns`: 5 × 3 × 8 = 120 attempts worst case) with headroom, not
 * vendor limits. Tune with `AI_MAX_ATTEMPTS_PER_WINDOW` /
 * `AI_MAX_SPEND_USD_PER_WINDOW`.
 */
const BUDGET_WINDOW_MS = 5 * 60_000;

const MAX_ATTEMPTS_PER_WINDOW = (() => {
  const raw = Number(process.env.AI_MAX_ATTEMPTS_PER_WINDOW);
  if (!Number.isFinite(raw) || raw <= 0) return 240;
  return Math.floor(raw);
})();

const MAX_SPEND_USD_PER_WINDOW = (() => {
  const raw = Number(process.env.AI_MAX_SPEND_USD_PER_WINDOW);
  if (!Number.isFinite(raw) || raw <= 0) return 2;
  return raw;
})();

let windowStartMs = Date.now();
let windowAttempts = 0;
let windowSpendUsd = 0;

function rollBudgetWindow(): void {
  if (Date.now() - windowStartMs >= BUDGET_WINDOW_MS) {
    windowStartMs = Date.now();
    windowAttempts = 0;
    windowSpendUsd = 0;
  }
}

/** Reason string when the run ceiling is tripped, else `null`. */
function budgetExceededReason(): string | null {
  rollBudgetWindow();
  if (windowAttempts >= MAX_ATTEMPTS_PER_WINDOW) {
    return `AI attempt ceiling reached (${windowAttempts}/${MAX_ATTEMPTS_PER_WINDOW} requests in the last ${BUDGET_WINDOW_MS / 60_000} min)`;
  }
  if (windowSpendUsd >= MAX_SPEND_USD_PER_WINDOW) {
    return `AI spend ceiling reached ($${windowSpendUsd.toFixed(4)}/$${MAX_SPEND_USD_PER_WINDOW} estimated in the last ${BUDGET_WINDOW_MS / 60_000} min)`;
  }
  return null;
}

/** Free models and the free meta-router cost nothing; don't charge them. */
function isFreeModel(model: string): boolean {
  return model.endsWith(':free') || model === 'openrouter/free';
}

/** @internal Observability + test seam. */
export function getAiBudgetSnapshot(): {
  windowAttempts: number;
  windowSpendUsd: number;
  maxAttemptsPerWindow: number;
  maxSpendUsdPerWindow: number;
} {
  rollBudgetWindow();
  return {
    windowAttempts,
    windowSpendUsd,
    maxAttemptsPerWindow: MAX_ATTEMPTS_PER_WINDOW,
    maxSpendUsdPerWindow: MAX_SPEND_USD_PER_WINDOW,
  };
}

/** @internal Test seam — clears the rolling window and daily exhaustion set. */
export function __resetAiBudgetForTests(): void {
  windowStartMs = Date.now();
  windowAttempts = 0;
  windowSpendUsd = 0;
  dailyExhaustedModels.clear();
}

/**
 * Wait only the minimum time needed since the last free-tier call.
 * If enough time has passed, returns immediately.
 */
async function throttleFreeCall(): Promise<void> {
  const elapsed = Date.now() - lastFreeCallMs;
  if (elapsed < FREE_CALL_COOLDOWN_MS) {
    const waitMs = FREE_CALL_COOLDOWN_MS - elapsed;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export async function callAI<T>(opts: {
  systemPrompt: string;
  userPrompt: string;
  parseJson?: boolean;
  maxTokens?: number;
  promptType?: string;
  campaignId?: string;
}): Promise<T> {
  const {
    systemPrompt,
    userPrompt,
    parseJson = true,
    maxTokens = 4096,
    promptType = 'unknown',
    campaignId,
  } = opts;

  const messages: { role: 'system' | 'user'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let response: string | null = null;
  let modelUsed: string = PRIMARY_MODEL;
  let inputTokens = 0;
  let outputTokens = 0;
  const startMs = Date.now();

  // Build list of (client, model) pairs to try.
  // Strategy: try each model with primary key, then fallback key, then next model.
  // Skip models known to be exhausted for the day.
  const fallback = getAiFallbackClient();
  const clients = [ai, ...(fallback ? [fallback] : [])];
  const modelOrder = [PRIMARY_MODEL, FALLBACK_MODEL, TERTIARY_MODEL];
  const attempts: { client: typeof ai; model: string }[] = [];
  for (const model of modelOrder) {
    if (dailyExhaustedModels.has(model)) continue;
    for (const client of clients) {
      attempts.push({ client, model });
    }
  }

  // Always add openrouter/free as a last resort (meta-router selects any available free model)
  if (!dailyExhaustedModels.has('openrouter/free')) {
    for (const client of clients) {
      attempts.push({ client, model: 'openrouter/free' });
    }
  }

  // P1-12: hard ceiling on HTTP requests per call. Truncating the ladder keeps
  // the last-resort meta-router entries only when they fit under the cap, which
  // is the correct trade-off: the cap is the invariant, the ladder is a
  // preference.
  if (attempts.length > MAX_ATTEMPTS_PER_CALL) {
    attempts.length = MAX_ATTEMPTS_PER_CALL;
  }

  // P1-12: refuse before issuing anything if the process-wide ceiling is
  // already tripped, so a provider outage fails fast instead of compounding.
  const preflightBudgetBlock = budgetExceededReason();
  if (preflightBudgetBlock) {
    pipelineError('ai', `callAI refused: ${preflightBudgetBlock}`);
    logAIUsage({
      model: modelUsed,
      promptType,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      success: false,
      errorMessage: preflightBudgetBlock,
      campaignId,
    }).catch(() => {});
    throw new Error('AI content generation is temporarily unavailable. Please try again later.');
  }

  let lastError: Error | null = null;
  let budgetBlockedReason: string | null = null;
  let deadlineExceeded = false;
  const reasoningExhaustedModels = new Set<string>(); // Track models that consumed all tokens on reasoning

  for (let i = 0; i < attempts.length; i++) {
    const { client, model } = attempts[i];

    // Skip if this model got daily-exhausted during this loop
    if (dailyExhaustedModels.has(model) && model !== 'openrouter/free') continue;

    // P1-12: stop starting attempts once this call has used its wall-clock
    // budget, so the ladder cannot outlive the caller's maxDuration.
    if (Date.now() - startMs >= AI_CALL_DEADLINE_MS) {
      deadlineExceeded = true;
      pipelineLog('ai', `callAI deadline reached after ${i} attempt(s) (${AI_CALL_DEADLINE_MS}ms), giving up`);
      break;
    }

    // P1-12: re-check the process-wide ceiling between attempts.
    budgetBlockedReason = budgetExceededReason();
    if (budgetBlockedReason) {
      pipelineError('ai', `callAI stopped mid-ladder: ${budgetBlockedReason}`);
      break;
    }

    try {
      // Smart throttle: only wait if not enough time since last free-tier call
      if (model.endsWith(':free')) {
        await throttleFreeCall();
      }

      // If a previous attempt on this model hit reasoning exhaustion, bump max_tokens
      const effectiveMaxTokens = reasoningExhaustedModels.has(model)
        ? Math.min(maxTokens * 4, 32768)
        : maxTokens;

      modelUsed = model;
      // Count the HTTP request against the rolling ceiling *before* issuing it,
      // so a request that hangs or throws is still charged for.
      windowAttempts++;
      const completion = await client.chat.completions.create({
        model,
        messages,
        max_tokens: effectiveMaxTokens,
        temperature: 0.7,
      });

      // Mark successful call timestamp
      lastFreeCallMs = Date.now();

      inputTokens = completion.usage?.prompt_tokens ?? 0;
      outputTokens = completion.usage?.completion_tokens ?? 0;
      if (!isFreeModel(model)) {
        windowSpendUsd += estimateCostUsd(model, inputTokens, outputTokens);
      }
      const choice = completion.choices[0];
      response = choice?.message?.content ?? null;

      // Reasoning models may return null content if max_tokens was exhausted on thinking
      if (!response && (choice?.message as unknown as Record<string, unknown>)?.reasoning) {
        if (!reasoningExhaustedModels.has(model)) {
          // First time - mark it and the next attempt with this model will get higher max_tokens
          reasoningExhaustedModels.add(model);
          pipelineLog('ai', `${model} spent all tokens on reasoning (${outputTokens} tokens), will retry with higher budget...`);
        } else {
          pipelineLog('ai', `${model} reasoning exhaustion persists even with ${effectiveMaxTokens} tokens, trying next...`);
        }
        continue;
      }

      // Detect truncated output (model hit max_tokens before finishing)
      const finishReason = choice?.finish_reason;
      if (response && finishReason === 'length') {
        pipelineLog('ai', `${model} output truncated (${outputTokens}/${effectiveMaxTokens} tokens, finish_reason=length), trying next...`);
        response = null;
        continue;
      }

      if (response) break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = (error as { status?: number }).status;
      const errMsg = lastError.message;

      if (status === 429) {
        // Detect per-day exhaustion - skip ALL attempts for this model (key rotation won't help)
        if (errMsg.includes('per-day') || errMsg.includes('per day')) {
          pipelineLog('ai', `${model} hit daily limit, marking exhausted for this session`);
          dailyExhaustedModels.add(model);
        } else {
          pipelineLog('ai', `Rate limited on ${model} (key ${clients.indexOf(client) + 1}), rotating...`);
          // Brief backoff before next attempt (per-minute limits)
          await new Promise((r) => setTimeout(r, 2_000));
        }
        continue;
      }

      // Non-429 error on last attempt - throw
      if (i === attempts.length - 1) {
        logAIUsage({
          model: modelUsed,
          promptType,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - startMs,
          success: false,
          errorMessage: errMsg,
          campaignId,
        }).catch(() => {});
        throw error;
      }

      // Non-429 error but more attempts remain - try next
      pipelineLog('ai', `${model} error (${status ?? 'unknown'}): ${errMsg.slice(0, 100)}, trying next...`);
    }
  }

  if (!response) {
    const internalMsg = budgetBlockedReason
      ? `${budgetBlockedReason}. ${lastError?.message ?? 'No response received.'}`
      : deadlineExceeded
        ? `callAI exceeded its ${AI_CALL_DEADLINE_MS}ms deadline. ${lastError?.message ?? 'No response received.'}`
        : dailyExhaustedModels.size > 0
          ? `All free models exhausted for the day (${[...dailyExhaustedModels].join(', ')}). ${lastError?.message ?? 'No response received.'}`
          : 'AI returned empty response from all models';
    logAIUsage({
      model: modelUsed,
      promptType,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - startMs,
      success: false,
      errorMessage: internalMsg,
      campaignId,
    }).catch(() => {});
    pipelineError('ai', internalMsg);
    throw new Error('AI content generation is temporarily unavailable. Please try again later.');
  }

  // Log successful usage (fire-and-forget)
  logAIUsage({
    model: modelUsed,
    promptType,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - startMs,
    success: true,
    campaignId,
  }).catch(() => {});

  if (!parseJson) {
    return response as T;
  }

  // Strip markdown code fences if present
  let cleaned = response.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Some models wrap JSON in extra text - extract the JSON object/array
  if (cleaned.length > 0 && cleaned[0] !== '{' && cleaned[0] !== '[') {
    const jsonStart = cleaned.search(/[\[{]/);
    if (jsonStart !== -1) {
      cleaned = cleaned.slice(jsonStart);
    }
  }

  // Trim trailing text after the JSON by finding the matching closing bracket
  if (cleaned.length > 0) {
    const openChar = cleaned[0];
    const closeChar = openChar === '{' ? '}' : openChar === '[' ? ']' : null;
    if (closeChar) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && inString) { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === openChar) depth++;
        if (ch === closeChar) {
          depth--;
          if (depth === 0) {
            cleaned = cleaned.slice(0, i + 1);
            break;
          }
        }
      }
    }
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Failed to parse AI JSON response: ${cleaned.slice(0, 200)}`);
  }
}
