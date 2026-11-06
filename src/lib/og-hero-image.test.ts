/**
 * The share card's photograph, checked by looking at the pixels.
 *
 * ⚠️ WHY THIS SAMPLES COLOURS INSTEAD OF READING METADATA. The obvious
 * assertions are useless here, and knowing why is the whole value of this
 * file:
 *
 *  - **Dimensions cannot see the defect.** `heroPixels` resizes to a FIXED
 *    456x630 box, so the output is 456x630 whether or not the rotation was
 *    applied. A test on width and height passes with `.rotate()` deleted.
 *  - **Nor can the EXIF tag.** [MEASURED] re-encoding through `.jpeg()`
 *    drops all metadata by default, so the orientation tag is absent either
 *    way. Its absence is a real property worth pinning - a second renderer
 *    must not rotate the image again - but it is NOT evidence the first
 *    rotation happened.
 *
 * So the fixture is a landscape image split LEFT red / RIGHT blue carrying
 * EXIF orientation 8, which is the shape a phone produces and the shape the
 * reported campaign is stored in. [MEASURED with sharp 0.34.5] orientation 8
 * sends the left edge to the BOTTOM, so:
 *
 *   rotation applied  -> top is BLUE, bottom is RED   (a horizontal split)
 *   rotation skipped  -> left is RED, right is BLUE   (a vertical split)
 *
 * Two different pictures from one input, which is exactly what a renderer
 * that reads no EXIF was producing.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { CARD_HEIGHT, HERO_WIDTH } from '@/lib/og-card-metrics';
import { heroPixels } from '@/lib/og-hero-image';

const SRC_WIDTH = 240;
const SRC_HEIGHT = 120;
const RED: readonly [number, number, number] = [220, 30, 30];
const BLUE: readonly [number, number, number] = [30, 60, 220];

/** A landscape photograph, left half red, right half blue. */
async function splitPhoto(orientation?: number): Promise<Buffer> {
  const px = Buffer.alloc(SRC_WIDTH * SRC_HEIGHT * 3);
  for (let y = 0; y < SRC_HEIGHT; y += 1) {
    for (let x = 0; x < SRC_WIDTH; x += 1) {
      const colour = x < SRC_WIDTH / 2 ? RED : BLUE;
      const i = (y * SRC_WIDTH + x) * 3;
      px[i] = colour[0];
      px[i + 1] = colour[1];
      px[i + 2] = colour[2];
    }
  }
  const img = sharp(px, { raw: { width: SRC_WIDTH, height: SRC_HEIGHT, channels: 3 } });
  return (orientation ? img.withMetadata({ orientation }) : img)
    .jpeg({ quality: 100 })
    .toBuffer();
}

/** Answers a fetch with these bytes, and records the options it was given. */
function serving(body: Buffer, init: { ok?: boolean } = {}) {
  const calls: RequestInit[] = [];
  const impl = (async (_url: string, options?: RequestInit) => {
    calls.push(options ?? {});
    return {
      ok: init.ok ?? true,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

/** Reads one pixel out of a decoded JPEG. */
async function sampler(jpeg: Buffer) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  return {
    info,
    at(x: number, y: number): [number, number, number] {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
}

/** JPEG is lossy and the crop lands on a boundary, so compare loosely. */
const near = (got: readonly number[], want: readonly number[]) =>
  got.every((v, i) => Math.abs(v - want[i]) < 60);
const nameOf = (c: readonly number[]) => (near(c, RED) ? 'RED' : near(c, BLUE) ? 'BLUE' : `neither(${c.join(',')})`);

describe('⛔ the photograph is rotated before the renderer sees it', () => {
  it('applies the EXIF orientation a phone recorded', async () => {
    /*
      THE REPORTED DEFECT. The stored object is landscape pixels with
      orientation 8; the campaign page honoured it and the share card did
      not, so the same father and son were upright on one surface and lying
      on their side on the other.
    */
    const { impl } = serving(await splitPhoto(8));
    const url = await heroPixels('https://example.test/photo.jpg', impl);
    expect(url).not.toBeNull();

    const { at } = await sampler(dataUrlToBuffer(url!));
    const top = at(Math.round(HERO_WIDTH / 2), 60);
    const bottom = at(Math.round(HERO_WIDTH / 2), CARD_HEIGHT - 60);

    expect(
      nameOf(top),
      'the rotated photograph puts the (blue) right edge at the top',
    ).toBe('BLUE');
    expect(
      nameOf(bottom),
      'and the (red) left edge at the bottom',
    ).toBe('RED');
  });

  it('…and the unrotated image is a DIFFERENT picture, which is why it matters', async () => {
    /*
      The control. Sampling across the OTHER axis: with the rotation applied
      the left and right of the card agree, because the colour boundary now
      runs horizontally. Skip `.rotate()` and these two disagree instead -
      so between this test and the one above, neither orientation can pass
      for the other.
    */
    const { impl } = serving(await splitPhoto(8));
    const { at } = await sampler(dataUrlToBuffer((await heroPixels('https://e.test/p.jpg', impl))!));
    const left = at(30, Math.round(CARD_HEIGHT / 2));
    const right = at(HERO_WIDTH - 30, Math.round(CARD_HEIGHT / 2));
    expect(near(left, right), `left ${left.join(',')} vs right ${right.join(',')}`).toBe(true);
  });

  it('leaves a photograph with no orientation tag alone', async () => {
    /*
      ⛔ `.rotate()` with no argument applies the EXIF orientation;
      `.rotate(90)` turns EVERY image a quarter turn whether it needs it or
      not. This is what tells those two apart: most photographs carry no tag,
      and they must come out as they went in.
    */
    const { impl } = serving(await splitPhoto());
    const { at } = await sampler(dataUrlToBuffer((await heroPixels('https://e.test/p.jpg', impl))!));
    expect(nameOf(at(30, Math.round(CARD_HEIGHT / 2)))).toBe('RED');
    expect(nameOf(at(HERO_WIDTH - 30, Math.round(CARD_HEIGHT / 2)))).toBe('BLUE');
  });

  it('strips the tag, so a renderer that DOES read EXIF cannot rotate it twice', async () => {
    const { impl } = serving(await splitPhoto(8));
    const meta = await sharp(dataUrlToBuffer((await heroPixels('https://e.test/p.jpg', impl))!)).metadata();
    expect(meta.orientation).toBeUndefined();
  });
});

describe('the photograph exactly fills the panel the route draws', () => {
  it('is HERO_WIDTH x CARD_HEIGHT, whatever shape it arrived in', async () => {
    /*
      This is the agreement between two modules: the route draws a box of
      this size and this function fills it. If they diverged the image would
      be scaled twice, once here and once by the renderer.
    */
    for (const orientation of [undefined, 8]) {
      const { impl } = serving(await splitPhoto(orientation));
      const { info } = await sampler(dataUrlToBuffer((await heroPixels('https://e.test/p.jpg', impl))!));
      expect([info.width, info.height]).toEqual([HERO_WIDTH, CARD_HEIGHT]);
    }
  });

  it('is a JPEG data URL', async () => {
    const { impl } = serving(await splitPhoto());
    const url = await heroPixels('https://e.test/p.jpg', impl);
    expect(url).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
  });
});

describe('⛔ every failure answers null, which renders the fallback panel', () => {
  it('a non-200 response that hands us a picture anyway', async () => {
    /*
      ⚠️ THE BODY IS A VALID JPEG ON PURPOSE, and the first version of this
      test had an empty one - which sharp cannot decode, so it answered null
      through the catch below and PASSED with the status check deleted. A
      CDN serving a placeholder image with its 403 is the realistic case,
      and it is the only one where `res.ok` is the thing doing the work.
    */
    const { impl } = serving(await splitPhoto(), { ok: false });
    await expect(heroPixels('https://e.test/gone.jpg', impl)).resolves.toBeNull();
  });

  it('bytes sharp cannot decode', async () => {
    /*
      [MEASURED] sharp throws `Input buffer contains unsupported image
      format`. This is a second, independent refusal: `probeHeroSrc` already
      rejects a webp or an svg by content type, and this catches whatever
      gets past it.
    */
    const { impl } = serving(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    await expect(heroPixels('https://e.test/p.svg', impl)).resolves.toBeNull();
  });

  it('a fetch that rejects', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(heroPixels('https://e.test/p.jpg', impl)).resolves.toBeNull();
  });

  it('a photograph slower than the deadline', async () => {
    /*
      Driven through the real abort signal rather than a plain rejection, so
      this also proves the signal is wired: a slow photograph must not hold
      up the card, which is the same bound `probeHeroSrc` works to.
    */
    let seenSignal: AbortSignal | undefined;
    const impl = ((_url: string, options?: RequestInit) => {
      seenSignal = options?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;

    await expect(heroPixels('https://e.test/slow.jpg', impl, 5)).resolves.toBeNull();
    expect(seenSignal, 'the fetch was given an abort signal').toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(true);
  });
});

describe('the second thing this buys', () => {
  it('hands the renderer far fewer bytes than the original', async () => {
    /*
      Satori used to fetch the full-resolution original and decode all of it
      to fill a 456x630 box - [MEASURED] 1,684KB for the photograph this was
      found on. A 4x oversized source stands in for that here.
    */
    const big = await sharp({
      create: { width: HERO_WIDTH * 4, height: CARD_HEIGHT * 4, channels: 3, background: { r: 90, g: 140, b: 130 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const { impl } = serving(big);
    const out = dataUrlToBuffer((await heroPixels('https://e.test/big.jpg', impl))!);
    expect(out.byteLength).toBeLessThan(big.byteLength);
  });
});
