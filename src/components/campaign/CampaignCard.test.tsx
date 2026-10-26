import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignCard } from '@/components/campaign/CampaignCard';

// Mock next/image
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, ...rest } = props;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...rest} data-fill={fill ? 'true' : undefined} />;
  },
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [k: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { vi } from 'vitest';

const defaultProps = {
  slug: 'help-johnson-family',
  title: 'Help the Johnson Family Rebuild',
  heroImageUrl: 'https://example.com/hero.webp',
  subjectName: 'The Johnson Family',
  raisedAmount: 125000,
  currency: 'USD', // $1,250.00
  goalAmount: 500000,   // $5,000.00
};

describe('CampaignCard', () => {
  it('renders the campaign title', () => {
    render(<CampaignCard {...defaultProps} />);
    expect(screen.getByText('Help the Johnson Family Rebuild')).toBeInTheDocument();
  });

  it('renders the progress bar', () => {
    render(<CampaignCard {...defaultProps} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('displays raised amount as whole dollars', () => {
    render(<CampaignCard {...defaultProps} />);
    expect(screen.getByText(/\$1,250/)).toBeInTheDocument();
    expect(screen.getByText('raised')).toBeInTheDocument();
  });

  it('renders location badge when location is provided', () => {
    render(<CampaignCard {...defaultProps} location="London, United Kingdom" />);
    expect(screen.getByText('London, United Kingdom')).toBeInTheDocument();
  });

  it('does not render location badge when location is null', () => {
    render(<CampaignCard {...defaultProps} location={null} />);
    expect(screen.queryByText(/United Kingdom/)).not.toBeInTheDocument();
  });

  it('displays goal amount and shows funded percentage', () => {
    render(<CampaignCard {...defaultProps} />);
    /*
      textContent, not getByText: the figure now renders through `<Money>`,
      which wraps it in a span, so "of $5,000" is split across two elements.
      The VALUE is unchanged - only the element boundary moved.
    */
    expect(document.body.textContent).toMatch(/of \$5,000/);
    expect(screen.getByRole('progressbar', { name: /25% funded/ })).toBeInTheDocument();
  });

  it('does not display donor count', () => {
    render(<CampaignCard {...defaultProps} />);
    expect(screen.queryByText(/donors?$/)).not.toBeInTheDocument();
  });

  it('links to the correct campaign slug', () => {
    render(<CampaignCard {...defaultProps} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/campaigns/help-johnson-family');
  });

  // ── Unfunded state (docs/47, docs/51) ────────────────────────────────────
  // Every live campaign is currently at zero, so this is the common path,
  // not the edge case.

  it('leads with the ask, not with $0, when nothing has been raised', () => {
    render(<CampaignCard {...defaultProps} raisedAmount={0} />);
    expect(screen.getByText('Be the first to donate')).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
    expect(document.body.textContent).toMatch(/\$5,000 goal/);
  });

  it('draws no progress bar when there is no progress to draw', () => {
    render(<CampaignCard {...defaultProps} raisedAmount={0} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('still draws the progress bar once a campaign is funded', () => {
    render(<CampaignCard {...defaultProps} raisedAmount={1} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  // ── Beneficiary line (docs/51) ───────────────────────────────────────────

  it('omits "for <name>" when the title already names the subject', () => {
    // 11 of 12 live campaigns are shaped like this.
    render(<CampaignCard {...defaultProps} />);
    expect(screen.queryByText(/^for /)).not.toBeInTheDocument();
  });

  it('keeps "for <name>" when the title does not name the subject', () => {
    render(
      <CampaignCard
        {...defaultProps}
        title="A Home Lost to the Flood"
        subjectName="Marcus Delgado"
      />,
    );
    expect(screen.getByText('for Marcus Delgado')).toBeInTheDocument();
  });
});

/**
 * ⛔ A card must render the campaign's OWN currency.
 *
 * The card used `centsToDollarsWhole` and a bare `<Money minor={...} />`,
 * and `<Money>` defaults to USD - so a call site that looked correct printed
 * a dollar sign on a shilling campaign. `docs/112` recorded this class as
 * latent because the only non-USD campaign was archived; KES over M-Pesa is
 * the only rail that has ever collected money (`docs/92`), so it was never
 * going to stay latent. Found by rendering a seeded KES campaign in a
 * browser.
 */
describe('CampaignCard currency', () => {
  it('⛔ prints no dollar sign on a KES campaign', () => {
    render(
      <CampaignCard
        slug="kes"
        title="Treatment for Baby Amani"
        heroImageUrl="/x.jpg"
        subjectName="Amani"
        raisedAmount={1_840_000}
        goalAmount={5_000_000}
        currency="KES"
      />,
    );
    /*
      ⚠️ Whitespace is normalised first. `Intl.NumberFormat` puts a
      NON-BREAKING space (U+00A0) between "Ksh" and the digits, so a regex
      written with an ordinary space cannot match text that is visually
      identical.
    */
    const text = (document.body.textContent ?? '').replace(/\u00a0/g, ' ');
    expect(text).not.toContain('$');
    expect(text).toMatch(/Ksh 18,400/);
    expect(text).toMatch(/Ksh 50,000/);
  });

  it('still renders USD, so the fix did not swap one hardcode for another', () => {
    render(
      <CampaignCard
        slug="usd"
        title="T"
        heroImageUrl="/x.jpg"
        subjectName="N"
        raisedAmount={250_000}
        goalAmount={500_000}
        currency="USD"
      />,
    );
    expect(document.body.textContent).toMatch(/\$2,500/);
  });
});
