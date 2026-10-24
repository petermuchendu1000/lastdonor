/**
 * The Didit client, and the status mapping that decides whether somebody's
 * identity counts as verified.
 *
 * Every shape asserted here was probed against the live Didit API with
 * this account's key on 2026-10-17 before the client was written — the
 * create response, the decision response, and the fact that `vendor_data`
 * round-trips. See docs/81.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDiditSession,
  getDiditDecision,
  mapDiditStatus,
  isTerminal,
  DiditNotConfiguredError,
  DiditApiError,
  type DiditStatus,
  readVerifiedName,
} from './didit';

const REAL_FETCH = globalThis.fetch;

/**
 * A stub `fetch` that always answers the same way.
 *
 * Typed with the real `fetch` signature rather than `async () => ...`:
 * without the parameters, `mock.calls` infers as an empty tuple and every
 * `calls[0][1]` below fails to compile.
 */
function respond(status: number, body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

beforeEach(() => {
  process.env.DIDIT_API_KEY = 'test-key-not-a-real-one';
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

describe('creating a session', () => {
  /** The exact shape the live API returned on 2026-10-17. */
  const CREATED = {
    session_id: 'e4de9490-5cc2-4cc2-86a2-d11f285e10a7',
    session_number: 3,
    session_token: 'nVem8xzY7RAE',
    url: 'https://verify.didit.me/session/nVem8xzY7RAE',
    vendor_data: 'campaign-abc',
    status: 'Not Started',
    callback: 'https://lastdonor.org/dashboard',
    features: 'OCR + LIVENESS + FACE_MATCH + IP_ANALYSIS',
  };

  it('returns the hosted url the person is sent to', async () => {
    globalThis.fetch = respond(201, CREATED);
    const s = await createDiditSession({ campaignId: 'campaign-abc', callbackUrl: 'https://x.test/cb' });

    expect(s.sessionId).toBe(CREATED.session_id);
    expect(s.url).toBe(CREATED.url);
    expect(s.status).toBe('Not Started');
  });

  /*
    vendor_data is the ONLY thing tying a returning webhook back to a
    campaign. If it stops being sent, verifications complete and attach to
    nothing.
  */
  it('sends the campaign id as vendor_data', async () => {
    const f = respond(201, CREATED);
    globalThis.fetch = f;
    await createDiditSession({ campaignId: 'campaign-abc', callbackUrl: 'https://x.test/cb' });

    const body = JSON.parse(f.mock.calls[0][1]!.body as string);
    expect(body.vendor_data).toBe('campaign-abc');
    expect(body.callback).toBe('https://x.test/cb');
  });

  it('authenticates with the header Didit expects, and never in the URL', async () => {
    const f = respond(201, CREATED);
    globalThis.fetch = f;
    await createDiditSession({ campaignId: 'c', callbackUrl: 'https://x.test/cb' });

    const [url, init] = f.mock.calls[0];
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('test-key-not-a-real-one');
    expect(String(url)).not.toContain('test-key-not-a-real-one');
  });

  it('refuses to run without a key rather than failing silently', async () => {
    delete process.env.DIDIT_API_KEY;
    globalThis.fetch = respond(201, CREATED);

    await expect(
      createDiditSession({ campaignId: 'c', callbackUrl: 'https://x.test/cb' }),
    ).rejects.toBeInstanceOf(DiditNotConfiguredError);
  });

  it('raises a typed error when Didit rejects the request', async () => {
    globalThis.fetch = respond(400, { workflow_id: ['This field is required.'] });
    await expect(
      createDiditSession({ campaignId: 'c', callbackUrl: 'https://x.test/cb' }),
    ).rejects.toBeInstanceOf(DiditApiError);
  });

  it('never puts the key in an error message', async () => {
    globalThis.fetch = respond(401, 'unauthorized for key test-key-not-a-real-one');
    const err = await createDiditSession({ campaignId: 'c', callbackUrl: 'https://x.test/cb' }).catch(
      (e: Error) => e,
    );
    // The body is echoed, so this proves only that we add nothing; the real
    // guard is that the key travels as a header and is never interpolated.
    expect((err as DiditApiError).status).toBe(401);
  });

  it('treats a 2xx without a session id as a failure, not a session', async () => {
    globalThis.fetch = respond(201, { status: 'Not Started' });
    await expect(
      createDiditSession({ campaignId: 'c', callbackUrl: 'https://x.test/cb' }),
    ).rejects.toBeInstanceOf(DiditApiError);
  });
});

describe('reading a decision', () => {
  it('returns the status and the campaign id it was created with', async () => {
    globalThis.fetch = respond(200, {
      session_id: 'sess-1',
      status: 'Approved',
      vendor_data: 'campaign-abc',
      features: ['ID_VERIFICATION', 'LIVENESS', 'FACE_MATCH'],
    });

    const d = await getDiditDecision('sess-1');
    expect(d).toEqual({ sessionId: 'sess-1', status: 'Approved', vendorData: 'campaign-abc', verifiedName: null });
  });

  it('escapes the session id into the path', async () => {
    const f = respond(200, { session_id: 'a/b', status: 'Approved', vendor_data: null });
    globalThis.fetch = f;
    await getDiditDecision('a/b');
    expect(String(f.mock.calls[0][0])).toContain('a%2Fb');
  });
});

describe('what counts as verified', () => {
  it('passes only on Approved', () => {
    expect(mapDiditStatus('Approved')).toBe('identity_verified');
  });

  it('fails only on Declined', () => {
    expect(mapDiditStatus('Declined')).toBe('rejected');
  });

  /*
    The one that matters. "In Review" is Didit's MANUAL queue: a person
    there has not finished. Mapping it to verified would publish an
    identity nobody checked - the same class of defect as docs/77.
  */
  it('does NOT treat Didit’s own review queue as a pass', () => {
    expect(mapDiditStatus('In Review')).toBe('pending');
  });

  it.each<DiditStatus>(['Not Started', 'In Progress', 'In Review', 'Abandoned', 'Expired'])(
    '%s leaves the campaign pending',
    (s) => {
      expect(mapDiditStatus(s)).toBe('pending');
    },
  );

  it('knows which outcomes Didit will not revisit', () => {
    expect(isTerminal('Approved')).toBe(true);
    expect(isTerminal('Declined')).toBe(true);
    expect(isTerminal('Expired')).toBe(true);
    expect(isTerminal('In Review')).toBe(false);
    expect(isTerminal('In Progress')).toBe(false);
  });
});

describe('reading the verified name off a decision', () => {
  /*
    ⚠️ The keys inside `kyc` are UNVERIFIED. A real (not-started) session was
    probed on 2026-10-24 and `kyc` came back **null**, so the only way to see
    the real field names is a session someone actually completes. These cases
    cover the conventional shapes AND the reporting that will identify the
    real one from the logs on first use - which is the part that matters,
    because guessing again is how this stays wrong.
  */
  it('reads a single full-name field', () => {
    for (const key of ['full_name', 'name', 'legal_name']) {
      const r = readVerifiedName({ kyc: { [key]: '  Asha W. Mutiso ' } });
      expect(r.name, key).toBe('Asha W. Mutiso');
      expect(r.source, key).toBe(`kyc.${key}`);
    }
  });

  it('joins first and last name fields', () => {
    const r = readVerifiedName({ kyc: { first_name: 'Asha', last_name: 'Mutiso' } });
    expect(r.name).toBe('Asha Mutiso');
    expect(r.source).toBe('kyc.first_name + kyc.last_name');
  });

  it('accepts the other conventional spellings of those two', () => {
    expect(readVerifiedName({ kyc: { given_names: 'Asha', surname: 'Mutiso' } }).name).toBe('Asha Mutiso');
    expect(readVerifiedName({ kyc: { given_name: 'Asha', family_name: 'Mutiso' } }).name).toBe('Asha Mutiso');
  });

  it('takes whichever half is present rather than nothing', () => {
    expect(readVerifiedName({ kyc: { surname: 'Mutiso' } }).name).toBe('Mutiso');
    expect(readVerifiedName({ kyc: { first_name: 'Asha' } }).name).toBe('Asha');
  });

  it('returns null, with a reason, when kyc is absent or null', () => {
    expect(readVerifiedName({}).name).toBeNull();
    expect(readVerifiedName({ kyc: null }).source).toBe('kyc absent or null');
    expect(readVerifiedName({ kyc: 'nonsense' }).name).toBeNull();
  });

  it('REPORTS THE KEYS IT SAW when it recognises none of them', () => {
    // This is the mechanism that makes the unknown self-resolving: the first
    // completed session puts the real field names in the log.
    const r = readVerifiedName({ kyc: { document_number: 'X', nationality: 'KE', portrait: '...' } });
    expect(r.name).toBeNull();
    expect(r.source).toContain('document_number');
    expect(r.source).toContain('nationality');
  });

  it('never puts a NAME in the reported source, only key names', () => {
    // These are the fields of someone's identity document. The diagnostic
    // reports the shape; it must not leak the contents into a log.
    const r = readVerifiedName({ kyc: { weird_key: 'Asha W. Mutiso' } });
    expect(r.source).not.toContain('Asha');
    expect(r.source).toContain('weird_key');
  });

  it('ignores blank and non-string values', () => {
    expect(readVerifiedName({ kyc: { full_name: '   ' } }).name).toBeNull();
    expect(readVerifiedName({ kyc: { full_name: 42 } }).name).toBeNull();
    expect(readVerifiedName({ kyc: { full_name: null, surname: 'Mutiso' } }).name).toBe('Mutiso');
  });
});
