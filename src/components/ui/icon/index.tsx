/**
 * The icon layer. Import icons from here, never from `@heroicons` directly.
 *
 * Two kinds live behind one API:
 *
 *  - **Brand icons** (`./brand`), drawn here because the concept is ours.
 *  - **Wrapped generics**, where a vetted path set is better artwork than
 *    anything that would be hand-written in a hurry, normalised so the call
 *    site cannot pick a stroke, a size or a variant.
 *
 * The point of the wrapper is that it is a seam. Swapping the artwork behind
 * `CheckIcon` later touches this file and nothing else, which is the
 * property that makes this a library rather than a folder of SVGs.
 *
 * See `docs/70`.
 */
import type { ComponentType, SVGProps } from 'react';
import { ICON_SIZES, STROKE_WIDTH, type IconProps } from './createIcon';

export { createIcon, ICON_SIZES, STROKE_WIDTH } from './createIcon';
export type { IconProps, IconSize } from './createIcon';
export * from './brand';

import {
  ArrowPathIcon as HiArrowPath,
  ArrowTopRightOnSquareIcon as HiExternal,
  BellIcon as HiBell,
  CheckIcon as HiCheck,
  CheckCircleIcon as HiCheckCircle,
  ChevronDownIcon as HiChevronDown,
  ChevronLeftIcon as HiChevronLeft,
  ChevronRightIcon as HiChevronRight,
  ChevronUpIcon as HiChevronUp,
  ClockIcon as HiClock,
  CreditCardIcon as HiCreditCard,
  EnvelopeIcon as HiEnvelope,
  ExclamationCircleIcon as HiExclamationCircle,
  ExclamationTriangleIcon as HiWarning,
  EyeIcon as HiEye,
  HeartIcon as HiHeart,
  InformationCircleIcon as HiInfo,
  MagnifyingGlassIcon as HiSearch,
  MapPinIcon as HiMapPin,
  PencilSquareIcon as HiEdit,
  PlusIcon as HiPlus,
  SparklesIcon as HiSparkles,
  TrashIcon as HiTrash,
  UserGroupIcon as HiUserGroup,
  XMarkIcon as HiX,
  XCircleIcon as HiXCircle,
} from '@heroicons/react/24/outline';

/**
 * Give a third-party icon this system's geometry and accessibility rules.
 *
 * Heroicons render `strokeWidth={1.5}` and take their box from a class.
 * Passing an explicit `strokeWidth`, `width` and `height` overrides both, so
 * a wrapped icon is indistinguishable from a brand one at any size.
 */
function wrap(displayName: string, Hero: ComponentType<SVGProps<SVGSVGElement>>) {
  function Wrapped({ size = 'md', label, ...rest }: IconProps) {
    const px = ICON_SIZES[size];
    return (
      <Hero
        width={px}
        height={px}
        strokeWidth={STROKE_WIDTH}
        focusable="false"
        role={label ? 'img' : undefined}
        aria-hidden={label ? undefined : true}
        aria-label={label}
        {...rest}
      />
    );
  }
  Wrapped.displayName = displayName;
  return Wrapped;
}

export const ArrowPathIcon = wrap('ArrowPathIcon', HiArrowPath);
export const BellIcon = wrap('BellIcon', HiBell);
export const CheckCircleIcon = wrap('CheckCircleIcon', HiCheckCircle);
export const CheckIcon = wrap('CheckIcon', HiCheck);
export const ChevronDownIcon = wrap('ChevronDownIcon', HiChevronDown);
export const ChevronLeftIcon = wrap('ChevronLeftIcon', HiChevronLeft);
export const ChevronRightIcon = wrap('ChevronRightIcon', HiChevronRight);
export const ChevronUpIcon = wrap('ChevronUpIcon', HiChevronUp);
export const ClockIcon = wrap('ClockIcon', HiClock);
export const CreditCardIcon = wrap('CreditCardIcon', HiCreditCard);
export const EditIcon = wrap('EditIcon', HiEdit);
export const EnvelopeIcon = wrap('EnvelopeIcon', HiEnvelope);
export const ErrorCircleIcon = wrap('ErrorCircleIcon', HiExclamationCircle);
export const ExternalLinkIcon = wrap('ExternalLinkIcon', HiExternal);
export const EyeIcon = wrap('EyeIcon', HiEye);
export const HeartIcon = wrap('HeartIcon', HiHeart);
export const InfoIcon = wrap('InfoIcon', HiInfo);
export const MapPinIcon = wrap('MapPinIcon', HiMapPin);
export const PlusIcon = wrap('PlusIcon', HiPlus);
export const SearchIcon = wrap('SearchIcon', HiSearch);
export const SparklesIcon = wrap('SparklesIcon', HiSparkles);
export const TrashIcon = wrap('TrashIcon', HiTrash);
export const UserGroupIcon = wrap('UserGroupIcon', HiUserGroup);
export const WarningIcon = wrap('WarningIcon', HiWarning);
export const XCircleIcon = wrap('XCircleIcon', HiXCircle);
export const XIcon = wrap('XIcon', HiX);

/**
 * Sort direction indicator for table headers.
 *
 * Three admin files each declared their own local `SortIcon` with slightly
 * different markup. One implementation, with the neutral state carried by
 * opacity so the column header does not change height when sorting changes.
 *
 * `direction` is omitted from the base props first: `SVGProps` already
 * declares a `direction` attribute (the SVG text one, `string | undefined`),
 * and intersecting with it silently narrowed this union and dropped `null`.
 * The compiler caught it; without the Omit the "unsorted" state would not
 * have type-checked at any call site.
 */
export function SortIcon({
  direction,
  size = 'sm',
  ...rest
}: Omit<IconProps, 'direction'> & { direction?: 'asc' | 'desc' | null }) {
  if (direction === 'asc') return <ChevronUpIcon size={size} {...rest} />;
  if (direction === 'desc') return <ChevronDownIcon size={size} {...rest} />;
  return <ChevronDownIcon size={size} className="opacity-30" {...rest} />;
}
