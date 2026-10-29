'use client';

/**
 * Where the reader is, as the browser reports it.
 *
 * Extracted from `LocalAmount` 2026-10-29 so that the provider credit can
 * follow the figures instead of guessing. `FxAttribution` has to render
 * exactly when at least one figure on the page converted - a credit under a
 * grid where nothing converted claims a rate was used when none was - and the
 * only way to know that is to answer the same question `LocalAmount` answers.
 *
 * ⚠️ The alternative was to copy the effect into the second component, which
 * is the defect `docs/99` §8 found in the two dark-mode toggles: each held its
 * own copy of one global, so using one made the other's next press a silent
 * no-op. One hook, two consumers.
 *
 * ⛔ The refusal to guess is in `detectLocale` (`docs/103`) and stays there:
 * `Intl.Locale('en').maximize().region` is `US` and `sw` is `TZ`, so a
 * region-less language tag must yield NOTHING rather than call a Kenyan
 * American. This hook only gathers the inputs.
 */

import { useEffect, useState } from 'react';
import { detectLocale, type DetectedLocale } from '@/lib/geo/detect-country';

/** `null` until the effect has run, and on a browser that answers nothing. */
export function useDetectedLocale(): DetectedLocale | null {
  const [detected, setDetected] = useState<DetectedLocale | null>(null);

  useEffect(() => {
    let timeZone: string | null = null;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      // A browser that cannot report its zone is not an error worth showing.
      timeZone = null;
    }
    const languageTags = Array.isArray(navigator.languages)
      ? [...navigator.languages]
      : navigator.language
        ? [navigator.language]
        : [];

    setDetected(detectLocale({ timeZone, languageTags }));
  }, []);

  return detected;
}
