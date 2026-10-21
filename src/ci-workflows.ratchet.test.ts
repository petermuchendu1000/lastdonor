import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/*
  GitHub Actions workflow defects that are FATAL and LOCALLY INVISIBLE.

  ## Why this exists

  This repository's CI pipeline did not run once in its entire history.
  `docs/50` chased it for five days across two amendments and could not
  explain it, because every local check passed: the YAML was valid, the
  workflow was registered, `state: active`, and the file looked right.

  The cause was one character class. `.github/workflows/ci.yml` contained

      results='${{ join(needs.*.result, " ") }}'

  and GitHub Actions expressions accept ONLY single-quoted string
  literals. A double-quoted one is an expression parse error:

      failed to parse workflow: (Line: 181, Col: 14): Unexpected symbol: '"'.
      Located at position 22 within expression: join(needs.*.result, " ")

  A workflow that fails to parse is never queued, so it produces no run,
  no check run, and no annotation - nothing to look at. The signature of
  a fatal error is identical to the signature of nothing happening.

  The reason no local tool caught it: **the YAML was always valid.** A
  YAML parser reads that line as a plain string and is happy. It is
  GitHub's own *expression* parser, a second language nested inside the
  YAML, that rejects it - and that parser does not run until a dispatch
  reaches GitHub. `actionlint` would catch it; it is a Go binary and is
  not installed here.

  So this ratchet encodes the nested-language rules that no YAML parser
  can see, for the cases known to be fatal. It is deliberately NOT a
  general Actions validator: each rule below is a defect this project
  either hit or came one edit away from hitting.

  Adding a rule is cheap and worth it. Every hour this pipeline is dark
  is an hour the integration and E2E suites gate nothing (`docs/50` §3).
*/

const WORKFLOW_DIR = join(process.cwd(), '.github', 'workflows');

interface Workflow {
  name: string;
  lines: string[];
}

function loadWorkflows(): Workflow[] {
  if (!existsSync(WORKFLOW_DIR)) return [];
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((name) => ({
      name,
      lines: readFileSync(join(WORKFLOW_DIR, name), 'utf8').split('\n'),
    }));
}

const workflows = loadWorkflows();

/**
 * Every `${{ … }}` in the file, with the 1-based line it starts on.
 *
 * Expressions can span lines (a folded `if:` block), so the scan runs
 * over the whole text and the line number is recovered from the offset.
 */
function expressions(lines: string[]): { line: number; body: string }[] {
  const text = lines.join('\n');
  const found: { line: number; body: string }[] = [];
  const re = /\$\{\{([\s\S]*?)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const line = text.slice(0, m.index).split('\n').length;
    found.push({ line, body: m[1] });
  }
  return found;
}

/** Strips a trailing `# comment`, which is prose and not evaluated. */
function withoutComment(line: string): string {
  const hash = line.indexOf('#');
  return hash === -1 ? line : line.slice(0, hash);
}

describe('CI workflow expressions', () => {
  it('finds the workflow directory at all', () => {
    // If this fails, every other assertion here is vacuously true - which
    // is how a ratchet quietly stops ratcheting.
    expect(existsSync(WORKFLOW_DIR)).toBe(true);
    expect(workflows.length).toBeGreaterThan(0);
  });

  /*
    THE defect. GitHub Actions expressions have exactly one string
    literal form: single quotes, with '' to escape a quote. A double
    quote is a parse error wherever it appears inside `${{ }}`.

    Note this checks only BETWEEN the braces. Quoting the whole
    interpolation from the shell's point of view is fine and common:
    `--project="${{ matrix.project }}"` has its double quotes outside
    the expression, where they belong to bash, not to Actions.
  */
  it('never uses a double-quoted string literal inside ${{ }}', () => {
    const offenders: string[] = [];
    for (const wf of workflows) {
      for (const { line, body } of expressions(wf.lines)) {
        if (body.includes('"')) {
          offenders.push(`${wf.name}:${line} -> \${{${body}}}`);
        }
      }
    }
    expect(
      offenders,
      'GitHub Actions expressions accept ONLY single-quoted strings. A ' +
        'double-quoted literal is a parse error, and a workflow that fails ' +
        'to parse is never queued - no run, no check run, no annotation. ' +
        'This is exactly why CI never ran; see docs/50.',
    ).toEqual([]);
  });

  /*
    `runs-on` is evaluated before a runner exists, so the contexts it
    can read are limited to `github`, `needs`, `strategy`, `matrix`,
    `vars` and `inputs`. `env` is NOT among them: `${{ env.X }}` there
    resolves to empty and the job is invalid ("Value cannot be null").

    Caught while pinning the runner image away from `ubuntu-latest`,
    which is migrating to Ubuntu 26 from 2026-10-19. Hoisting the label
    into the top-level `env:` block would have reproduced the original
    outage in a new costume.
  */
  it('never reads the env context from runs-on', () => {
    const offenders: string[] = [];
    for (const wf of workflows) {
      wf.lines.forEach((raw, i) => {
        const line = withoutComment(raw);
        if (!/^\s*runs-on\s*:/.test(line)) return;
        if (/\benv\./.test(line)) {
          offenders.push(`${wf.name}:${i + 1} -> ${raw.trim()}`);
        }
      });
    }
    expect(
      offenders,
      '`runs-on` cannot read the `env` context (only github, needs, ' +
        'strategy, matrix, vars, inputs). `${{ env.X }}` there resolves ' +
        'to empty and invalidates the job. Write the label literally.',
    ).toEqual([]);
  });

  /*
    `secrets` is not available in a job-level `if:` either. That is why
    ci.yml has a `config` job whose only purpose is to probe
    `TEST_DATABASE_URL` into an output that the DB-backed jobs CAN read
    through `needs`. Someone simplifying that away would get a condition
    that silently evaluates to false and skips integration and E2E
    forever - the failure mode docs/50 §2.3 was written about.
  */
  it('never reads the secrets context from a job-level if', () => {
    const offenders: string[] = [];
    for (const wf of workflows) {
      wf.lines.forEach((raw, i) => {
        const line = withoutComment(raw);
        // A job-level key sits at 4-space indent (jobs: > <id>: > if:).
        if (!/^ {4}if\s*:/.test(line)) return;
        // Folded/literal block scalars carry the expression on the
        // following lines, so take the whole run of deeper-indented text.
        let body = line;
        if (/[>|][-+]?\s*$/.test(line)) {
          for (let j = i + 1; j < wf.lines.length; j++) {
            if (!/^\s{5,}\S/.test(wf.lines[j])) break;
            body += '\n' + wf.lines[j];
          }
        }
        if (/\bsecrets\./.test(body)) {
          offenders.push(`${wf.name}:${i + 1} -> ${raw.trim()}`);
        }
      });
    }
    expect(
      offenders,
      'The `secrets` context is not readable from a job-level `if:`; the ' +
        'condition evaluates to false and the job is skipped silently. ' +
        'Probe the secret in a prior job and read it via `needs` outputs, ' +
        'as ci.yml\'s `config` job does.',
    ).toEqual([]);
  });

  /*
    A `needs:` naming a job that does not exist invalidates the whole
    workflow, and like the quoting bug it is invisible until a dispatch.
    Job ids are the keys at 2-space indent beneath top-level `jobs:`.
  */
  it('only declares needs on jobs that exist', () => {
    const offenders: string[] = [];
    for (const wf of workflows) {
      const jobIds = new Set<string>();
      let inJobs = false;
      for (const raw of wf.lines) {
        if (/^jobs\s*:/.test(raw)) {
          inJobs = true;
          continue;
        }
        if (inJobs && /^\S/.test(raw)) break; // left the jobs block
        const m = inJobs ? /^ {2}([A-Za-z0-9_-]+)\s*:\s*$/.exec(raw) : null;
        if (m) jobIds.add(m[1]);
      }

      // The scan is only meaningful if it actually found the job ids.
      expect(jobIds.size, `${wf.name}: found no job ids`).toBeGreaterThan(0);

      wf.lines.forEach((raw, i) => {
        const line = withoutComment(raw);
        // Inline form: `needs: [a, b]` or `needs: a`
        const inline = /^\s*needs\s*:\s*(.+)$/.exec(line);
        if (inline) {
          const names = inline[1]
            .replace(/[[\]]/g, '')
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          for (const n of names) {
            if (!jobIds.has(n)) offenders.push(`${wf.name}:${i + 1} -> ${n}`);
          }
          return;
        }
        // Block form: `needs:` followed by `- name` entries.
        if (/^\s*needs\s*:\s*$/.test(line)) {
          for (let j = i + 1; j < wf.lines.length; j++) {
            const item = /^\s*-\s*([A-Za-z0-9_-]+)\s*$/.exec(
              withoutComment(wf.lines[j]),
            );
            if (!item) break;
            if (!jobIds.has(item[1])) {
              offenders.push(`${wf.name}:${j + 1} -> ${item[1]}`);
            }
          }
        }
      });
    }
    expect(
      offenders,
      'A `needs:` entry names a job that does not exist, which makes the ' +
        'whole workflow invalid and therefore unqueueable.',
    ).toEqual([]);
  });
});
