/**
 * Phone normalisation — the gate between what somebody typed and what we
 * are willing to send a message to.
 *
 * Every expected value here was checked against `libphonenumber-js`
 * directly on 2026-10-17 before the module was written, not predicted from
 * the shape of the number. See `docs/82`.
 */
import { describe, it, expect } from 'vitest';
import { normalisePhone, isSendablePhone, maskPhone, DEFAULT_REGION } from './phone';

describe('numbers worth sending to', () => {
  it.each([
    ['0712345678', 'KE', '+254712345678', 'KE'],
    ['0712 345 678', 'KE', '+254712345678', 'KE'],
    ['+254712345678', undefined, '+254712345678', 'KE'],
    ['+2348012345678', undefined, '+2348012345678', 'NG'],
    ['+256772123456', undefined, '+256772123456', 'UG'],
  ] as const)('%s (%s) -> %s', (input, region, e164, country) => {
    const out = normalisePhone(input, region as never);
    expect(out).toEqual({ e164, country });
  });

  it('reads a +-prefixed number on its own terms, ignoring the region', () => {
    // A Nigerian number typed by someone whose default region is Kenya.
    expect(normalisePhone('+2348012345678', 'KE')?.country).toBe('NG');
  });

  it('accepts its own output, so normalising twice is safe', () => {
    const once = normalisePhone('0712345678', 'KE')!;
    expect(normalisePhone(once.e164)).toEqual(once);
  });
});

describe('numbers that must not be sent to', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['12345', 'too short'],
    ['+254712345', 'too short for its country'],
    ['not a phone number', 'prose'],
    ['+15551234567', 'a reserved US test range'],
  ])('rejects %s (%s)', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  /*
    A local number is only meaningful against a region, and the signature
    always supplies one (DEFAULT_REGION). So the failure mode is not "no
    region" - it is the WRONG region, which silently produces a different,
    valid, wrong number. This is the case to watch.
  */
  it('a Kenyan local number read as Nigerian is rejected, not quietly re-homed', () => {
    expect(normalisePhone('0712345678', 'KE')?.e164).toBe('+254712345678');
    expect(normalisePhone('0712345678', 'NG')).toBeNull();
  });

  it.each([null, undefined])('rejects %s without throwing', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  /*
    The value of using a library rather than a length check: this number is
    the right length and the right shape for a US number, and is still not
    dialable. A regex would have passed it.
  */
  it('rejects a well-formed number that is not real', () => {
    expect(isSendablePhone('+15551234567')).toBe(false);
  });
});

describe('the default region is explicit, not accidental', () => {
  it('is a two-letter country code', () => {
    expect(DEFAULT_REGION).toMatch(/^[A-Z]{2}$/);
  });

  it('is what an unprefixed number is read as', () => {
    const out = normalisePhone('0712345678');
    // Documented as KE unless SMS_DEFAULT_REGION says otherwise; this
    // asserts the wiring, not the specific country.
    expect(out?.country).toBe(DEFAULT_REGION);
  });
});

describe('masking, because a phone number is personal data', () => {
  it('keeps the country code and the last three digits', () => {
    expect(maskPhone('+254712345678')).toBe('+254 ••••••678');
  });

  it('hides everything in between', () => {
    expect(maskPhone('+254712345678')).not.toContain('712345');
  });

  it('masks a short number entirely rather than leaking its last digits', () => {
    // Nothing to hide behind, so hide all of it.
    expect(maskPhone('+254123')).toBe('+254•••');
  });

  it.each([null, undefined, ''])('returns an empty string for %s', (input) => {
    expect(maskPhone(input)).toBe('');
  });

  it('does not pretend to mask something that is not a number', () => {
    expect(maskPhone('bogus')).toBe('•••');
  });
});
