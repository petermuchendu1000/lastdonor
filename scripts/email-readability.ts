/**
 * Print the reading level of every outgoing email, worst first.
 *
 *   npx tsx scripts/email-readability.ts
 *   npx tsx scripts/email-readability.ts --verbose   # show the long sentences
 *
 * The budget, the glossary and the measurement all live in
 * `src/lib/email-readability.ts`, so this CLI and the ratchet test
 * (`src/lib/email-plain-language.ratchet.test.ts`) cannot disagree.
 * See `docs/94`.
 */
import { BUDGET, JARGON, measureAll, failures } from '../src/lib/email-readability';

const verbose = process.argv.includes('--verbose');
const rows = measureAll().sort((a, b) => b.grade - a.grade);
const bad = failures(rows);

console.log(
  `${rows.length} templates measured. ${bad.length} exceed the budget ` +
    `(grade <= ${BUDGET.grade}, longest sentence <= ${BUDGET.longestSentence} words, no jargon).\n`,
);
console.log('grade  longest  jargon  template');
console.log('-----  -------  ------  --------');

for (const r of rows) {
  const flags = bad.includes(r) ? '!' : ' ';
  console.log(
    `${String(r.grade).padStart(5)}${flags} ${String(r.longest).padStart(7)}  ` +
      `${String(r.jargon.length).padStart(6)}  ${r.name}`,
  );
  if (verbose && r.jargon.length) {
    for (const j of r.jargon) console.log(`         jargon: "${j}" -> ${JARGON[j]}`);
  }
  if (verbose) {
    for (const s of r.longSentences) {
      console.log(`         LONG (${s.split(/\s+/).length}w): ${s}`);
    }
  }
}

const avg = rows.reduce((n, r) => n + r.grade, 0) / rows.length;
console.log(`\naverage grade: ${Math.round(avg * 10) / 10}`);
process.exit(bad.length ? 1 : 0);
