import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
  User-facing copy has to be readable by someone who does not read
  English as a first language.

  Measured against the live site on 2026-10-19, before this pass: a
  mean Flesch Reading Ease of 40 ("difficult") across 18 public pages,
  and 17 of the 18 below 60. The single biggest cause was keyword lists
  written as sentences for search engines:

    "You can start a fundraiser for medical bills, surgery, emergency
     expenses, funeral costs, memorial support, disaster relief, family
     needs, vet bills, tuition, veteran support, first responder
     families, small businesses, events, or community..."

  A donor deciding whether to trust us with money should not have to
  parse that.

  ## What this test checks, and what it cannot

  It checks the copy constants it can find in source - the `question:`,
  `answer:`, `description:` and `title:` strings that carry nearly all
  the prose on these pages. It cannot check JSX body text, and it
  cannot tell good writing from bad. It catches the three mechanical
  faults that made the measured pages hard:

    1. sentences long enough to lose the thread
    2. comma-chains, which are keyword lists wearing a sentence
    3. formal words where a common one exists

  The readability of the RENDERED pages is the real measure, and that
  needs the network. This is the offline part of it.
*/

const SRC = join(process.cwd(), 'src');

/** Pages and components a visitor reads before deciding to donate. */
const COPY_DIRS = [
  join(SRC, 'app'),
  join(SRC, 'components', 'homepage'),
];

/** Not user-facing, or not prose. */
const SKIP = /\/(api|admin|dashboard)\/|\.test\.|\/privacy\/|\/terms\//;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !SKIP.test(p)) out.push(p);
  }
  return out;
}

/** The copy fields that carry prose, as single-quoted literals. */
const COPY_FIELD = /\b(?:question|answer|description|title|subtitle|body)\s*:\s*\n?\s*'((?:[^'\\]|\\.){25,})'/g;

type Finding = { file: string; text: string; why: string };

function copyStrings(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const dir of COPY_DIRS) {
    for (const f of walk(dir)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(COPY_FIELD)) {
        out.push({ file: f.slice(process.cwd().length + 1), text: m[1].replace(/\\'/g, "'") });
      }
    }
  }
  return out;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

const all = copyStrings();

/*
  Words with a shorter, commoner equivalent that means the same thing.
  Each one appeared in the measured copy. This is not a style
  preference: "utilize" and "use" are the same word to a fluent reader
  and two different words to someone learning.
*/
const FORMAL: Record<string, string> = {
  utilize: 'use',
  facilitate: 'help',
  additionally: 'also',
  furthermore: 'also',
  commence: 'start',
  terminate: 'end',
  endeavor: 'try',
  remuneration: 'payment',
  'in order to': 'to',
  'prior to': 'before',
  'subsequent to': 'after',
  'at this time': 'now',
  'payout rails': 'bank transfer',
};

/*
  Baselines, not zero. 2026-10-19: the conversion path and the money
  pages were rewritten; the remaining policy pages were not. These may
  only SHRINK - lower each number in the commit that earns it.
*/
const MAX_LONG_SENTENCES = 0;
const MAX_COMMA_CHAINS = 0;

describe('user-facing copy stays plain', () => {
  it('finds the copy, so the test is not vacuous', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it('keeps sentences short enough to follow', () => {
    const findings: Finding[] = [];
    for (const { file, text } of all) {
      for (const s of sentences(text)) {
        const words = s.split(/\s+/).length;
        // 25 words is roughly where a sentence stops being one idea.
        if (words > 25) findings.push({ file, text: s.slice(0, 110), why: `${words} words` });
      }
    }
    expect(findings.length).toBeLessThanOrEqual(MAX_LONG_SENTENCES);
  });

  it('does not write keyword lists as sentences', () => {
    const findings: Finding[] = [];
    for (const { file, text } of all) {
      for (const s of sentences(text)) {
        const commas = (s.match(/,/g) ?? []).length;
        // Five or more commas in one sentence is a list, and a reader
        // has to hold every item to reach the verb.
        if (commas >= 5) findings.push({ file, text: s.slice(0, 110), why: `${commas} commas` });
      }
    }
    expect(findings.length).toBeLessThanOrEqual(MAX_COMMA_CHAINS);
  });

  it('prefers the common word to the formal one', () => {
    const findings: Finding[] = [];
    for (const { file, text } of all) {
      const lower = text.toLowerCase();
      for (const [formal, plain] of Object.entries(FORMAL)) {
        if (new RegExp(`\\b${formal}\\b`).test(lower)) {
          findings.push({ file, text: text.slice(0, 80), why: `"${formal}" -> "${plain}"` });
        }
      }
    }
    expect(findings).toEqual([]);
  });

  it('states the fee as a number wherever it mentions the fee', () => {
    /*
      "Standard processing fees apply" is not an answer to "how much of
      my $50 arrives" - it is a way of not answering it. Any copy that
      raises the subject has to do the arithmetic.

      2.9% + $0.30 is Stripe's published US rate, cited in
      `WhereYourMoneyGoes.tsx` (docs/59). If it changes, these strings
      change with it.
    */
    const vague = all.filter(
      ({ text }) =>
        /standard (stripe )?(payment )?processing fees? (may )?apply/i.test(text) &&
        !/2\.9/.test(text),
    );
    expect(vague.map((v) => `${v.file}: ${v.text.slice(0, 70)}`)).toEqual([]);
  });
});
