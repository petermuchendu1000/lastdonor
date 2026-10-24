/**
 * Turning the first page of a PDF into a PNG a vision model can read.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * The uploader accepts `application/pdf` at up to 10MB
 * (`verification/documents/route.ts:20-25`), which is right - a hospital
 * emails you a PDF. But a vision model cannot take one: [VERIFIED 2026-10-24]
 * sending a PDF data URL to OpenRouter returned HTTP **200** carrying
 * `{"error":{"message":"Upstream error from Nvidia: Internal server
 * error","code":502}}` and no `choices`. And `sharp` cannot help: this
 * project's libvips is built without poppler, so it answers
 * `Input file contains unsupported image format`.
 *
 * ── THE TRAP THAT MATTERS MOST: EXIT 0 IS NOT SUCCESS ───────────────────────
 *
 * [VERIFIED] `pdftoppm` exited **0, with empty stderr, and wrote 0 bytes** on
 * a malformed PDF. A check on the exit code alone would have called that a
 * successful rasterisation and handed an empty buffer to the model. So success
 * here means: exit 0 AND non-empty output AND the output starts with the PNG
 * magic bytes. Same family as every other 200-that-means-failure in this
 * codebase (`docs/92`, `docs/102`, `vision.ts`).
 *
 * ── AND ONE SHARP EDGE WORTH RECORDING ──────────────────────────────────────
 *
 * [VERIFIED] `pdftoppm` treats its last argument as a filename PREFIX, not as
 * a destination. Passing `-` wrote a file literally named `-.png` into the
 * process's CURRENT WORKING DIRECTORY. On a server that is the application
 * root. `pdftocairo` honours `-` as stdout properly, which is why this module
 * uses it: nothing is written to disk, so nothing can be written to the wrong
 * place.
 *
 * ⛔ Requires `poppler-utils` in the runtime image. The production machine was
 * probed on 2026-10-24 and had NONE of pdftoppm, pdftocairo, convert or gs -
 * the runner stage installed only `ca-certificates` and `dumb-init`. The
 * Dockerfile now adds it; `rasterisationAvailable()` reports the truth at
 * runtime so a missing binary surfaces as "could not read" rather than as a
 * crash.
 */

import { spawn } from 'node:child_process';

/** Pixel box for the rendered page. Bigger reads better; base64 inflates 33%. */
const SCALE_TO = 1600;

/** Rendering resolution, poppler's own default. */
const DPI = 150;

/** A page render that takes longer than this is a malicious or broken file. */
const TIMEOUT_MS = 20_000;

/**
 * Hard ceiling on rendered bytes.
 *
 * A PDF can declare an enormous page; `-scale-to` bounds the pixels, but a
 * decompression bomb can still produce a large PNG, and the buffer is about to
 * be base64-encoded into a request body. 12MB of PNG is far more than any
 * legible document page and well under the point where encoding it hurts.
 */
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;

/** Rendering more than the first page is not done; this is for reporting only. */
const MAX_PAGES_REPORTED = 999;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class RasterisationError extends Error {
  constructor(message: string, readonly cause?: string) {
    super(message);
    this.name = 'RasterisationError';
  }
}

export class RasterisationUnavailableError extends RasterisationError {
  constructor(binary: string) {
    super(
      `${binary} is not installed, so a PDF cannot be screened. ` +
      'Add poppler-utils to the runtime image.',
    );
    this.name = 'RasterisationUnavailableError';
  }
}

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

/**
 * Run a poppler binary with the PDF on stdin and collect stdout.
 *
 * Arguments are passed as an ARRAY, never through a shell, and the PDF never
 * becomes a filename - so there is no path for an attacker-controlled name to
 * reach a shell or the filesystem.
 */
function run(binary: string, args: string[], input: Buffer): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let timedOut = false;
    let truncated = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') return reject(new RasterisationUnavailableError(binary));
      reject(new RasterisationError(`${binary} failed to start: ${err.message}`));
    });

    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_OUTPUT_BYTES) {
        truncated = true;
        child.kill('SIGKILL');
        return;
      }
      chunks.push(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 2000) stderr += c.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks), stderr: stderr.trim(), timedOut, truncated });
    });

    child.stdin.on('error', () => {
      // The child exited before reading all of stdin (a 1-page render of a
      // 500-page file does this). Not an error on its own; `close` decides.
    });
    child.stdin.end(input);
  });
}

/** Is poppler actually present? Cheap, and the answer is not assumed. */
export async function rasterisationAvailable(): Promise<boolean> {
  try {
    const r = await run('pdftocairo', ['-v'], Buffer.alloc(0));
    // `-v` prints the version to stderr and exits non-zero on some builds, so
    // the test is "did it run", not "what did it say".
    return r.code !== null;
  } catch {
    return false;
  }
}

export interface RasterisedPage {
  png: Buffer;
  /** Total pages in the document, or null when it could not be determined. */
  pageCount: number | null;
  /** True when the document has pages this did not render. */
  hasMorePages: boolean;
}

/** Read the page count without rendering anything. Best effort. */
async function pageCount(pdf: Buffer): Promise<number | null> {
  try {
    const r = await run('pdfinfo', ['-'], pdf);
    const m = /^Pages:\s+(\d+)/m.exec(r.stdout.toString('latin1'));
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n > 0 && n <= MAX_PAGES_REPORTED ? n : null;
  } catch {
    return null;
  }
}

/**
 * Render page 1 of a PDF to PNG.
 *
 * Only the first page, deliberately. A reviewer is told when there were more
 * (`hasMorePages`), because "the machine read page 1 of 9 and approved it" is
 * a different claim from "the machine read the document", and the decision
 * must not quietly rest on the narrower one.
 */
export async function rasterisePdfFirstPage(pdf: Buffer): Promise<RasterisedPage> {
  if (pdf.length === 0) throw new RasterisationError('empty file');
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    // Cheap, and it stops poppler being handed arbitrary bytes at all.
    throw new RasterisationError('not a PDF (missing %PDF- header)');
  }

  const pages = await pageCount(pdf);

  const r = await run(
    'pdftocairo',
    ['-png', '-f', '1', '-l', '1', '-singlefile', '-r', String(DPI), '-scale-to', String(SCALE_TO), '-', '-'],
    pdf,
  );

  if (r.timedOut) throw new RasterisationError(`rendering timed out after ${TIMEOUT_MS}ms`, r.stderr);
  if (r.truncated) throw new RasterisationError(`rendered page exceeded ${MAX_OUTPUT_BYTES} bytes`, r.stderr);

  /*
    ⚠️ All three conditions, not just the exit code. A malformed PDF produced
    exit 0, empty stderr and zero bytes - see the header note.
  */
  if (r.code !== 0) {
    throw new RasterisationError(`pdftocairo exited ${r.code}`, r.stderr);
  }
  if (r.stdout.length === 0) {
    throw new RasterisationError('pdftocairo produced no output despite exiting 0', r.stderr);
  }
  if (!r.stdout.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new RasterisationError('pdftocairo output is not a PNG', r.stderr);
  }

  return {
    png: r.stdout,
    pageCount: pages,
    hasMorePages: pages !== null && pages > 1,
  };
}
