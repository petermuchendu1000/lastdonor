/**
 * A navigation gate that refuses must show the person why.
 *
 * ── THE DEFECT (2026-10-30, `docs/153`) ─────────────────────────────────────
 *
 * The create wizard's two gates are both a bare return:
 *
 *     function goNext()              { if (!validateStep(step)) return; … }
 *     function handlePreviewLaunch() { if (!validateStep(5))    return; … }
 *
 * `validateStep` called `setErrors`, React rendered each message beside its
 * own field, and nothing moved the person to them. The action bar is pinned
 * to the bottom of the viewport, so the person is ALWAYS at the end of the
 * page when they press it.
 *
 * [VERIFIED by execution, 390px, Africa/Nairobi] On the review screen -
 * 2,093px against an 844px viewport - pressing "Preview & submit" with no
 * cover photo rendered *"A campaign photo is required"* at **y=386** while
 * the visible band was **1249..2093**. The message was **863px above the top
 * of the screen**, there was no toast, no scroll, and the modal did not open.
 * A screenshot taken immediately afterwards is indistinguishable from the one
 * before. The control proves the probe could see the other answer: the same
 * press on screen 1 (1,380px) put its message at y=197, `inViewport: true`.
 *
 * ⚠️ And the wizard INVITES that state. Screen 3 offers **"Skip for now"**,
 * and `validateStep(2)`'s own comment reads *"Add Media - no required fields;
 * photo is validated at Review"*. So the product tells the organiser to skip
 * the photo and then, three screens later, silently refuses because they did.
 *
 * ── WHAT THIS RULE CHECKS, AND WHY IT IS SHAPED THIS WAY ────────────────────
 *
 * It checks the MECHANISM, not the symptom: that every message is findable by
 * the reveal, and that the reveal is wired to the one function both gates
 * pass through. Asserting "pressing submit scrolls" would need the whole
 * wizard rendered with a session, which is how the behaviour went untested in
 * the first place.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(__dirname, 'ShareYourStoryForm.tsx');
const SRC = readFileSync(FILE, 'utf8');

/** Comments stripped: `docs/116` §4 - the comments above the fix quote it. */
const CODE = SRC.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(?<![:/])\/\/[^\n]*/g, ' ');

/** Every place a validation message is rendered from the `errors` object. */
function errorRenderSites(): string[] {
  return [...CODE.matchAll(/\{errors\.([A-Za-z]+)\}/g)].map((m) => m[0]);
}

/** Every `if (!validateStep(…)) return` style gate. */
function gates(): string[] {
  return [...CODE.matchAll(/!validateStep\([^)]*\)/g)].map((m) => m[0]);
}

describe('the create wizard cannot refuse silently', () => {
  it('found the gates and the messages at all (anti-vacuity)', () => {
    expect(gates().length, 'no validateStep gate found - every rule below is vacuous').toBeGreaterThanOrEqual(2);
    expect(
      errorRenderSites().length,
      'no error messages found - every rule below is vacuous',
    ).toBeGreaterThanOrEqual(10);
  });

  it('⛔ every validation message is rendered through FieldError', () => {
    /*
      A raw <p> is invisible to `revealFirstError`, so one that slips back in
      is a message the person can again be left unable to find.
    */
    const raw = [...CODE.matchAll(/<p\b[^>]*>\s*\{errors\.([A-Za-z]+)\}/g)].map((m) => m[1]);
    expect(raw, 'these messages are raw <p> and cannot be found by the reveal').toEqual([]);

    for (const site of errorRenderSites()) {
      const i = CODE.indexOf(site);
      const before = CODE.slice(Math.max(0, i - 220), i);
      expect(
        /<FieldError\b/.test(before),
        `a validation message is not inside a FieldError: ${site}`,
      ).toBe(true);
    }
  });

  /**
   * One top-level function's body, bounded by the NEXT top-level function.
   *
   * ⚠️ Not a fixed character count. The first version of the rule below took
   * `slice(i, i + 700)`, which ran past the end of `FieldError` into
   * `revealFirstError` - whose own selector string contains
   * `[data-field-error]` - so deleting the marker from `FieldError` left the
   * rule green, satisfied by the NEXT FUNCTION. Caught by injection, and it
   * is `docs/123`'s lesson in another costume: a block finder has to stop at
   * the end of its block.
   */
  function fnBody(name: string): string {
    const i = CODE.indexOf(`function ${name}`);
    expect(i, `${name} is gone`).toBeGreaterThan(-1);
    const next = CODE.indexOf('\nfunction ', i + 1);
    return CODE.slice(i, next === -1 ? CODE.length : next);
  }

  it('⛔ FieldError emits the marker and announces itself', () => {
    const body = fnBody('FieldError');
    expect(body.length, 'the body slice is empty - the rule is vacuous').toBeGreaterThan(80);
    expect(body, 'no data-field-error marker - the reveal cannot find it').toContain('data-field-error');
    expect(body, 'no live region - a screen reader is told nothing').toContain('role="alert"');
  });

  it('⛔ the failure path of validateStep reveals the first message', () => {
    /*
      Wired HERE, not in the two callers: both callers are a bare return, and
      putting it in them would be two chances to forget. This is the single
      place both pass through.
    */
    const i = CODE.indexOf('function validateStep');
    expect(i, 'validateStep is gone').toBeGreaterThan(-1);
    const end = CODE.indexOf('\n  }', i);
    const body = CODE.slice(i, end);
    expect(body, 'validateStep does not reveal anything on failure').toContain('revealFirstError');
  });

  it('⛔ the reveal searches for the marker, never for the colour', () => {
    /*
      ⚠️ This is the Gate-4 point. `text-red-500` is also worn by a control
      that is NOT a validation message, so a colour-based search would match
      something that is not an error - a selector that cannot tell the fixed
      version from the broken one.
    */
    const body = fnBody('revealFirstError');
    expect(body).toContain('[data-field-error]');
    expect(body, 'the reveal keys on a styling class').not.toContain('text-red-500');
  });

  it('⚠️ the control: red text that is NOT a validation message stays unmarked', () => {
    /*
      Without this, "mark everything red" would satisfy the rules above while
      making the reveal jump to whichever red thing happens to sit highest -
      including a plain button.

      ⚠️ The first version counted OCCURRENCES of the two strings and asserted
      marked < reds. That can never fail: `data-field-error` appears about
      three times in the file however many elements wear it, against twenty
      reds. It has to compare ELEMENTS, so this reads the opening tags.
    */
    const redTags = [...CODE.matchAll(/<([A-Za-z]+)\b[^>]*text-red-500[^>]*>/g)].map((m) => m[1]);
    expect(redTags.length, 'no red elements found - the control is vacuous').toBeGreaterThan(1);
    expect(
      redTags.some((t) => t !== 'FieldError'),
      'every red element is a FieldError - there is no non-error red text left to confuse',
    ).toBe(true);

    /*
      ⛔ The load-bearing half, and it took two attempts. The marker may be
      worn ONLY by a FieldError.

      v1 asserted "at least one red element is unmarked", which an injection
      marking a single button did NOT break - because other unmarked red
      elements still existed, so the claim stayed true while the hazard was
      real. The property is the other direction: nothing but a validation
      message may carry the marker, or `revealFirstError` can scroll someone
      to a button.
    */
    /*
      The marker may appear in exactly two places: on the `<p>` inside
      `FieldError`, and in `revealFirstError`'s selector. A third occurrence
      means somebody hand-marked an element, and the reveal can then scroll
      to whatever that is.

      ⚠️ Deliberately a count, not a tag match. Two earlier versions matched
      the opening tag with `<([A-Za-z]+)\b[^>]*data-field-error[^>]*>`, and
      `[^>]*` stops at the first `>` - which in JSX is routinely inside an
      `onClick={() => …}`, so the tag was never matched and an injection
      marking a button did not fire. Counting cannot be defeated that way.
    */
    const occurrences = [...CODE.matchAll(/data-field-error/g)].length;
    expect(
      occurrences,
      'data-field-error appears somewhere beyond FieldError and the reveal selector',
    ).toBe(2);
  });
});
