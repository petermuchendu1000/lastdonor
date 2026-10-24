/**
 * Reading a document image with a vision model, over OpenRouter.
 *
 * A sibling of `src/lib/ai/call-ai.ts`, NOT a change to it. That client types
 * its messages as `content: string` (`call-ai.ts:160`), so it cannot carry an
 * image at all, and eleven text callers depend on its behaviour. Widening it
 * to a union would put every one of them one type-narrowing mistake away from
 * a different code path, for no benefit to any of them.
 *
 * ── THE TRAPS, ALL PROBED 2026-10-24, NOT READ ABOUT ────────────────────────
 *
 * 1. **A failure arrives as HTTP 200.** Sending a PDF where an image is
 *    expected returned `200` with `{"error":{"message":"Upstream error from
 *    Nvidia: Internal server error","code":502}}` and **no `choices` key** -
 *    so `out.choices[0]` throws a TypeError rather than reporting a provider
 *    failure. `res.ok` proves nothing. This is the third member of a family
 *    this codebase keeps meeting: PayHero answers `success: true` beside
 *    `status: "FAILED"` (`docs/92`) and the FX primary answers 200 for its own
 *    errors (`docs/102`).
 *
 * 2. **Reasoning can eat the entire budget.** The first probe returned
 *    `completion_tokens: 500`, of which `reasoning_tokens: 500`, and
 *    `content: null`. `call-ai.ts` already learned this and retries with a
 *    bigger budget; so does this.
 *
 * 3. **`image_tokens` is not a "did it see the image" signal.** It read a bill
 *    perfectly and still reported `image_tokens: 0`. Anything branching on
 *    that counter is a check that cannot fail.
 *
 * 4. **Free vision models are not reliably available.**
 *    `google/gemma-4-31b-it:free` answered `429 ... temporarily rate-limited
 *    upstream` during the same probe run. So there is a fallback order, and
 *    exhausting it is a normal outcome rather than an exception.
 */

import { getCurrency } from '@/lib/money/currencies';

/**
 * Vision models permitted to read a document, in order.
 *
 * `nvidia/nemotron-3.5-super-vl:free` is first because it is already the
 * project's `TERTIARY_MODEL` (`src/lib/ai/openrouter.ts:173`) and is the one
 * probed end to end: 3.4s, zero cost, correct issuer, amount, currency and
 * reference on a synthetic bill.
 *
 * [VERIFIED 2026-10-24] all three report `input_modalities` including `image`
 * in OpenRouter's own `/models` listing.
 */
export const VISION_MODELS = [
  'nvidia/nemotron-3.5-super-vl:free',
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
] as const;

/*
  EVERY ENTRY ABOVE WAS RUN AGAINST A REAL DOCUMENT, 2026-10-24. The first
  draft of this list was assembled from OpenRouter's `input_modalities` field
  and two of its three entries could never have worked - which is the
  `docs/81` rule (no unexercised provider path) failing on its first outing.

    nvidia/nemotron-3.5-super-vl:free                 3.4-29.5s   correct
    dots-studio/dots-3-note-preview:free                  6.0s   correct
    nvidia/nemotron-3-nano-omni-...-reasoning:free        7.9s   correct

  REJECTED, with the reason, so nobody re-adds them:

    thinkingmachines/inkling:free        HTTP 403 "only available on agentic
    thinkingmachines/inkling-small:free  harnesses" - not callable by us at all
    google/gemma-4-31b-it:free           HTTP 429 on every attempt across two
    google/gemma-4-26b-a4b-it:free       probe runs; a fallback that is always
                                         rate-limited is not a fallback

  ⚠️ Latency on the primary varied 3.4s -> 29.5s on the SAME document shape
  (the 29.5s read was a 4-degree skewed scan). Screening must therefore never
  sit inside the upload request.
*/

/** Only a model on this list may produce an auto-approval (see `decide.ts`). */
export const APPROVED_VISION_MODELS: readonly string[] = VISION_MODELS;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Token budget. The probe spent 448 reasoning tokens before emitting 79 of
 * content, so a budget under ~1000 is a coin flip on this model family.
 */
const MAX_TOKENS = 3000;
const RETRY_MAX_TOKENS = 6000;

/** A document read is not worth holding a request open for. */
const TIMEOUT_MS = 45_000;

/** Images only. A PDF must be rasterised first - see `rasterise.ts`. */
export const VISION_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function isVisionMimeType(mime: string): boolean {
  return (VISION_MIME_TYPES as readonly string[]).includes(mime);
}

export class VisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionUnavailableError';
  }
}

const SYSTEM_PROMPT = [
  'You read fields off photographs and scans of financial and medical documents.',
  'Reply with a single JSON object and nothing else.',
  'Use null for any field that is not clearly present in the image.',
  'Never guess, never infer, and never fill a field from general knowledge.',
  'If the image is blank, unreadable, or not a document, return null for every field.',
].join(' ');

const USER_PROMPT = [
  'Return this JSON shape exactly:',
  '{"issuer":string|null,"person_name":string|null,"total_amount":string|null,',
  '"currency":string|null,"reference":string|null,"document_date":string|null,',
  '"text_length":number}',
  '',
  '- issuer: the organisation that produced the document.',
  '- person_name: the person the document is about, exactly as printed.',
  '- total_amount: the amount payable or due, digits only, no currency symbol.',
  '- currency: the ISO 4217 code if one is shown or unambiguous, else null.',
  '- reference: any invoice, account or receipt number.',
  '- document_date: ISO 8601 (YYYY-MM-DD) if a date is shown, else null.',
  '- text_length: your best count of readable characters in the image.',
].join('\n');

/** The raw shape the model is asked for, before validation. */
interface RawExtraction {
  issuer?: unknown;
  person_name?: unknown;
  total_amount?: unknown;
  currency?: unknown;
  reference?: unknown;
  document_date?: unknown;
  text_length?: unknown;
}

export interface VisionReadResult {
  issuer: string | null;
  personName: string | null;
  totalAmountText: string | null;
  currency: string | null;
  reference: string | null;
  documentDate: string | null;
  textLength: number;
  /** The model that produced this, as the provider reported it. */
  modelUsed: string;
  /** Round-trip latency, for the audit row. */
  latencyMs: number;
}

/** Trim, bound, and reject the empty string. Fields land in a reviewer's UI. */
function cleanText(value: unknown, maxLength = 200): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/\s+/g, ' ');
  if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'n/a') return null;
  return t.slice(0, maxLength);
}

/**
 * Accept a currency only if the platform knows it.
 *
 * A model will happily answer `KSH`, `Ksh.` or `SHILLINGS`. `getCurrency`
 * throws on an unknown code rather than defaulting to USD (`docs/92`), so the
 * check is a try, and an unrecognised code becomes null rather than a wrong
 * currency beside a right number.
 */
function cleanCurrency(value: unknown): string | null {
  const t = cleanText(value, 8);
  if (!t) return null;
  const code = t.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 3) return null;
  try {
    getCurrency(code);
    return code;
  } catch {
    return null;
  }
}

function cleanDate(value: unknown): string | null {
  const t = cleanText(value, 32);
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** Strip a ```json fence, which models add despite being told not to. */
function parseJsonLoosely(content: string): RawExtraction | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const body = fenced ? fenced[1] : content;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as RawExtraction) : null;
  } catch {
    return null;
  }
}

interface OpenRouterReply {
  error?: { message?: string; code?: number };
  model?: string;
  choices?: { message?: { content?: string | null; reasoning?: unknown } | null }[];
  usage?: { completion_tokens?: number } | null;
}

/**
 * One attempt against one model. Returns the content, or throws with a reason.
 *
 * Everything the provider can do wrong is checked BEFORE the happy path, which
 * is why the `error`-with-200 case cannot slip through as a TypeError.
 */
async function attempt(
  apiKey: string,
  model: string,
  dataUrl: string,
  maxTokens: number,
): Promise<{ content: string; model: string }> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await res.text();
  let body: OpenRouterReply;
  try {
    body = JSON.parse(text) as OpenRouterReply;
  } catch {
    throw new Error(`${model}: non-JSON reply (${res.status}): ${text.slice(0, 120)}`);
  }

  // ⚠️ Checked before `choices`, and before `res.ok`: a provider failure
  // arrives as HTTP 200 carrying this object and nothing else.
  if (body.error) {
    throw new Error(`${model}: provider error ${body.error.code ?? res.status}: ${body.error.message ?? 'unknown'}`);
  }
  if (!res.ok) {
    throw new Error(`${model}: HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  if (!Array.isArray(body.choices) || body.choices.length === 0) {
    throw new Error(`${model}: reply had no choices`);
  }

  const message = body.choices[0]?.message;
  const content = message?.content ?? null;
  if (!content) {
    // Reasoning exhaustion: content null while `reasoning` is populated.
    throw new Error(
      message?.reasoning
        ? `${model}: spent the whole budget on reasoning`
        : `${model}: empty content`,
    );
  }
  return { content, model: body.model ?? model };
}

/**
 * Read one document image.
 *
 * Throws `VisionUnavailableError` when every model has been tried. The caller
 * must treat that as "could not read", never as "nothing wrong with the
 * document" - `decideScreening` takes a null extraction and returns
 * `needs_human`.
 */
export async function readDocumentImage(opts: {
  bytes: Buffer;
  mimeType: string;
  apiKey?: string;
}): Promise<VisionReadResult> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // Thrown, not defaulted: screening that silently does nothing would leave
    // every document sitting at `pending` with no explanation (`docs/81`).
    throw new VisionUnavailableError('OPENROUTER_API_KEY is not set');
  }
  if (!isVisionMimeType(opts.mimeType)) {
    throw new VisionUnavailableError(
      `${opts.mimeType} cannot be sent to a vision model; rasterise it first`,
    );
  }

  const dataUrl = `data:${opts.mimeType};base64,${opts.bytes.toString('base64')}`;
  const failures: string[] = [];
  const started = Date.now();

  for (const model of VISION_MODELS) {
    for (const maxTokens of [MAX_TOKENS, RETRY_MAX_TOKENS]) {
      try {
        const { content, model: reported } = await attempt(apiKey, model, dataUrl, maxTokens);
        const raw = parseJsonLoosely(content);
        if (!raw) {
          failures.push(`${model}: reply was not JSON`);
          continue;
        }
        const textLength =
          typeof raw.text_length === 'number' && Number.isFinite(raw.text_length)
            ? Math.max(0, Math.min(100_000, Math.floor(raw.text_length)))
            : 0;
        return {
          issuer: cleanText(raw.issuer),
          personName: cleanText(raw.person_name, 120),
          totalAmountText: cleanText(raw.total_amount, 40),
          currency: cleanCurrency(raw.currency),
          reference: cleanText(raw.reference, 64),
          documentDate: cleanDate(raw.document_date),
          textLength,
          modelUsed: reported,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(reason);
        // A rate limit or an upstream outage will not improve with more
        // tokens; move to the next model rather than burning the retry.
        if (/429|rate.?limit|provider error 5\d\d/i.test(reason)) break;
      }
    }
  }

  throw new VisionUnavailableError(
    `every vision model failed: ${failures.slice(0, 4).join(' | ')}`,
  );
}
