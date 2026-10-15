import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageForm } from './MessageForm';

// Mock next-auth/react
const mockUseSession = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));

// Mock sonner
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: mockToast }));

describe('MessageForm', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    mockToast.success.mockClear();
    mockToast.error.mockClear();
  });

  it('shows sign-in prompt when not authenticated', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<MessageForm campaignSlug="test-campaign" />);

    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.getByText(/to leave a message of support/i)).toBeInTheDocument();
  });

  it('renders nothing while session is loading', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });
    const { container } = render(<MessageForm campaignSlug="test-campaign" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders form when authenticated', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Jane', role: 'donor' } },
      status: 'authenticated',
    });
    render(<MessageForm campaignSlug="test-campaign" />);

    expect(screen.getByText('Leave a Message')).toBeInTheDocument();
    expect(screen.getByLabelText('Support message')).toBeInTheDocument();
    expect(screen.getByText('Post Message')).toBeInTheDocument();
    expect(screen.getByText('0/500')).toBeInTheDocument();
  });

  it('updates character counter as user types', async () => {
    const user = userEvent.setup();
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Jane', role: 'donor' } },
      status: 'authenticated',
    });
    render(<MessageForm campaignSlug="test-campaign" />);

    const textarea = screen.getByLabelText('Support message');
    await user.type(textarea, 'Hello');
    expect(screen.getByText('5/500')).toBeInTheDocument();
  });

  it('disables submit when message is empty', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Jane', role: 'donor' } },
      status: 'authenticated',
    });
    render(<MessageForm campaignSlug="test-campaign" />);

    const button = screen.getByText('Post Message');
    expect(button).toBeDisabled();
  });

  it('submits message successfully', async () => {
    const user = userEvent.setup();
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Jane', role: 'donor' } },
      status: 'authenticated',
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          ok: true,
          data: { id: 'msg-1', createdAt: new Date().toISOString() },
        }),
    });

    render(<MessageForm campaignSlug="test-campaign" />);

    const textarea = screen.getByLabelText('Support message');
    await user.type(textarea, 'Great cause!');
    await user.click(screen.getByText('Post Message'));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/campaigns/test-campaign/messages',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Message posted!');
  });

  it('shows error on rate limit', async () => {
    const user = userEvent.setup();
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Jane', role: 'donor' } },
      status: 'authenticated',
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' },
        }),
    });

    render(<MessageForm campaignSlug="test-campaign" />);

    const textarea = screen.getByLabelText('Support message');
    await user.type(textarea, 'Another message');
    await user.click(screen.getByText('Post Message'));

    expect(mockToast.error).toHaveBeenCalledWith(
      "You've reached the daily message limit for this campaign.",
    );
  });

  it('has anonymous toggle', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Jane', role: 'donor' } },
      status: 'authenticated',
    });
    render(<MessageForm campaignSlug="test-campaign" />);

    expect(screen.getByText('Post anonymously')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  // The login page reads `callbackUrl` and nothing else, so `?redirect=` was
  // silently dropped and signing in to leave a message landed on /dashboard.
  it('sign-in link returns to the campaign page via callbackUrl', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<MessageForm campaignSlug="my-campaign" />);

    const link = screen.getByText('Sign in');
    expect(link).toHaveAttribute(
      'href',
      '/login?callbackUrl=%2Fcampaigns%2Fmy-campaign',
    );
  });

  it('percent-encodes the campaign slug in the callbackUrl', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<MessageForm campaignSlug="help/../evil?x=1" />);

    const href = screen.getByText('Sign in').getAttribute('href')!;
    const value = new URL(href, 'https://lastdonor.org').searchParams.get('callbackUrl');
    expect(value).toBe('/campaigns/help/../evil?x=1');
  });
});
