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
  raisedAmount: 125000, // $1,250.00
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
    expect(screen.getByText(/of \$5,000/)).toBeInTheDocument();
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
    expect(screen.getByText(/\$5,000 goal/)).toBeInTheDocument();
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
