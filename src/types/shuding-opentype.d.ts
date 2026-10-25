/**
 * The slice of `@shuding/opentype.js` this project uses.
 *
 * The package ships no types. Rather than `any`, this declares exactly what
 * was probed against the real module on 2026-10-25:
 *
 *  - `loadSync(path)` returns `undefined` here, so it is NOT declared.
 *  - `parse` needs a real `ArrayBuffer`; a Node `Buffer` throws.
 *  - `getAdvanceWidth(text, size)` scales linearly with size.
 *
 * Declaring only the probed surface means a future upgrade that changes it
 * fails the typecheck instead of failing at request time.
 */
declare module '@shuding/opentype.js' {
  export interface ParsedFont {
    unitsPerEm: number;
    getAdvanceWidth(text: string, size: number): number;
  }
  export function parse(buffer: ArrayBuffer): ParsedFont;
  const opentype: { parse: typeof parse };
  export default opentype;
}
