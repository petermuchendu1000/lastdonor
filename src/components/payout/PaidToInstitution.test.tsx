/**
 * The donor-facing destination component, and the call sites that render it.
 *
 * ── WHY THE CALL SITES ARE READ AS TEXT ─────────────────────────────────────
 *
 * `public.test.ts` already pins the wording, but a rule on a module is
 * worthless if a page writes its own sentence next door. That is `docs/110`
 * §9.2 exactly: a promise was asserted on the notice and the email, a third
 * surface said it anyway, and nothing swept it. So this file also reads the
 * public campaign page as SOURCE and fails if it describes the destination in
 * its own words.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PaidToInstitution, PaidToInstitutionBadge } from './PaidToInstitution';

const disclosure = {
  institutionName: 'Kenyatta National Hospital',
  institutionKindLabel: 'Hospital or clinic',
  organiserIdentityChecked: false,
};

describe('PaidToInstitution', () => {
  it('names the institution and states where the money does not go', () => {
    render(<PaidToInstitution disclosure={disclosure} />);
    /*
      The name appears TWICE by design - in the claim and again in "what we
      checked" - so this counts rather than using the strict getByText. A
      donor should not have to connect the two across a gap.
    */
    expect(screen.getAllByText(/Kenyatta National Hospital/)).toHaveLength(2);
    expect(document.body.textContent).toMatch(/does not pass through/i);
  });

  it('⛔ always renders BOTH halves: what was checked and what was not', () => {
    render(<PaidToInstitution disclosure={disclosure} />);
    expect(document.body.textContent).toMatch(/What we checked:/);
    expect(document.body.textContent).toMatch(/What we have not:/);
  });

  it('⛔ never tells a donor the organiser is verified', () => {
    render(<PaidToInstitution disclosure={disclosure} />);
    expect(document.body.textContent).not.toMatch(/\bverified\b/i);
  });

  it('⛔ keeps the bill-number caveat even once identity IS checked', () => {
    render(
      <PaidToInstitution disclosure={{ ...disclosure, organiserIdentityChecked: true }} />,
    );
    expect(document.body.textContent).toMatch(/bill number/i);
  });

  it('has an accessible name, so it is findable as a region', () => {
    render(<PaidToInstitution disclosure={disclosure} />);
    expect(screen.getByLabelText('Where this money goes')).toBeInTheDocument();
  });

  it('the badge is one line and still names the institution', () => {
    render(<PaidToInstitutionBadge disclosure={disclosure} />);
    expect(document.body.textContent).toMatch(/Paid to Kenyatta National Hospital/);
  });
});

describe('⛔ the call site does not write its own copy', () => {
  const page = readFileSync(
    join(process.cwd(), 'src/app/campaigns/[slug]/page.tsx'),
    'utf8',
  );
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('renders the component rather than a hand-written sentence', () => {
    expect(code).toContain('<PaidToInstitution');
  });

  it('⛔ contains no inline sentence about the destination', () => {
    /*
      The phrases that would mean somebody re-wrote the claim on the page.
      `institutionalPayoutCopy` is the only place these may live, because
      that is the only place a test guards the words.
    */
    for (const phrase of [
      'does not pass through',
      'goes straight to',
      'What we checked',
      'straight to the hospital',
    ]) {
      expect(code, phrase).not.toContain(phrase);
    }
  });

  it('reads a page big enough that the assertions are not vacuous', () => {
    expect(code.length).toBeGreaterThan(5_000);
  });
});
