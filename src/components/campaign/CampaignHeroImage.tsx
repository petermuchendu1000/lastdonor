'use client';

import { useState } from 'react';
import Image from 'next/image';
import { resolveCampaignHero } from '@/lib/campaign-hero';

/**
 * The image at the top of a campaign card or page.
 *
 * ⛔ The choice of image is made by `resolveCampaignHero` DURING RENDER, not
 * in `onError`. This component used to fall back to a curated stock photo
 * when the stored image failed to load, and that swap ran only in a browser
 * - so a crawler, which reads the server-rendered HTML, never saw it. Every
 * stock URL Google would have indexed came straight from the database, and
 * 8 of 10 live campaigns were a photograph of somebody who is not the person
 * named beside them. See `src/lib/campaign-hero.ts` for the decision and
 * `docs/141` §5 for the question it answers.
 *
 * What is left here is a genuine error path: a photograph the organiser DID
 * supply can still 404 if it is deleted from storage, and the panel is the
 * same last resort it always was.
 *
 * ⚠️ `alt` is the CAMPAIGN TITLE, not the final accessible name. When a panel
 * is shown the resolver renames it, because a teal graphic captioned with a
 * named person's crisis is the same inaccuracy one layer down.
 */
interface CampaignHeroImageProps {
  /** The stored `hero_image_url`. May be empty, relative, or an external URL. */
  src: string;
  /** The campaign title. */
  alt: string;
  category?: string;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  className?: string;
}

export function CampaignHeroImage({
  src,
  alt,
  category = 'community',
  fill,
  sizes,
  priority,
  className,
}: CampaignHeroImageProps) {
  const resolved = resolveCampaignHero({ heroImageUrl: src, category, title: alt });
  /** Passing no image always yields the panel, so there is one decider for both. */
  const panel = resolveCampaignHero({ heroImageUrl: null, category, title: alt });

  /*
    Keyed by the src that failed rather than a boolean, so a new `src` (a
    client-side navigation, or a card appended by Load more) is retried
    instead of inheriting the previous card's failure.
  */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = failedSrc === resolved.src ? panel : resolved;

  return (
    <Image
      src={shown.src}
      alt={shown.alt}
      fill={fill}
      sizes={sizes}
      priority={priority}
      className={className}
      onError={() => setFailedSrc(resolved.src)}
    />
  );
}
