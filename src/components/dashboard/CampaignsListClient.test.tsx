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
  verificationStatus: 'unverified',
  currency: 'KES',
  createdAt: new Date('2026-10-26T00:00:00Z').toISOString(),
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
