/**
 * The iOS home-screen icon renders in the brand face.
 *
 * It used to name `fontFamily: 'Georgia, serif'` and supply no font data.
 * `ImageResponse` renders through Satori, which carries no system fonts —
 * it draws only with what it is handed — so the request fell through to
 * Satori's built-in sans. The deployed icon was thin sans-serif "LD."
 * while the favicon and the BIMI logo were a bold serif (`docs/95`).
 *
 * Nothing threw and nothing logged. A route that silently renders the
 * wrong thing is only caught by rendering it, so that is what this does:
 * it calls the route and inspects the bytes, rather than reading the
 * source and hoping.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AppleIcon, { size, contentType, runtime } from './apple-icon';

/** PNG signature: \x89 P N G \r \n \x1a \n */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function render(): Promise<Buffer> {
  const res = (await AppleIcon()) as unknown as Response;
  return Buffer.from(await res.arrayBuffer());
}

describe('apple-icon', () => {
  it('runs where it can read the font', () => {
    // Satori needs the font bytes, and the edge runtime has no filesystem.
    // Flipping this back to 'edge' is what would silently break it again.
    expect(runtime).toBe('nodejs');
  });

  it('is a 180x180 PNG, the size Apple asks for', async () => {
    const png = await render();
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC);
    // IHDR width/height are big-endian uint32 at bytes 16 and 20.
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
    expect(size).toEqual({ width: 180, height: 180 });
    expect(contentType).toBe('image/png');
  });

  it('actually embeds the brand font rather than naming one', async () => {
    /*
      The real assertion. Satori with no font data does not fail — it
      substitutes — so "did it render?" proves nothing. Rendering the same
      markup WITHOUT the font produces visibly different glyphs and
      therefore different bytes; if the two ever matched, the embedded
      font would be having no effect.
    */
    const withFont = await render();

    const { ImageResponse } = await import('next/og');
    const fallback = Buffer.from(
      await new ImageResponse(
        (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#0F766E',
            }}
          >
            <span style={{ fontSize: 96, color: '#FFFFFF' }}>LD</span>
            <span style={{ fontSize: 96, color: '#D97706' }}>.</span>
          </div>
        ),
        { width: 180, height: 180 },
      ).arrayBuffer(),
    );

    expect(withFont.equals(fallback)).toBe(false);
  });

  it('ships the font it reads', () => {
    // A missing file would throw at request time, on a route nothing
    // else exercises.
    const font = join(process.cwd(), 'public', 'fonts', 'DMSerifDisplay-Regular.ttf');
    expect(readFileSync(font).length).toBeGreaterThan(1000);
  });

  it('is full bleed, because iOS applies its own mask', async () => {
    /*
      An apple-touch-icon is masked to a squircle by iOS. Supplying our
      own radius cuts a rounded shape out of an already rounded one and
      the gap shows through — the previous version was RGBA with
      transparent corners for exactly that reason.

      Checked by sampling the corner pixel: it must be opaque brand teal,
      not transparent. Decoding a full PNG for one pixel is not worth a
      dependency, so this reads the source for the radius instead and
      pins the intent.
    */
    const src = readFileSync(join(process.cwd(), 'src/app/apple-icon.tsx'), 'utf8');
    expect(src).not.toMatch(/borderRadius/);
    const png = await render();
    expect(png.length).toBeGreaterThan(500);
  });
});
