/**
 * PDF rasterisation, against real poppler and real PDFs.
 *
 * These are not mocked: the whole point of this module is that a subprocess
 * behaves in ways you cannot guess, and the headline finding - exit 0 with
 * zero bytes - is only observable by running it.
 *
 * Skipped when poppler is absent, which is why `rasterisationAvailable()`
 * exists. ⚠️ A skip here is NOT a pass: production had no poppler at all
 * until the Dockerfile change that accompanies this file.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';

import {
  rasterisePdfFirstPage,
  rasterisationAvailable,
  RasterisationError,
} from './rasterise';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let available = false;
beforeAll(async () => {
  available = await rasterisationAvailable();
});

/**
 * A real, VALID, multi-page PDF - objects, correct xref byte offsets, trailer.
 *
 * Written out by hand rather than shelled out to `ps2pdf`, which needs
 * ghostscript and is absent from both this sandbox and the production image.
 * The offsets matter: an xref table that does not match is exactly what
 * produced the "exit 0, zero bytes" finding below, so a fixture with a broken
 * one would silently test the wrong thing.
 *
 * Verified against poppler itself: `pdfinfo` reports the right page count and
 * `pdftocairo` renders a decodable PNG for both the 1-page and 4-page forms.
 */
function makePdf(pages: number): Buffer {
  const objs: string[] = [];
  const pageIds: number[] = [];
  for (let i = 0; i < pages; i += 1) pageIds.push(3 + i * 2);
  const fontId = 3 + pages * 2;

  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Count ${pages} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  for (let i = 0; i < pages; i += 1) {
    const pid = pageIds[i];
    const cid = pid + 1;
    objs[pid] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cid} 0 R >>`;
    const text = `BT /F1 28 Tf 60 760 Td (TOTAL DUE KES ${205555 + i}) Tj ET`;
    objs[cid] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  }
  objs[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i += 1) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i += 1) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('rasterisation availability', () => {
  it('reports whether poppler is actually present, rather than assuming', async () => {
    expect(typeof (await rasterisationAvailable())).toBe('boolean');
  });
});

describe('refusing before spawning anything', () => {
  it('refuses an empty file', async () => {
    await expect(rasterisePdfFirstPage(Buffer.alloc(0))).rejects.toThrow(/empty file/);
  });

  it('refuses bytes that are not a PDF, without handing them to poppler', async () => {
    // A PNG uploaded with a .pdf name, or anything else. Checked on the
    // header so poppler is never fed arbitrary input at all.
    await expect(rasterisePdfFirstPage(PNG_MAGIC)).rejects.toThrow(/not a PDF/);
    await expect(rasterisePdfFirstPage(Buffer.from('<html></html>'))).rejects.toThrow(/not a PDF/);
  });

  it('throws RasterisationError, so a caller can tell it from a crash', async () => {
    await expect(rasterisePdfFirstPage(Buffer.from('nope'))).rejects.toBeInstanceOf(RasterisationError);
  });
});

describe('a real PDF', () => {
  it('renders page one to a decodable PNG', async () => {
    if (!available) return expect(available).toBe(false); // see file header
    const out = await rasterisePdfFirstPage(makePdf(1));
    expect(out.png.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(out.png.length).toBeGreaterThan(1000);
    expect(out.pageCount).toBe(1);
    expect(out.hasMorePages).toBe(false);
  });

  it('tells the caller when there were pages it did NOT read', async () => {
    /*
      Load-bearing for honesty: "the machine read page 1 of 9 and approved it"
      is a different claim from "the machine read the document". The reviewer
      is told, and `hasMorePages` is what tells them.
    */
    if (!available) return expect(available).toBe(false);
    const out = await rasterisePdfFirstPage(makePdf(4));
    expect(out.pageCount).toBe(4);
    expect(out.hasMorePages).toBe(true);
    expect(out.png.subarray(0, 8)).toEqual(PNG_MAGIC);
  });
});

describe('THE TRAP: exit 0 is not success', () => {
  it('rejects a structurally broken PDF instead of returning empty bytes', async () => {
    /*
      [VERIFIED 2026-10-24] A hand-rolled PDF with no valid xref table made
      `pdftoppm` exit **0**, write **empty stderr**, and produce **0 bytes**.
      A check on the exit code alone calls that success and hands an empty
      buffer to the vision model, which then fails for an unrelated-looking
      reason several layers away.

      This fixture is that same broken file.
    */
    const broken = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
    );
    if (!available) return expect(available).toBe(false);
    await expect(rasterisePdfFirstPage(broken)).rejects.toThrow(
      /no output despite exiting 0|exited|not a PNG/,
    );
  });

  it('never returns a buffer that is not a PNG', async () => {
    if (!available) return expect(available).toBe(false);
    const out = await rasterisePdfFirstPage(makePdf(1));
    // The only way out of the happy path is a PNG; asserted directly because
    // the whole module exists to feed `readDocumentImage`, which would send
    // whatever it is given as an image data URL.
    expect(out.png.subarray(0, 8)).toEqual(PNG_MAGIC);
  });
});

describe('nothing is written to disk', () => {
  it('leaves no file behind in the working directory', async () => {
    /*
      [VERIFIED] `pdftoppm` treats its last argument as a filename PREFIX:
      passing `-` wrote a file literally named `-.png` into the process's cwd,
      which on a server is the application root. This module uses pdftocairo,
      which honours `-` as stdout.
    */
    if (!available) return expect(available).toBe(false);
    const { readdirSync } = await import('node:fs');
    const before = new Set(readdirSync(process.cwd()));
    await rasterisePdfFirstPage(makePdf(1));
    const after = readdirSync(process.cwd()).filter((f) => !before.has(f));
    expect(after).toEqual([]);
  });
});
