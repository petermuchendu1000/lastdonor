'use client';

import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';
import { useDarkMode } from '@/hooks/useDarkMode';

export function DarkModeToggle() {
  // Shared with `FooterDarkModeToggle`; both are mounted at once on a phone,
  // and each keeping its own copy of the theme made the first press of the
  // second one a no-op. See `useDarkMode`.
  const { dark, toggle } = useDarkMode();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {dark ? (
        <SunIcon className="h-5 w-5" />
      ) : (
        <MoonIcon className="h-5 w-5" />
      )}
    </button>
  );
}
