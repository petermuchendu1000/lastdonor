import Image from 'next/image';
import {
  BRAND_GRAPHIC_SIZE,
  brandGraphicPath,
  brandGraphicsFor,
  type BrandGraphic as BrandGraphicData,
} from '@/lib/brand-graphics';

/**
 * A published brand explainer, with the caption that gives a crawler its
 * context.
 *
 * ⛔ **A SERVER COMPONENT, deliberately.** The whole point of these is that a
 * crawler reading the server-rendered HTML finds the `<img>` and its alt
 * text. `docs/170` is the lesson: a decision made in a browser-only code path
 * is invisible to Google, however correct it looks on screen.
 *
 * ⚠️ The caption is rendered as a real `<figcaption>`, not a `title`
 * attribute or a tooltip. Google Images reads surrounding text to decide what
 * an image is about, and a visible caption is also the only part of this a
 * screen reader user gets beyond the alt.
 */
function Figure({ graphic }: { graphic: BrandGraphicData }) {
  return (
    <figure className="my-10">
      <div className="overflow-hidden rounded-2xl border border-border/60">
        <Image
          src={brandGraphicPath(graphic.slug)}
          alt={graphic.alt}
          width={BRAND_GRAPHIC_SIZE}
          height={BRAND_GRAPHIC_SIZE}
          /*
            `sizes` matters here: without it next/image serves the 1200px
            original to a 390px phone. The graphic never exceeds the prose
            column, so one breakpoint describes every use.
          */
          sizes="(max-width: 768px) 100vw, 640px"
          className="h-auto w-full"
        />
      </div>
      <figcaption className="mt-3 text-sm text-muted-foreground">{graphic.caption}</figcaption>
    </figure>
  );
}

/**
 * Every graphic registered for a route.
 *
 * Pages call this rather than naming slugs, so moving a graphic between pages
 * is a one-line change in the registry and nothing in the JSX.
 */
export function BrandGraphicsFor({ page }: { page: string }) {
  const graphics = brandGraphicsFor(page);
  if (graphics.length === 0) return null;

  return (
    <>
      {graphics.map((g) => (
        <Figure key={g.slug} graphic={g} />
      ))}
    </>
  );
}
