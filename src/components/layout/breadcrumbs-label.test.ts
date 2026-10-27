/**
 * A breadcrumb crumb for an id is not the id.
 *
 * `Breadcrumbs` title-cases every path segment, so on any `[id]` route the
 * trail read `E2e00000 0000 4000 8000 000000000004` — a UUID with its hyphens
 * turned into spaces and each group capitalised, presented as the page's name,
 * and emitted as a `BreadcrumbList` JSON-LD `name` as well. It is on every
 * admin and dashboard detail screen.
 *
 * Found by looking at a screenshot during the `docs/120` review walk. There
 * was no test on this component at all, which is why this file exists.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

/*
  The component's OWN function, imported rather than reproduced.

  The first version of this file sliced the source and evaluated it with
  `new Function`, which choked on the TypeScript annotation on
  `LABEL_OVERRIDES` - and a hand-written copy of the function would have been
  worse, passing happily while the component did something else. Exporting the
  real one is the honest way to test it.
*/
import { toLabel } from './Breadcrumbs';

describe('⛔ a UUID segment is never shown as a name', () => {
  it.each([
    'e2e00000-0000-4000-8000-000000000004',
    '284b06ff-4475-4cc9-97bf-efa67ac3f9aa',
    'D9B40DE7-AE62-47D2-B626-ADEE62771B28',
  ])('%s renders as "Details"', (id) => {
    expect(toLabel(id)).toBe('Details');
  });

  it('⛔ and never leaks the id, in any casing', () => {
    const out = toLabel('e2e00000-0000-4000-8000-000000000004');
    expect(out.toLowerCase()).not.toContain('e2e00000');
    expect(out).not.toMatch(/\d{6}/);
  });
});

describe('ordinary segments are unchanged', () => {
  it.each([
    ['campaigns', 'Campaigns'],
    ['payout-destination', 'Payout Destination'],
    ['impact-update', 'Impact Update'],
    ['admin', 'Admin'],
  ])('%s -> %s', (seg, label) => {
    expect(toLabel(seg)).toBe(label);
  });

  it('and the overrides still win', () => {
    // The control: a narrower UUID rule must not have displaced these.
    expect(toLabel('withdrawals')).toBe('Finances');
    expect(toLabel('payout-settings')).toBe('Payout Account');
  });

  it('⚠️ a blog slug that merely looks hex-ish is still a slug', () => {
    // The rule is anchored and length-exact, so a real slug is untouched.
    expect(toLabel('abc-def-123')).toBe('Abc Def 123');
  });
});
