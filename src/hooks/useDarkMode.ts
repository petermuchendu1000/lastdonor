'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * One source of truth for the theme, shared by every toggle that renders it.
 *
 * ## The bug this fixes
 *
 * There are TWO dark-mode toggles in the layout: `DarkModeToggle` inside the
 * mobile navigation sheet, and `FooterDarkModeToggle` in the footer strip.
 * Each one used to hold its own `useState(false)`, seeded from the document
 * class in a mount effect, and toggle from THAT state:
 *
 *     const next = !dark;                                  // stale
 *     document.documentElement.classList.toggle('dark', next);
 *
 * Both are mounted at once on a phone, where the sheet is reachable. So:
 * open the menu, switch to dark there, close it, then press the footer
 * button - whose state still said `false`, because nothing told it the theme
 * had changed. `next` computed to `true`, `classList.toggle('dark', true)`
 * left the page exactly as dark as it already was, and the button labelled
 * "Dark mode" did nothing at all. The second press worked, which is the
 * worst version of the bug: it looks like a dropped tap rather than a
 * defect, so nobody reports it.
 *
 * Two independent copies of one global value cannot be kept in agreement by
 * initialising them, only by subscribing them. So:
 *
 * - `toggle` reads the CLASS, not React state, to decide what "the other
 *   one" is. That alone makes a press correct no matter how stale the
 *   render was.
 * - A `MutationObserver` on the `class` attribute keeps every mounted
 *   toggle's own label and icon in step, so the footer button says "Light
 *   mode" the moment the navbar one turns dark mode on.
 *
 * ## Why state at all, if the class is the truth
 *
 * The label and the icon have to be rendered, and reading the DOM during
 * render is not allowed. `dark` is therefore a mirror kept honest by the
 * observer, never the thing decisions are made from.
 *
 * Starts `false` on purpose: the server has no document, and
 * `layout.tsx` adds `dark` before paint from `localStorage`, so the mount
 * effect's first `sync()` is what corrects it. Found by
 * `e2e-09-dark-mode.spec.ts`, which hung on its second click because the
 * footer toggle's accessible name had stopped matching (docs/99).
 */
export function useDarkMode(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains('dark'));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    const root = document.documentElement;
    // The class, not `dark`. See the note above on staleness.
    const next = !root.classList.contains('dark');
    root.classList.toggle('dark', next);
    /*
      Guarded because `localStorage` THROWS, rather than returning null, in a
      browser with site data blocked - the pre-paint script in `layout.tsx`
      already wraps its read for the same reason. An unavailable store should
      cost the visitor persistence, not the ability to change the theme at
      all.
    */
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* no persistence available; the class change still applies */
    }
    setDark(next);
  }, []);

  return { dark, toggle };
}
