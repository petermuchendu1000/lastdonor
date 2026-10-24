/**
 * The vision client, and the provider behaviours that were probed for real.
 *
 * Every failure shape asserted here was OBSERVED against OpenRouter on
 * 2026-10-24, not imagined. `fetch` is stubbed so the shapes can be replayed
 * deterministically; `vision.contract.live.test.ts` re-checks them against the
 * real provider when asked.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  readDocumentImage,
  isVisionMimeType,
  VisionUnavailableError,
  VISION_MODELS,
  APPROVED_VISION_MODELS,
} from './vision';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

/*
  ⚠️ A `Response` body can be read ONCE. `mockImplementation(() => reply(...))` hands
  back the SAME object on every call, so the second `res.text()` throws "body
  unusable" and the client sees a different error than the one being tested -
  which silently changed the retry path and made two of these tests pass for
  the wrong reason. Always `mockImplementation(() => reply(...))`.
*/
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ok(content: string, model = VISION_MODELS[0]): Response {
  return reply({ model, choices: [{ message: { content } }] });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the trap: a failure arrives as HTTP 200', () => {
  it('treats a 200 carrying an `error` object as a failure, not a crash', async () => {
    /*
      [VERIFIED] Sending a PDF where an image was expected returned HTTP 200
      with {"error":{"message":"Upstream error from Nvidia: Internal server
      error","code":502}} and NO `choices` key. Reading `choices[0]` first
      throws a TypeError, which would surface as an internal error rather than
      "the provider failed". Same family as PayHero's `success: true` beside
      `status: FAILED` (docs/92) and the FX primary's 200-on-error (docs/102).
    */
    const fetchMock = vi.fn().mockImplementation(() => 
      reply({ error: { message: 'Upstream error from Nvidia: Internal server error', code: 502 } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' }),
    ).rejects.toThrow(VisionUnavailableError);

    // One attempt per model; the 5xx shape must not burn the token retry.
    expect(fetchMock).toHaveBeenCalledTimes(VISION_MODELS.length);
  });

  it('reports the provider message, so the audit row says what happened', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => 
      reply({ error: { message: 'Provider returned error', code: 429 } }),
    ));
    await expect(
      readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' }),
    ).rejects.toThrow(/429|Provider returned error/);
  });

  it('a reply with no choices at all is a failure, not an empty extraction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => reply({ model: 'm' })));
    await expect(
      readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' }),
    ).rejects.toThrow(VisionUnavailableError);
  });
});

describe('the trap: reasoning eats the whole budget', () => {
  it('retries the same model with a bigger budget, then moves on', async () => {
    // [VERIFIED] first probe: completion_tokens 500, reasoning_tokens 500,
    // content null. `call-ai.ts` already learned this; so must this.
    const exhausted = () => reply({
      model: VISION_MODELS[0],
      choices: [{ message: { content: null, reasoning: 'thinking...' } }],
    });
    const fetchMock = vi.fn().mockImplementation(exhausted);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' }),
    ).rejects.toThrow(/reasoning/);

    // Two token budgets per model, because this one CAN improve with headroom.
    expect(fetchMock).toHaveBeenCalledTimes(VISION_MODELS.length * 2);
  });

  it('succeeds on the second budget when the first was too small', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => reply({
        model: VISION_MODELS[0],
        choices: [{ message: { content: null, reasoning: 'thinking...' } }],
      }))
      .mockImplementationOnce(() => ok('{"issuer":"X HOSPITAL","person_name":"ASHA MUTISO","total_amount":"100","currency":"KES","reference":"R1","document_date":"2026-10-02","text_length":200}'));
    vi.stubGlobal('fetch', fetchMock);

    const r = await readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' });
    expect(r.issuer).toBe('X HOSPITAL');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('parsing what a model actually sends back', () => {
  it('survives a ```json fence the model was told not to add', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => 
      ok('```json\n{"issuer":"KENYATTA","person_name":"ASHA W. MUTISO","total_amount":"205555","currency":"KES","reference":"INV-1","document_date":"2026-10-02","text_length":400}\n```'),
    ));
    const r = await readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' });
    expect(r.personName).toBe('ASHA W. MUTISO');
    expect(r.currency).toBe('KES');
  });

  it('survives prose wrapped around the JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => 
      ok('Here is the data you asked for: {"issuer":"A","total_amount":"5","text_length":99} Hope that helps!'),
    ));
    const r = await readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' });
    expect(r.issuer).toBe('A');
    expect(r.textLength).toBe(99);
  });

  it('turns the string "null" and "N/A" into real nulls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => 
      ok('{"issuer":"null","person_name":"N/A","total_amount":"  ","text_length":10}'),
    ));
    const r = await readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' });
    expect(r.issuer).toBeNull();
    expect(r.personName).toBeNull();
    expect(r.totalAmountText).toBeNull();
  });

  it('rejects a currency the platform does not know, rather than guessing', async () => {
    // A model will answer KSH, Ksh. or SHILLINGS. `getCurrency` throws on an
    // unknown code rather than defaulting to USD (docs/92), so a wrong
    // currency beside a right number must become null.
    for (const bad of ['KSH', 'SHILLINGS', 'ZZZ', '$', 'usd ']) {
      vi.unstubAllGlobals();
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => 
        ok(`{"issuer":"A","total_amount":"5","currency":${JSON.stringify(bad)},"text_length":10}`),
      ));
      const r = await readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' });
      if (bad.trim().toUpperCase() === 'USD') expect(r.currency).toBe('USD');
      else expect(r.currency, bad).toBeNull();
    }
  });

  it('keeps only a well-formed ISO date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => 
      ok('{"issuer":"A","document_date":"2nd of October","text_length":10}'),
    ));
    expect((await readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' })).documentDate).toBeNull();
  });

  it('a non-JSON reply is a failure, not a silent empty read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => ok('I cannot read this image.')));
    await expect(
      readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' }),
    ).rejects.toThrow(VisionUnavailableError);
  });
});

describe('refusing before calling', () => {
  it('refuses a PDF, which is what the 502 above was', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      readDocumentImage({ bytes: PNG, mimeType: 'application/pdf', apiKey: 'k' }),
    ).rejects.toThrow(/rasterise/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses with no API key rather than silently doing nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('OPENROUTER_API_KEY', '');
    await expect(
      readDocumentImage({ bytes: PNG, mimeType: 'image/png' }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts exactly the three image types the uploader allows', () => {
    expect(isVisionMimeType('image/jpeg')).toBe(true);
    expect(isVisionMimeType('image/png')).toBe(true);
    expect(isVisionMimeType('image/webp')).toBe(true);
    expect(isVisionMimeType('application/pdf')).toBe(false);
    expect(isVisionMimeType('image/svg+xml')).toBe(false);
  });
});

describe('the model list is the approval allowlist', () => {
  it('only models that were run against a real document are listed', () => {
    // Rejected after probing, recorded so nobody re-adds them:
    //   thinkingmachines/*  -> HTTP 403, not callable by us at all
    //   google/gemma-4-*    -> HTTP 429 on every attempt
    expect(VISION_MODELS).not.toContain('thinkingmachines/inkling:free');
    expect(VISION_MODELS).not.toContain('thinkingmachines/inkling-small:free');
    expect(VISION_MODELS).not.toContain('google/gemma-4-31b-it:free');
    expect(VISION_MODELS).not.toContain('google/gemma-4-26b-a4b-it:free');
  });

  it('the approval allowlist and the call order are the same list', () => {
    // If a model may be called it may approve, and vice versa. Two lists that
    // can drift is how a model gains authority nobody granted it.
    expect([...APPROVED_VISION_MODELS]).toEqual([...VISION_MODELS]);
  });

  it('reports the model the PROVIDER named, not the one we asked for', async () => {
    // OpenRouter's meta-routing can serve a different model than requested.
    // `decide.ts` checks the reported name against the allowlist, so it has
    // to be the provider's answer or the check is theatre.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => 
      reply({ model: 'someone/else', choices: [{ message: { content: '{"issuer":"A","text_length":30}' } }] }),
    ));
    const r = await readDocumentImage({ bytes: PNG, mimeType: 'image/png', apiKey: 'k' });
    expect(r.modelUsed).toBe('someone/else');
    expect(APPROVED_VISION_MODELS).not.toContain(r.modelUsed);
  });
});
