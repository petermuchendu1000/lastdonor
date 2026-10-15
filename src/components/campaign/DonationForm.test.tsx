import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DonationForm } from '@/components/campaign/DonationForm';

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('DonationForm', () => {
  const defaultProps = {
    campaignId: '550e8400-e29b-41d4-a716-446655440000',
    campaignTitle: 'Help the Johnson Family',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders the form heading', () => {
    render(<DonationForm {...defaultProps} />);
    expect(screen.getByText('Make a Donation')).toBeInTheDocument();
  });

  it('renders all preset amount buttons', () => {
    render(<DonationForm {...defaultProps} />);
    expect(screen.getByText('$25')).toBeInTheDocument();
    expect(screen.getByText('$50')).toBeInTheDocument();
    expect(screen.getByText('$100')).toBeInTheDocument();
  });

  it('renders required form fields', () => {
    render(<DonationForm {...defaultProps} />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it('renders optional fields after expanding options', async () => {
    render(<DonationForm {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /add a message/i }));
    expect(screen.getByLabelText(/location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/message/i)).toBeInTheDocument();
  });

  it('renders anonymous and recurring toggles', async () => {
    render(<DonationForm {...defaultProps} />);
    expect(screen.getByRole('radio', { name: /monthly/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /add a message/i }));
    expect(screen.getByText(/donate anonymously/i)).toBeInTheDocument();
  });

  it('selects a preset amount on click', async () => {
    render(<DonationForm {...defaultProps} />);
    const fiftyButton = screen.getByRole('radio', { name: /^\$50\b/ });
    await userEvent.click(fiftyButton);
    expect(fiftyButton).toHaveAttribute('aria-checked', 'true');
  });

  it('deselects preset when custom amount is entered', async () => {
    render(<DonationForm {...defaultProps} />);
    const fiftyButton = screen.getByRole('radio', { name: /^\$50\b/ });
    await userEvent.click(fiftyButton);
    expect(fiftyButton).toHaveAttribute('aria-checked', 'true');

    const customInput = screen.getByPlaceholderText('0.00');
    await userEvent.clear(customInput);
    await userEvent.type(customInput, '75');
    expect(fiftyButton).toHaveAttribute('aria-checked', 'false');
  });

  it('shows message character counter', async () => {
    render(<DonationForm {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /add a message/i }));
    expect(screen.getByText('0/500')).toBeInTheDocument();
  });

  it('disables submit when no amount selected', () => {
    render(<DonationForm {...defaultProps} />);
    const submit = screen.getByRole('button', { name: /donate/i });
    expect(submit).toBeDisabled();
  });

  it('shows amount in submit button after selection', async () => {
    render(<DonationForm {...defaultProps} />);
    await userEvent.click(screen.getByText('$25'));
    expect(screen.getByRole('button', { name: /donate.*\$25\.00/i })).toBeInTheDocument();
  });

  it('renders payment security notice', () => {
    render(<DonationForm {...defaultProps} />);
    expect(screen.getByText(/secured by stripe/i)).toBeInTheDocument();
  });

  // The "501(c)(3) nonprofit" claim was deliberately dropped in 13a2726
  // ("Hardening SEO and GEO trust signals"); the platform does not make it.
  // Assert the trust signals actually shown instead.
  it('renders trust signals below the CTA', () => {
    render(<DonationForm {...defaultProps} />);
    expect(screen.getByText(/secured by stripe/i)).toBeInTheDocument();
    expect(screen.getByText(/reviewed campaign/i)).toBeInTheDocument();
    expect(screen.getByText(/0% platform fees/i)).toBeInTheDocument();
  });
});
