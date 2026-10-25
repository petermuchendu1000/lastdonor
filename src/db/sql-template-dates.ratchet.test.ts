/**
 * A `Date` may not be interpolated into a `sql` template.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ──────────────────────────────────────────
 *
 * [VERIFIED 2026-10-25, Postgres 16] `/admin/reports` answered **500 on every
 * load** because its period query did this:
 *
 *   sql`... FILTER (WHERE ${donations.createdAt} >= ${startOfYear} ...)`
 *
 * `startOfYear` is a JS `Date`. A typed builder - `gte(donations.createdAt,
 * startOfYear)` - knows the column, so it encodes the value with that
 * column's `mapToDriverValue`. A `sql` template does not: the value becomes a
 * parameter with NO encoder and reaches postgres-js as a live `Date`, which
 * it cannot serialise:
 *
 *   TypeError: The "string" argument must be of type string or an instance of
 *              Buffer or ArrayBuffer. Received an instance of Date
 *
 * ── WHY IT HAS TO BE A TYPE CHECK, NOT A GREP ───────────────────────────────
 *
 * The hazard is the TYPE of the interpolated expression, and nothing about
 * the source text reveals it. `${since}` is fine when `since` is a string and
 * fatal when it is a `Date`; the two read identically. So this builds a real
 * TypeScript program and asks the checker. That costs about eight seconds,
 * which is the price of a check that can actually fail.
 *
 * ── THE FIX, IN ONE LINE ────────────────────────────────────────────────────
 *
 * `sql.param(value, column)`. The second argument is the encoder. Or step out
 * of the template and use `gte` / `lte` / `between`, which carry it for you.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();

interface Offence {
  file: string;
  line: number;
  expression: string;
  type: string;
}

/** A tag is ours if it is `sql`, `sql<T>` or `something.sql`. */
function isSqlTag(tag: ts.Expression): boolean {
  if (ts.isIdentifier(tag)) return tag.text === 'sql';
  if (ts.isPropertyAccessExpression(tag)) return tag.name.text === 'sql';
  return false;
}

function findOffences(): { offences: Offence[]; templatesScanned: number } {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error('tsconfig.json not found');

  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, (p) => readFileSync(p, 'utf8')).config,
    ts.sys,
    ROOT,
  );
  const program = ts.createProgram(config.fileNames, { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();

  const offences: Offence[] = [];
  let templatesScanned = 0;

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const file = relative(ROOT, sourceFile.fileName);
    if (!file.startsWith('src/')) continue;
    // This file's own examples are text in comments, not code, but be explicit.
    if (file.endsWith('sql-template-dates.ratchet.test.ts')) continue;

    const visit = (node: ts.Node): void => {
      if (
        ts.isTaggedTemplateExpression(node) &&
        isSqlTag(node.tag) &&
        ts.isTemplateExpression(node.template)
      ) {
        templatesScanned += 1;
        for (const span of node.template.templateSpans) {
          const type = checker.getTypeAtLocation(span.expression);
          // Strip null/undefined: `Date | null` is just as fatal when set.
          const nonNullable = checker.getNonNullableType(type);
          const printed = checker.typeToString(nonNullable);
          /*
            `Date` as a whole word, and not something that merely mentions it -
            a Column's type text can contain `Date` as a type argument
            (`PgTimestamp<...>`), and a Column is exactly what is SUPPOSED to
            be in there.
          */
          const isDate = /(^|[^A-Za-z0-9_])Date([^A-Za-z0-9_<]|$)/.test(printed);
          const isColumnOrFragment = /\b(Column|PgColumn|SQL|Table|Subquery|Aliased)\b/.test(printed);
          if (isDate && !isColumnOrFragment) {
            offences.push({
              file,
              line:
                sourceFile.getLineAndCharacterOfPosition(span.expression.getStart(sourceFile)).line + 1,
              expression: span.expression.getText(sourceFile),
              type: printed,
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
  }

  return { offences, templatesScanned };
}

describe('sql templates never bind a bare Date', () => {
  const { offences, templatesScanned } = findOffences();

  it('scanned a meaningful number of sql templates', () => {
    /*
      A check that silently stopped finding the templates would pass
      vacuously, which is the one failure mode a ratchet cannot have. There
      were 403 in `src/` when this was written.
    */
    expect(templatesScanned).toBeGreaterThan(250);
  });

  it('finds no Date-typed interpolation anywhere in src/', () => {
    const report = offences
      .map((o) => `  ${o.file}:${o.line}  \${${o.expression}}  is ${o.type}`)
      .join('\n');

    expect(
      offences,
      offences.length === 0
        ? ''
        : `A JS Date interpolated into a \`sql\` template is bound WITHOUT an\n` +
            `encoder and throws inside the driver at execution time - it is not a\n` +
            `type error and no unit test sees it. Wrap it:\n` +
            `  sql.param(value, theColumnItIsComparedWith)\n` +
            `or use gte()/lte()/between(), which carry the encoder.\n\n` +
            `${report}\n`,
    ).toEqual([]);
  });
}, 60_000);
