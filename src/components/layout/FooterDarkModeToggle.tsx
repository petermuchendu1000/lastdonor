'use client';

import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';
import { useDarkMode } from '@/hooks/useDarkMode';

export function FooterDarkModeToggle() {
  // Shared with the navbar's `DarkModeToggle`. This is the toggle that was
  // visibly broken: used after the navbar one, its stale state made the
  // press do nothing. See `useDarkMode`.
  const { dark, toggle } = useDarkMode();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:text-white"
    >
      {dark ? (
        <SunIcon className="h-4 w-4" />
      ) : (
        <MoonIcon className="h-4 w-4" />
      )}
      {dark ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
