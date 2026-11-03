/**
 * Generate the ten brand illustrations through Cloudflare Workers AI.
 *
 *   npx tsx scripts/generate-brand-images.ts                  # all ten
 *   npx tsx scripts/generate-brand-images.ts --only zero-platform-fee
 *   npx tsx scripts/generate-brand-images.ts --model sdxl      # compare models
 *   npx tsx scripts/generate-brand-images.ts --out /tmp/preview
 *
 * Needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the environment.
 * The token must carry Workers AI; [VERIFIED 2026-11-03] the account token
 * this project already uses does, which was established by a probe whose
 * CONTROL was a fabricated model name - that answers `7000 No route for that
 * URI` where a permissions failure answers something else, so a 429 could be
 * read as a quota limit rather than guessed at.
 *
 * ⛔ The free allocation is 10,000 neurons PER ACCOUNT PER DAY and this
 * Cloudflare account is SHARED with another product (docs/66, docs/86), so an
 * exhausted quota is not necessarily ours to explain. The error is specific
 * and this script reports it verbatim rather than retrying into it:
 *
 *   4006 AiError: you have used up your daily free allocation of 10,000
 *        neurons, please upgrade to Cloudflare's Workers Paid plan
 *
 * ## Why two models
 *
 * `@cf/stabilityai/stable-diffusion-xl-base-1.0` accepts a `negative_prompt`,
 * which matters here because the single most likely defect in a generated
 * brand image is MANGLED LETTERING - and `flux-1-schnell` takes only `prompt`
 * and `steps`. Flux adheres better to a prompt in general. Which wins is
 * settled by LOOKING at a render of the same subject through both, never by
 * preference, so both stay supported and `--model` selects.
 *
 * ⚠️ The two also DIFFER IN RESPONSE SHAPE - one answers JSON carrying base64,
 * the other raw image bytes - so this script branches on the response's own
 * `content-type` rather than on which model was asked. An assumption there
 * would fail as a corrupt file rather than as an error.
 */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  BRAND_IMAGES,
  NEGATIVE_PROMPT,
  STYLE_CLAUSE,
  type BrandImage,
} from '../src/lib/brand-images';

const MODELS = {
  flux: '@cf/black-forest-labs/flux-1-schnell',
  sdxl: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
} as const;
type ModelKey = keyof typeof MODELS;

/** Square. These are inline content images, not share cards - the share card
 *  route already exists and is sized by `docs/112`'s own measurements. */
const SIZE = 1024;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function promptFor(image: BrandImage): string {
  return `${image.subject}. ${STYLE_CLAUSE}`;
}

async function generate(image: BrandImage, model: ModelKey): Promise<Buffer> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set.');
  }

  const body: Record<string, unknown> =
    model === 'flux'
      ? { prompt: promptFor(image), steps: 4 }
      : {
          prompt: promptFor(image),
          negative_prompt: NEGATIVE_PROMPT,
          width: SIZE,
          height: SIZE,
          num_steps: 20,
        };

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODELS[model]}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  const contentType = res.headers.get('content-type') ?? '';

  /*
    Branch on what came back, not on what was asked for. A JSON body is either
    an error envelope or flux's base64 wrapper; raw bytes are the image itself.
  */
  if (contentType.includes('application/json')) {
    const json = (await res.json()) as {
      success?: boolean;
      errors?: { code?: number; message?: string }[];
      result?: { image?: string };
    };

    if (!json.success) {
      const detail = (json.errors ?? [])
        .map((e) => `${e.code ?? '?'} ${e.message ?? 'no message'}`)
        .join('; ');
      throw new Error(`Workers AI refused (HTTP ${res.status}): ${detail || 'no error detail'}`);
    }

    const b64 = json.result?.image;
    if (!b64) {
      /*
        `docs/106`'s trap, in this API's own costume: a vision failure there
        arrives as HTTP 200 with no `choices` key. Success with no image is a
        failure, so it is named rather than written out as an empty file.
      */
      throw new Error(
        `Workers AI answered success with no image (HTTP ${res.status}, keys: ` +
          `${Object.keys(json.result ?? {}).join(',') || 'none'})`,
      );
    }
    return Buffer.from(b64, 'base64');
  }

  if (!res.ok) {
    throw new Error(`Workers AI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`Workers AI answered HTTP ${res.status} with an empty body`);
  }
  return bytes;
}

async function main() {
  const model = (arg('model') ?? 'flux') as ModelKey;
  if (!(model in MODELS)) {
    throw new Error(`--model must be one of ${Object.keys(MODELS).join(', ')}`);
  }
  const only = arg('only');
  const outDir = arg('out') ?? path.join(process.cwd(), 'public/images/brand');

  const targets = only ? BRAND_IMAGES.filter((i) => i.slug === only) : BRAND_IMAGES;
  if (targets.length === 0) throw new Error(`No image matches --only ${only}`);

  await mkdir(outDir, { recursive: true });
  console.log(`model=${MODELS[model]}  out=${outDir}  images=${targets.length}\n`);

  let made = 0;
  for (const image of targets) {
    process.stdout.write(`${image.slug.padEnd(38)} `);
    try {
      const raw = await generate(image, model);

      /*
        Re-encode through sharp rather than writing the model's bytes
        straight out: it normalises the format (the two models answer with
        different ones), fixes the dimensions, and - the reason that matters -
        it PARSES the image, so a truncated or non-image body fails here
        instead of being committed as a broken file.
      */
      const webp = await sharp(raw)
        .resize(SIZE, SIZE, { fit: 'cover' })
        .webp({ quality: 90 })
        .toBuffer();

      const meta = await sharp(webp).metadata();
      await writeFile(path.join(outDir, `${image.slug}.webp`), webp);
      console.log(`ok  ${meta.width}x${meta.height}  ${(webp.length / 1024).toFixed(0)}KB`);
      made += 1;
    } catch (err) {
      console.log(`FAILED  ${err instanceof Error ? err.message : String(err)}`);
    }
    // Courtesy spacing on a shared account.
    if (targets.length > 1) await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\n${made}/${targets.length} written to ${outDir}`);
  if (made < targets.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
