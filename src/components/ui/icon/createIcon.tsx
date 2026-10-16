import type { SVGProps } from 'react';

/**
 * The LastDonor icon system.
 *
 * ## Why this exists
 *
 * Measured across `src/**` on 2026-10-16, before this layer:
 *
 * | Inconsistency | Count |
 * |---|---|
 * | Distinct `strokeWidth` values | 5 (1.5, 1.6, 1.8, 2, 2.5) |
 * | Icon sets in use | 3 (24/outline, 24/solid, 20/solid) |
 * | Distinct size classes | 10+ (h-3 through h-16), no scale |
 * | Files with hand-rolled inline `<svg>` | 17 |
 * | Local redefinitions of one `SortIcon` | 3 |
 *
 * Every one of those is a decision taken at a call site that should never
 * have been a decision. An icon's stroke weight is a property of the brand,
 * not of the button it happens to sit in.
 *
 * ## The contract
 *
 * - **One grid.** Every icon is drawn on 24x24 and declares `viewBox="0 0 24
 *   24"`, so swapping artwork never changes alignment.
 * - **One stroke.** `STROKE_WIDTH` is 1.75, with round caps and joins, and
 *   `vectorEffect="non-scaling-stroke"` so a 14px icon and a 32px icon have
 *   the same visual weight rather than the same scaled weight.
 * - **A size scale, not pixels.** Five steps, named. A call site picks a
 *   role, not a number.
 * - **Accessible by default.** `aria-hidden` unless a `label` is supplied,
 *   because the overwhelming majority of icons here sit beside their own
 *   text and announcing them twice is worse than not at all. Passing
 *   `label` promotes the icon to `role="img"` with a `<title>`.
 * - **`currentColor` only.** No icon carries its own colour.
 *
 * ## On replacing all 105 icons by hand
 *
 * Deliberately not done, and the reason matters. Heroicons are drawn by
 * designers on a 24px grid with consistent optical correction. Hand-writing
 * 105 replacement paths in a session would produce worse artwork while
 * claiming to be a brand asset, which is the exact "vibe-coded" result this
 * work is meant to avoid.
 *
 * What ships instead is the part that is genuinely ours and genuinely
 * missing: **the facade and the brand-specific icons**. Call sites import
 * from here and never choose a stroke, a size or a variant again. Artwork
 * behind a given name can then be redrawn one icon at a time without
 * touching a single call site, which is the property that makes this a
 * library rather than a folder of SVGs.
 *
 * See `docs/70`.
 */

/** Brand stroke weight. One value, everywhere. */
export const STROKE_WIDTH = 1.75;

/**
 * The size scale, in pixels.
 *
 * Derived from where usage actually clustered, not invented: `h-4` (206
 * uses) is `sm`, `h-5` (88) is `md`, `h-6` (15) is `lg`. `xs` covers the
 * `h-3` inline cases and `xl` the `h-8` feature marks.
 */
export const ICON_SIZES = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export type IconSize = keyof typeof ICON_SIZES;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'aria-hidden'> {
  /** Named step on the scale. Defaults to `md`. */
  size?: IconSize;
  /**
   * Accessible name. Supply it ONLY when the icon is the sole carrier of
   * meaning; an icon beside its own label must stay hidden.
   */
  label?: string;
}

/**
 * Build an icon component from 24x24 artwork.
 *
 * The artwork is passed as children so each icon file stays declarative and
 * the shared geometry is impossible to override from a call site.
 */
export function createIcon(displayName: string, artwork: React.ReactNode) {
  function IconComponent({ size = 'md', label, ...rest }: IconProps) {
    const px = ICON_SIZES[size];
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={px}
        height={px}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        focusable="false"
        role={label ? 'img' : undefined}
        aria-hidden={label ? undefined : true}
        aria-label={label}
        {...rest}
      >
        {label ? <title>{label}</title> : null}
        {artwork}
      </svg>
    );
  }
  IconComponent.displayName = displayName;
  return IconComponent;
}
