/**
 * Ratchet: one Node version, declared in four places, and they agree.
 *
 * ## What went wrong
 *
 * `.github/workflows/ci.yml` pinned `NODE_VERSION: '20'`. Nothing else in
 * the project did. `.nvmrc` says `22`, the Dockerfile builds and runs on
 * `node:22-bookworm-slim`, and every developer machine follows `.nvmrc`.
 *
 * So CI was the only place on Node 20, which has two consequences and both
 * are bad:
 *
 * 1. It cannot catch a defect that needs Node 22 to appear, because nothing
 *    it runs is the runtime production uses.
 * 2. It invents failures that exist in no real environment. On run 3 - the
 *    first CI run in this repository's history to reach a runner at all -
 *    `src/components/ui/money-currency.ratchet.test.ts` imported `globSync`
 *    from `node:fs`, which exists only from Node 22. Three tests failed red
 *    in CI and passed for everyone, everywhere else.
 *
 * Node 20 was also END OF LIFE: 2026-04-30, verified against
 * `nodejs/Release`'s own `schedule.json` (fetched 2026-10-22, which is six
 * months after). CI was gating this project on an unsupported runtime.
 *
 * ## Why a test and not a comment
 *
 * The drift is invisible by construction. Each of the four files is correct
 * on its own terms and none of them references the others, so no reviewer
 * reading any one file sees a problem - and the symptom only appears on a
 * runner, which in this repository had never happened (`docs/50`). A
 * four-way agreement is exactly the kind of invariant that has to be
 * asserted somewhere or it rots. See docs/97.
 *
 * Majors only. Patch and minor drift between a runner image and a Docker
 * base tag is normal and harmless; a major is a different language edition.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function read(rel: string): string {
  const path = join(ROOT, rel);
  // A missing file would make the assertions below vacuously true, which is
  // how a ratchet quietly stops ratcheting.
  expect(existsSync(path), `${rel} is missing`).toBe(true);
  return readFileSync(path, 'utf8');
}

/** `.nvmrc` holds a bare version, optionally `v`-prefixed. */
function nvmrcMajor(): number {
  const raw = read('.nvmrc').trim();
  const m = /^v?(\d+)/.exec(raw);
  expect(m, `.nvmrc does not start with a version: ${JSON.stringify(raw)}`).not.toBeNull();
  return Number(m![1]);
}

/** `ARG NODE_IMAGE=node:22-bookworm-slim` in the Dockerfile. */
function dockerfileMajor(): number {
  const src = read('Dockerfile');
  const m = /^\s*ARG\s+NODE_IMAGE\s*=\s*node:(\d+)/m.exec(src);
  expect(m, 'Dockerfile has no `ARG NODE_IMAGE=node:<major>...` line').not.toBeNull();
  return Number(m![1]);
}

/** `NODE_VERSION: '22'` in the workflow's top-level env block. */
function workflowMajors(): { file: string; major: number }[] {
  const dir = join(ROOT, '.github', 'workflows');
  expect(existsSync(dir), '.github/workflows is missing').toBe(true);

  const found: { file: string; major: number }[] = [];

  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const src = readFileSync(join(dir, file), 'utf8');
    const re = /^\s*NODE_VERSION\s*:\s*'?"?v?(\d+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      found.push({ file, major: Number(m[1]) });
    }
  }
  return found;
}

/** The floor in `package.json`'s `engines.node`, e.g. `>=22`. */
function enginesFloor(): number {
  const pkg = JSON.parse(read('package.json')) as { engines?: { node?: string } };
  const spec = pkg.engines?.node;
  expect(
    spec,
    'package.json declares no `engines.node`, so nothing states the Node ' +
      'floor that .nvmrc, the Dockerfile and the test suite all assume.',
  ).toBeTruthy();
  const m = /(\d+)/.exec(spec!);
  expect(m, `engines.node has no version in it: ${spec}`).not.toBeNull();
  return Number(m![1]);
}

describe('Node version agreement', () => {
  it('finds a NODE_VERSION to check at all', () => {
    const majors = workflowMajors();
    expect(
      majors.length,
      'No workflow declares NODE_VERSION. If the workflows stopped setting ' +
        'it, this ratchet is asserting nothing - either restore it or ' +
        'delete this file deliberately.',
    ).toBeGreaterThan(0);
  });

  it('agrees across .nvmrc, the Dockerfile, engines and every workflow', () => {
    const nvmrc = nvmrcMajor();
    const docker = dockerfileMajor();
    const engines = enginesFloor();
    const workflows = workflowMajors();

    const detail =
      `.nvmrc=${nvmrc} Dockerfile=${docker} engines>=${engines} ` +
      workflows.map((w) => `${w.file}=${w.major}`).join(' ');

    expect(docker, `Dockerfile disagrees with .nvmrc (${detail})`).toBe(nvmrc);
    expect(engines, `engines.node disagrees with .nvmrc (${detail})`).toBe(nvmrc);
    for (const w of workflows) {
      expect(
        w.major,
        `${w.file} runs Node ${w.major} while the project is on ${nvmrc}. ` +
          'CI must run the runtime production runs, or it gates nothing it ' +
          `can be trusted on. (${detail})`,
      ).toBe(nvmrc);
    }
  });

  it('runs a Node version that is still supported', () => {
    /*
      Not a network call - the schedule is pinned here from
      nodejs/Release/schedule.json, fetched 2026-10-22. A ratchet that
      reaches the internet fails when the internet does.

      This is a floor, not a liveness check: it catches the specific
      mistake made here, which was pinning a major whose support had
      already ended. Update the table when a line expires.
    */
    const EOL: Record<number, string> = {
      18: '2025-04-30',
      20: '2026-04-30',
      22: '2027-04-30',
      24: '2028-04-30',
    };

    const major = nvmrcMajor();
    const end = EOL[major];
    expect(
      end,
      `Node ${major} is not in the pinned support table. Add it from ` +
        'nodejs/Release schedule.json, with the date you read it.',
    ).toBeTruthy();

    // Compared against a fixed date rather than `new Date()`: a test that
    // starts failing because time passed is a test that fails on an
    // unrelated pull request, at the worst possible moment.
    const AS_OF = '2026-10-22';
    expect(
      end! > AS_OF,
      `Node ${major} left support on ${end}, before ${AS_OF}. CI was ` +
        'pinned to an end-of-life Node once already; do not do it again.',
    ).toBe(true);
  });
});
