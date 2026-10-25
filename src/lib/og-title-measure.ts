import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import opentype from '@shuding/opentype.js';

import type { Measure } from '@/lib/og-title-fit';

/**
 * Real advance widths for the title face, read from the font file itself.
 *
 * ## Why the dependency is declared
 *
 * `@shuding/opentype.js` arrives in `node_modules` anyway, as satori's own
 * dependency - which is exactly how `glob` came to be imported by four files
 * and declared by none (`docs/97` §5.2). `npm ci` installs only what is
 * declared, so a satori upgrade that dropped or moved this package would
 * have broken the build with no warning. It is a direct dependency in
 * `package.json`.
 *
 * ⚠️ Its API is not the documented one: `loadSync` returns undefined here,
 * and `parse` needs a real `ArrayBuffer`, not a Node `Buffer`. Probed, not
 * assumed.
 *
 * The parsed font is cached in module scope, like `loadOgFonts`. Parsing is
 * a 72KB file and happens once per process.
 */

type ParsedFont = { getAdvanceWidth(text: string, size: number): number };

let parsed: ParsedFont | null = null;

async function loadTitleFont(): Promise<ParsedFont> {
  if (parsed) return parsed;
  const buf = await readFile(
    join(process.cwd(), 'public', 'fonts', 'DMSerifDisplay-Regular.ttf'),
  );
  // `Buffer` is a view onto a larger pool; slice to this file's bytes only.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  parsed = opentype.parse(ab) as ParsedFont;
  return parsed;
}

/**
 * A `Measure` bound to the title face.
 *
 * Falls back to a conservative per-character estimate if the font cannot be
 * parsed, so a card still renders. The estimate is deliberately WIDE (the
 * advance of `M`), which makes the title smaller than necessary rather than
 * letting it overflow the card.
 */
export async function titleMeasure(): Promise<Measure> {
  try {
    const font = await loadTitleFont();
    return (text, size) => font.getAdvanceWidth(text, size);
  } catch {
    const WIDEST_RATIO = 47.5 / 60; // `M` at 60px, measured 2026-10-25.
    return (text, size) => text.length * size * WIDEST_RATIO;
  }
}
