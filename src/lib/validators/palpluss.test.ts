/**
 * The status poll accepts exactly the references we mint, and nothing else.
 *
 * ⛔ The one input this must never accept is Palpluss's own transaction id.
 * That id is the key to `GET /v1/transactions/{id}` on a tenant that may be
 * shared with another product, and a blank or traversing value reads that
 * whole ledger with HTTP 200 (`docs/180` finding 1). The poll resolves OUR
 * reference to a row and reads the gateway id out of it, so the narrower this
 * schema is, the less of that machinery a stranger's string can reach.
 */

import { describe, expect, it } from 'vitest';

import { palplussStatusQuerySchema } from './palpluss';
import {
  ACCOUNT_REFERENCE_RANDOM_CHARS,
  MAX_ACCOUNT_REFERENCE,
  mintAccountReference,
} from '@/lib/palpluss';

const accepts = (reference: string): boolean =>
  palplussStatusQuerySchema.safeParse({ reference }).success;

describe('palplussStatusQuerySchema', () => {
  it('accepts every reference the minter produces', () => {
    /*
      Driven against the real minter rather than a handwritten sample: a
      schema that refuses what production mints refuses every real poll, and
      would do it silently with a 400 the donor reads as "not a reference".
    */
    for (let i = 0; i < 200; i += 1) {
      const reference = mintAccountReference();
      expect(accepts(reference), `refused ${reference}`).toBe(true);
    }
  });

  it('⛔ refuses a Palpluss transaction id', () => {
    expect(accepts('1cbdbaca-2a6b-4e1c-84f4-23e214794b6c')).toBe(false);
  });

  it('⛔ refuses the inputs that read a whole tenant ledger', () => {
    // `docs/180` finding 1: the empty and traversing values, specifically.
    for (const bad of ['', ' ', '..', '../transactions', 'LD-']) {
      expect(accepts(bad), `accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('refuses anything of the wrong length', () => {
    const body = 'A'.repeat(ACCOUNT_REFERENCE_RANDOM_CHARS);
    expect(accepts(`LD-${body}`)).toBe(true);
    expect(accepts(`LD-${body}A`)).toBe(false);
    expect(accepts(`LD-${body.slice(1)}`)).toBe(false);
  });

  it('refuses characters outside the minting alphabet', () => {
    const pad = 'A'.repeat(ACCOUNT_REFERENCE_RANDOM_CHARS - 1);
    // Base32 excludes 0, 1, 8, 9 and every lower-case letter.
    for (const ch of ['0', '1', '8', '9', 'a', '-', '*']) {
      expect(accepts(`LD-${pad}${ch}`), `accepted ${ch}`).toBe(false);
    }
    // And the control: a legal symbol in the same position passes.
    expect(accepts(`LD-${pad}7`)).toBe(true);
  });

  it('refuses a reference without our isolation prefix', () => {
    const body = 'A'.repeat(ACCOUNT_REFERENCE_RANDOM_CHARS);
    expect(accepts(`XX-${body}`)).toBe(false);
  });

  it('⛔ DERIVES its length from the documented limit', () => {
    /*
      The whole reason this reference is short is Palpluss's 12-character
      `accountReference` field. A literal `{9}` in the schema would silently
      stop matching the day that limit moves, and the symptom would be every
      poll answering 400.
    */
    expect(ACCOUNT_REFERENCE_RANDOM_CHARS).toBe(MAX_ACCOUNT_REFERENCE - 'LD-'.length);
    expect(mintAccountReference()).toHaveLength(MAX_ACCOUNT_REFERENCE);
  });

  it('trims surrounding whitespace rather than refusing it', () => {
    const reference = mintAccountReference();
    expect(accepts(`  ${reference}  `)).toBe(true);
  });
});
