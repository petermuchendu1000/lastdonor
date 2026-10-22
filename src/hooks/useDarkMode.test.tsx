import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { FooterDarkModeToggle } from '@/components/layout/FooterDarkModeToggle';

/**
 * The regression these pin is cross-component, so they mount BOTH toggles.
 *
 * `DarkModeToggle.test.tsx` already covers one toggle on its own, and passed
 * throughout the bug - which is the point. Each component was individually
 * correct; what was broken was two of them holding separate copies of one
 * global value. A per-component test cannot see that.
 *
 * Both are really mounted together on a phone: `DarkModeToggle` is in the
 * mobile navigation sheet, `FooterDarkModeToggle` in the footer strip.
 */
describe('useDarkMode across two mounted toggles', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => store[k] ?? null),
      setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
      removeItem: vi.fn((k: string) => { delete store[k]; }),
    });
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
  });

  const navbarToggle = () => screen.getByRole('button', { name: /toggle dark mode/i });
  const footerToggle = () => screen.getByRole('button', { name: /switch to (dark|light) mode/i });

  it('the footer toggle follows a change made by the navbar toggle', async () => {
    render(<><DarkModeToggle /><FooterDarkModeToggle /></>);

    expect(footerToggle()).toHaveAccessibleName('Switch to dark mode');

    fireEvent.click(navbarToggle());
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // Before the shared hook this stayed "Switch to dark mode" forever: the
    // footer component was never told the theme had changed.
    await waitFor(() =>
      expect(footerToggle()).toHaveAccessibleName('Switch to light mode'),
    );
  });

  it('the footer toggle turns dark mode OFF after the navbar toggle turned it on', async () => {
    render(<><DarkModeToggle /><FooterDarkModeToggle /></>);

    fireEvent.click(navbarToggle());
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    /*
      THE BUG, exactly. The footer toggle's own state still said "light", so
      it computed `next = true` and re-applied a class that was already
      there: the page did not change, and the visitor's press was swallowed.

      Asserting the class is false after ONE press is what fails against the
      old components.
    */
    fireEvent.click(footerToggle());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('theme', 'light');

    await waitFor(() =>
      expect(navbarToggle()).toHaveAccessibleName('Toggle dark mode'),
    );
  });

  it('either toggle alternates the theme however the presses are interleaved', () => {
    render(<><DarkModeToggle /><FooterDarkModeToggle /></>);
    const isDark = () => document.documentElement.classList.contains('dark');

    fireEvent.click(navbarToggle());
    expect(isDark()).toBe(true);
    fireEvent.click(footerToggle());
    expect(isDark()).toBe(false);
    fireEvent.click(footerToggle());
    expect(isDark()).toBe(true);
    fireEvent.click(navbarToggle());
    expect(isDark()).toBe(false);
  });

  it('a theme change still applies when localStorage is unavailable', () => {
    // Blocked site data makes `setItem` THROW rather than return null. The
    // visitor loses persistence; they must not lose the toggle.
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('denied'); }),
      setItem: vi.fn(() => { throw new Error('denied'); }),
      removeItem: vi.fn(),
    });

    render(<DarkModeToggle />);
    expect(() => fireEvent.click(navbarToggle())).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('seeds from the class the pre-paint script in layout.tsx already applied', async () => {
    document.documentElement.classList.add('dark');
    render(<FooterDarkModeToggle />);

    // `useState(false)` is the SSR-safe start; the mount effect corrects it.
    await waitFor(() =>
      expect(footerToggle()).toHaveAccessibleName('Switch to light mode'),
    );
  });
});
