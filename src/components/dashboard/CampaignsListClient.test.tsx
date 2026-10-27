/**
 * The organiser's campaign list, on a phone.
 *
 * ── THE TWO DEFECTS THIS EXISTS FOR, BOTH REPORTED FROM A SCREENSHOT ────────
 *
 * 1. **A KES campaign showed dollars.** The row rendered
 *    `centsToDollars(c.raisedAmount)`, which hardcodes USD, so an organiser
 *    saw "$18,400.00 / $50,000.00" for a campaign whose ledger is shillings.
 *    The row already carried `currency` and simply did not use it.
 *
 *    ⚠️ This site was MISSED by the sweep that fixed the public campaign
 *    page, and the report that came out of that sweep ("zero dollar signs")
 *    was true only of the page that was measured. 34 files still call
 *    `centsToDollars` - see `docs/113` §14.
 *
 * 2. **Two buttons took half the screen.** The row was
 *    `flex justify-between` with a `shrink-0` action column. At 390px that
 *    column refused to shrink, so the title starved into a three-line ribbon
 *    and every meta item wrapped onto its own line.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CampaignsListClient } from './CampaignsListClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const KES = {
  id: 'c1',
  title: 'Treatment for Baby Amani',
  slug: 'treatment-for-baby-amani',
  status: 'active',
  category: 'medical',
  goalAmount: 5_000_000,
  raisedAmount: 1_840_000,
  donorCount: 31,
  heroImageUrl: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d',
  verificationStatus: 'unverified',
  currency: 'KES',
  createdAt: new Date('2026-10-26T00:00:00Z').toISOString(),
  role: 'creator' as const,
};

/** NBSP sits between "Ksh" and the digits, so normalise before matching. */
const text = () => (document.body.textContent ?? '').replace(/ /g, ' ');

describe('the organiser list renders the campaign currency', () => {
  it('⛔ shows no dollar sign for a KES campaign', () => {
    render(<CampaignsListClient campaigns={[KES]} />);
    expect(text()).not.toContain('$');
  });

  it('shows the shilling figures the row actually holds', () => {
    render(<CampaignsListClient campaigns={[KES]} />);
    expect(text()).toMatch(/Ksh 18,400/);
    expect(text()).toMatch(/Ksh 50,000/);
  });

  it('still renders a USD campaign correctly', () => {
    render(<CampaignsListClient campaigns={[{ ...KES, currency: 'USD', raisedAmount: 250_000, goalAmount: 500_000 }]} />);
    expect(text()).toMatch(/\$2,500/);
  });

  it('offers every action, including the payout destination', () => {
    render(<CampaignsListClient campaigns={[KES]} />);
    // `docs/83`: a route nobody can click is a route that does not exist.
    expect(screen.getByRole('link', { name: /where the money goes/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^manage$/i })).toBeInTheDocument();
  });
});

describe('⛔ the row does not starve its own title', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/dashboard/CampaignsListClient.tsx'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('⛔ has no shrink-0 action column', () => {
    /*
      This is the shape that broke it: a `shrink-0` column holding the
      actions, beside a flexible title. The longer the action labels get,
      the narrower the title is allowed to be - and the labels here name a
      whole flow ("Where the money goes").
    */
    expect(src).not.toMatch(/shrink-0 flex-col items-end/);
  });

  it('⛔ renders money through Money, never a USD helper', () => {
    expect(src).not.toMatch(/centsToDollars/);
    expect(src).toMatch(/<Money\s+minor=\{c\.raisedAmount\}\s+currency=\{c\.currency\}/);
  });

  it('reads a file big enough that these cannot pass vacuously', () => {
    expect(src.length).toBeGreaterThan(2_000);
  });
});

/**
 * ⛔ A HELPER'S ROW OFFERS NO MONEY CONTROL.
 *
 * `change_payout_account` is in `NEVER_DELEGATED`
 * (`src/lib/collaborators/capabilities.ts`) and the route behind "Where the
 * money goes" answers 403 to a collaborator - [VERIFIED 2026-10-27 in a
 * browser, with the creator's different error as the control]. A link that
 * can only fail is worse than no link, and the organiser journey it sits
 * beside is about getting PAID, which is not a helper's to do (`docs/110`).
 *
 * The creator's row above asserts the same links are PRESENT, so this pair
 * cannot both pass by rendering nothing.
 */
describe("a collaborator's row", () => {
  const HELPING = { ...KES, role: 'collaborator' as const };

  it('⛔ does not offer the payout destination', () => {
    render(<CampaignsListClient campaigns={[HELPING]} />);
    expect(screen.queryByRole('link', { name: /where the money goes/i })).toBeNull();
  });

  it('⛔ does not nag them through the organiser journey', () => {
    render(<CampaignsListClient campaigns={[HELPING]} />);
    // The ID check is the creator's, and no payout can ever be theirs.
    expect(text()).not.toMatch(/check your ID|cannot pay out/i);
  });

  it('says WHY the campaign is on their list', () => {
    render(<CampaignsListClient campaigns={[HELPING]} />);
    expect(screen.getByText('Helping')).toBeInTheDocument();
  });

  it('still lets them open it', () => {
    render(<CampaignsListClient campaigns={[HELPING]} />);
    expect(screen.getByRole('link', { name: /^manage$/i })).toBeInTheDocument();
  });

  it('and the creator keeps the badge off their own row', () => {
    render(<CampaignsListClient campaigns={[KES]} />);
    expect(screen.queryByText('Helping')).toBeNull();
  });
});
