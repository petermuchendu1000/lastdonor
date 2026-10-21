/**
 * Measure the reading level of outgoing email.
 *
 * ## Why a number
 *
 * "Make it clearer" is not reviewable and does not survive the next
 * contributor. Every template in this codebase was written by someone
 * trying to be clear, and 20 of 45 still landed above the budget. A score
 * makes the disagreement concrete, and a ratchet keeps it from drifting
 * back one well-meaning sentence at a time.
 *
 * ## The budget, and where it comes from
 *
 * The audience is a person who may have left school early and may be
 * reading in a second language, deciding whether to trust us with money or
 * acting on a deadline that costs them funds if they miss it.
 *
 * - `grade <= 8` — Flesch-Kincaid US school grade. Plain-language guidance
 *   puts general-audience material at grade 8 or below; it is also where
 *   most second-language readers stop having to re-read.
 * - `longest <= 20` — words in the longest sentence. Sentence length is the
 *   single biggest barrier, and it is the one an author controls directly.
 * - `jargon` — words precise to us and opaque to a reader. The map below
 *   doubles as the house glossary.
 *
 * ## What it reads
 *
 * The AST of the template files, pulling only literal text spans. It does
 * NOT render the templates, because rendering means supplying arguments for
 * 45 differently-shaped functions; the prose is the same either way.
 *
 * Two measurement bugs are worth knowing about, because both made the
 * numbers worse than useless until they were found (see `docs/94`):
 *
 * 1. Block ends must become full stops BEFORE tags are stripped. A heading
 *    carries no terminal punctuation, so a naive strip runs it into the
 *    paragraph below and reports one long sentence where the reader sees
 *    two short ones. That alone flagged 32 templates that were fine.
 * 2. Template literals must be read as their TEXT SPANS, never `getText()`.
 *    `getText()` returns source, and a nested interpolation such as
 *    `${ctaButton(`${BASE_URL}/x`, 'Go')}` defeats any regex strip, leaving
 *    `'#D97706', '#fffbeb' )}` in the prose to be counted as a sentence.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** The files holding outgoing copy. */
export const EMAIL_SOURCE_FILES = [
  'src/lib/email-templates.ts',
  'src/lib/email-adaptive.ts',
];

export const BUDGET = { grade: 8, longestSentence: 20 } as const;

/**
 * Words that carry meaning for us and not for a reader, mapped to what we
 * say instead. This is the house glossary: add to it rather than arguing
 * the same word twice.
 */
export const JARGON: Record<string, string> = {
  organiser: 'you / the person who started the campaign',
  organizer: 'you / the person who started the campaign',
  campaigner: 'you',
  disburse: 'send',
  disbursed: 'sent',
  disbursement: 'payment',
  remittance: 'payment',
  reinstated: 'turned back on',
  revoked: 'removed',
  'verification documents': 'your ID / your papers',
  authenticate: 'sign in',
  credentials: 'password',
  initiate: 'start',
  initiated: 'started',
  terminate: 'end',
  terminated: 'ended',
  commence: 'start',
  utilise: 'use',
  utilize: 'use',
  endeavour: 'try',
  requisite: 'needed',
  pursuant: 'under',
  aforementioned: 'this',
  notwithstanding: 'even so',
  furthermore: 'also',
  moreover: 'also',
  accordingly: 'so',
  subsequently: 'then',
  'in order to': 'to',
  'at this time': 'now',
  'please be advised': 'drop it and say the thing',
  'we regret to inform': 'say what happened',
  facilitate: 'help',
  ascertain: 'find out',
  indefinitely: 'with no end date',
  discrepancy: 'difference',
  deprecated: 'no longer used',
};

/** Our own words, which are fine and should not count as hard. */
const ALLOWED_HARD = new Set([
  'lastdonor', 'donation', 'donations', 'donated', 'donor', 'donors',
  'campaign', 'campaigns', 'email', 'password', 'dashboard', 'verified',
  'approved', 'approves', 'receipt', 'anonymous', 'notification',
  'notifications', 'organisation', 'unsubscribe', 'review', 'reviewer',
  'reviews', 'reviewed', 'company', 'available', 'already', 'every',
]);

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

/** Is this string literal copy a reader sees, or machinery? */
function isProse(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 4) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(t)) return false;
  if (/^(https?:|\/|mailto:)/.test(t)) return false;
  if (!/[a-z]{3}/i.test(t)) return false;
  if (!/\s/.test(t)) return false;
  if (/^[a-z0-9_-]+(\s+[a-z0-9_-]+)*$/.test(t) && !/[A-Z]/.test(t) && t.length < 12) return false;
  return true;
}

/** Markup out, sentences in. Block ends become full stops FIRST — see the header. */
function prose(raw: string): string {
  return raw
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<\/(p|li|h1|h2|h3|h4|td|blockquote|div)>/g, '. ')
    .replace(/<br\s*\/?>/g, '. ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z]{3}/i.test(s));
}

export interface Score {
  grade: number;
  longest: number;
  words: number;
  sentences: number;
  hard: string[];
  jargon: string[];
  longSentences: string[];
}

export function score(text: string): Score | null {
  const sentences = sentencesOf(text);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (!sentences.length || !words.length) return null;

  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;

  const lengths = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const lower = text.toLowerCase();

  return {
    grade: Math.round(grade * 10) / 10,
    longest: Math.max(...lengths),
    words: words.length,
    sentences: sentences.length,
    hard: [
      ...new Set(
        words
          .map((w) => w.toLowerCase().replace(/[^a-z]/g, ''))
          .filter((b) => b.length > 3 && !ALLOWED_HARD.has(b) && syllables(b) >= 3),
      ),
    ],
    jargon: Object.keys(JARGON).filter((j) => lower.includes(j.toLowerCase())),
    longSentences: sentences.filter((_, i) => lengths[i] > BUDGET.longestSentence),
  };
}

/**
 * Score a fragment of email HTML.
 *
 * `score` takes prose that has already been stripped; this takes the
 * markup. Callers kept reaching for `score` with raw HTML and getting a
 * quietly wrong answer — tags were counted as words and a missing full
 * stop merged two sentences into one — so the stripping step is no longer
 * something you can forget.
 */
export function scoreHtml(html: string): Score | null {
  return score(prose(html));
}

export interface Template {
  name: string;
  file: string;
  text: string;
}

/** `{ name, text }` for every exported template function in `file`. */
export function extractTemplates(file: string): Template[] {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: Template[] = [];

  sf.forEachChild((node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name) return;
    if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return;

    const parts: string[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isTemplateExpression(n)) {
        parts.push(n.head.text);
        n.templateSpans.forEach((span) => parts.push(span.literal.text));
      } else if (ts.isNoSubstitutionTemplateLiteral(n)) {
        parts.push(n.text);
      } else if (ts.isStringLiteral(n) && isProse(n.text)) {
        parts.push(n.text);
      }
      n.forEachChild(walk);
    };
    if (node.body) node.body.forEachChild(walk);

    // Joined with a full stop: subject, body and button label are separate
    // strings that a reader never reads as one running sentence.
    const text = prose(parts.join('. ')).replace(/\.\s*\./g, '.');
    if (text.split(/\s+/).length < 6) return; // a helper, not copy
    out.push({ name: node.name.text, file, text });
  });

  return out;
}

export interface Measured extends Template, Score {}

export function measureAll(files: string[] = EMAIL_SOURCE_FILES): Measured[] {
  const rows: Measured[] = [];
  for (const f of files) {
    for (const t of extractTemplates(f)) {
      const s = score(t.text);
      if (s) rows.push({ ...t, ...s });
    }
  }
  return rows;
}

export function failures(rows: Measured[]): Measured[] {
  return rows.filter(
    (r) => r.grade > BUDGET.grade || r.longest > BUDGET.longestSentence || r.jargon.length > 0,
  );
}
