import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from '@/components/layout/Footer';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [k: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { vi } from 'vitest';

describe('Footer', () => {
  it('renders the brand name', () => {
    render(<Footer />);
    expect(screen.getByText('Last')).toBeInTheDocument();
    expect(screen.getByText('Donor')).toBeInTheDocument();
  });

  /*
    Retargeted 2026-10-16. This asserted the "Reviewed Fundraising Platform"
    pill, which was removed as the third statement of one claim inside a
    single viewport (the tagline beneath the wordmark opens with "Reviewed
    fundraising" and the trust bar says "Human reviewed"). The guarantee the
    test exists for - that the footer states campaigns are reviewed - is
    unchanged, so the assertion now follows the claim rather than the pill.
    See docs/69.
  */
  it('states that fundraising is reviewed', () => {
    render(<Footer />);
    expect(screen.getByText(/Reviewed fundraising/i)).toBeInTheDocument();
  });

  it('renders Campaigns link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Campaigns' });
    expect(link).toHaveAttribute('href', '/campaigns');
  });

  it('renders Privacy Policy link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(link).toHaveAttribute('href', '/privacy');
  });

  it('renders Terms of Service link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Terms of Service' });
    expect(link).toHaveAttribute('href', '/terms');
  });

  it('renders Donor FAQ link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Donor FAQ' });
    expect(link).toHaveAttribute('href', '/donor-faq');
  });

  it('renders Refund Policy link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Refund Policy' });
    expect(link).toHaveAttribute('href', '/refund-policy');
  });

  it('renders Campaign Verification link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Campaign Verification' });
    expect(link).toHaveAttribute('href', '/campaign-verification-policy');
  });

  it('renders Fund Release Policy link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Fund Release Policy' });
    expect(link).toHaveAttribute('href', '/fund-release-policy');
  });

  it('renders Campaign Rules link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Campaign Rules' });
    expect(link).toHaveAttribute('href', '/campaign-rules');
  });

  it('renders Transparency link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Transparency' });
    expect(link).toHaveAttribute('href', '/transparency');
  });

  it('renders Editorial Standards link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Editorial Standards' });
    expect(link).toHaveAttribute('href', '/editorial-standards');
  });

  it('renders Last Donor Wall link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Last Donor Wall' });
    expect(link).toHaveAttribute('href', '/last-donor-wall');
  });

  it('renders How It Works link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'How It Works' });
    expect(link).toHaveAttribute('href', '/how-it-works');
  });

  it('renders Share Your Story link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Share Your Story' });
    expect(link).toHaveAttribute('href', '/share-your-story');
  });

  it('renders copyright with current year', () => {
    render(<Footer />);
    const year = new Date().getFullYear();
    expect(screen.getByText(new RegExp(`${year}`))).toBeInTheDocument();
  });

  it('renders section headings', () => {
    render(<Footer />);
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Trust')).toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
  });
});
