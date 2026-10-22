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

interface Job {
  id: string;
  line: number;
  /** The job's own lines, excluding the `  <id>:` header. */
  body: string[];
}

/**
 * Every job in a workflow, with its block of lines.
 *
 * Line-based on purpose. The obvious implementation imports a YAML parser,
 * but the only one resolvable in this tree is `js-yaml`, reachable solely as
 * an undeclared transitive dependency - which is the exact defect this
 * commit fixed for `glob` (docs/97). A build gate should not rest on a
 * package nothing declares, so this reads the text.
 */
function jobsOf(wf: Workflow): Job[] {
  const out: Job[] = [];
  let inJobs = false;
  let current: Job | null = null;

  wf.lines.forEach((raw, i) => {
    if (/^jobs\s*:/.test(raw)) {
      inJobs = true;
      return;
    }
    if (!inJobs) return;
    // A non-indented, non-blank line ends the jobs block.
    if (/^\S/.test(raw)) {
      inJobs = false;
      current = null;
      return;
    }
    const header = /^ {2}([A-Za-z0-9_-]+)\s*:\s*$/.exec(raw);
    if (header) {
      current = { id: header[1], line: i + 1, body: [] };
      out.push(current);
      return;
    }
    if (current) current.body.push(raw);
  });

  return out;
}

/** The widest `strategy.matrix` axis, i.e. how many times the job runs. */
function matrixLegs(job: Job): number {
  let legs = 1;
  let inMatrix = false;
  let axis = 0;

  for (const raw of job.body) {
    const line = withoutComment(raw);
    if (/^ {6}matrix\s*:\s*$/.test(line)) {
      inMatrix = true;
      axis = 0;
      continue;
    }
    if (!inMatrix) continue;

    // Left the matrix block: back to 6-space (another strategy key) or less.
    if (/^\s*\S/.test(line) && !/^ {8,}/.test(line)) {
      legs = Math.max(legs, axis);
      inMatrix = false;
      continue;
    }
    // An axis key: `        project:` - flush the previous axis.
    if (/^ {8}[A-Za-z0-9_-]+\s*:\s*$/.test(line)) {
      legs = Math.max(legs, axis);
      axis = 0;
      continue;
    }
    // Inline list: `        project: ['a', 'b']`
    const inline = /^ {8}[A-Za-z0-9_-]+\s*:\s*\[(.+)\]\s*$/.exec(line);
    if (inline) {
      legs = Math.max(legs, inline[1].split(',').filter((s) => s.trim()).length);
      continue;
    }
    // Block list item under the current axis.
    if (/^ {10}-\s*\S/.test(line)) axis += 1;
  }

  return Math.max(legs, axis, 1);
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

/*
  ── Consumption ───────────────────────────────────────────────────────────

  These are not correctness rules. They bound what a wedged pipeline can
  spend, which is a different failure mode and one that stays silent for
  six hours before it shows up on an invoice.

  GitHub's default job timeout is 360 minutes and nothing warns you about
  it. This repository is public, so its standard-runner minutes are free and
  it has never cost anything - but "free" is a property of the repository's
  visibility, not of the workflow, and flipping a repository to private is
  one click. See docs/97.

  PER_JOB_CEILING is the load-bearing rule: it bounds the blast radius of
  any single job, and because a matrix leg is a job it bounds each leg too.
  TOTAL_BUDGET then keeps the worst case computable at a glance.
*/
const PER_JOB_CEILING = 30;
const TOTAL_BUDGET = 200;

/*
  Runner labels that are FREE on a public repository.

  This is the loophole in "our repository is public, so CI is free".
  GitHub's billing documentation is explicit, and the second sentence is the
  one that matters (docs.github.com, Billing → GitHub Actions, read
  2026-10-22):

    "GitHub Actions usage is free for self-hosted runners and for public
     repositories that use standard GitHub-hosted runners."
    "Larger runners are always charged for, even when used by public
     repositories."

  So a single edit from `ubuntu-24.04` to a larger label starts metering a
  repository that currently cannot cost anything, and nothing about the
  change looks like a billing decision. This project only needs Linux, so
  the allow-list is deliberately narrow: adding a label means editing this
  list, which is the point.
*/
const FREE_RUNNER_LABELS = new Set([
  'ubuntu-24.04',
  'ubuntu-22.04',
  'ubuntu-latest',
]);

describe('CI workflow consumption', () => {
  it('declares timeout-minutes on every job', () => {
    const offenders: string[] = [];
    for (const wf of workflows) {
      const jobs = jobsOf(wf);
      expect(jobs.length, `${wf.name}: found no jobs`).toBeGreaterThan(0);
      for (const job of jobs) {
        const has = job.body.some((l) =>
          /^ {4}timeout-minutes\s*:\s*\d+\s*$/.test(withoutComment(l)),
        );
        if (!has) offenders.push(`${wf.name}:${job.line} -> ${job.id}`);
      }
    }
    expect(
      offenders,
      'A job with no `timeout-minutes` inherits GitHub\'s 360-minute ' +
        'default. Nine job instances at 360 is 3,240 job-minutes of ' +
        'exposure from one hung step, with no warning until it bills. ' +
        'Size the timeout from a measured run and write it down.',
    ).toEqual([]);
  });

  it('keeps every job under the per-job ceiling', () => {
    const offenders: string[] = [];
    for (const wf of workflows) {
      for (const job of jobsOf(wf)) {
        for (const raw of job.body) {
          const m = /^ {4}timeout-minutes\s*:\s*(\d+)\s*$/.exec(withoutComment(raw));
          if (m && Number(m[1]) > PER_JOB_CEILING) {
            offenders.push(`${wf.name}: ${job.id} = ${m[1]} min`);
          }
        }
      }
    }
    expect(
      offenders,
      `No job may declare more than ${PER_JOB_CEILING} minutes. If a job ` +
        'genuinely needs longer, split it or make it faster - do not raise ' +
        'the ceiling to make it fit.',
    ).toEqual([]);
  });

  it('only uses runners that are free on a public repository', () => {
    const offenders: string[] = [];
    let seen = 0;

    for (const wf of workflows) {
      wf.lines.forEach((raw, i) => {
        const m = /^\s*runs-on\s*:\s*(.+)$/.exec(withoutComment(raw));
        if (!m) return;
        seen += 1;
        const labels = m[1]
          .trim()
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        for (const label of labels) {
          if (!FREE_RUNNER_LABELS.has(label)) {
            offenders.push(`${wf.name}:${i + 1} -> ${label}`);
          }
        }
      });
    }

    // Guard against the scan silently matching nothing.
    expect(seen, 'found no `runs-on` lines to check').toBeGreaterThan(0);

    expect(
      offenders,
      'A larger GitHub-hosted runner is billed EVEN ON A PUBLIC ' +
        'REPOSITORY, so this label change is a billing decision wearing ' +
        'the costume of a performance tweak. If it is intended, add the ' +
        'label to FREE_RUNNER_LABELS above and say in the commit why the ' +
        'cost is acceptable.',
    ).toEqual([]);
  });

  it('keeps the whole pipeline inside the total budget', () => {
    const report: string[] = [];
    let total = 0;

    for (const wf of workflows) {
      for (const job of jobsOf(wf)) {
        const legs = matrixLegs(job);
        for (const raw of job.body) {
          const m = /^ {4}timeout-minutes\s*:\s*(\d+)\s*$/.exec(withoutComment(raw));
          if (!m) continue;
          const cost = Number(m[1]) * legs;
          total += cost;
          report.push(`${job.id}: ${m[1]} x ${legs} leg(s) = ${cost}`);
        }
      }
    }

    // The matrix arithmetic has to actually work, or this budget is a
    // vacuous sum and the e2e legs are counted once instead of twice.
    expect(report.some((r) => /x 2 leg/.test(r)), report.join('\n')).toBe(true);

    expect(
      total,
      `Worst-case pipeline cost is ${total} job-minutes:\n${report.join('\n')}`,
    ).toBeLessThanOrEqual(TOTAL_BUDGET);
  });
});
