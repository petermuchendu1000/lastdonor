/**
 * The create-campaign wizard asks each question once.
 *
 * Screen 1 used to put three headings in front of the two buttons that
 * answer it — the step heading ("Tell us who you're raising funds for"), a
 * marketing `h1` repeated on all six screens ("Start a fundraiser on
 * LastDonor" plus a 30-word category list), and an `h2` restating the step
 * heading word for word. A fourth naming of the same six screens sat in a
 * `STEPS` array that nothing rendered.
 *
 * These tests pin the result: one heading per screen, and it is the
 * question. See docs/75.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const { ShareYourStoryForm } = await import('./ShareYourStoryForm');

beforeEach(() => {
  vi.clearAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* jsdom without storage */
  }
});

/**
 * The DISTINCT headings a visitor meets.
 *
 * The step heading is in the DOM twice — once in the desktop aside, once in
 * the mobile bar — and `hidden lg:flex` / `lg:hidden` mean exactly one is
 * ever rendered, so exactly one is ever announced. jsdom applies no CSS, so
 * counting elements here would count a duplicate no viewport can see. What
 * matters, and what regressed before, is how many DIFFERENT things the
 * screen says.
 */
function headings() {
  return [
    ...new Set(
      screen.queryAllByRole('heading').map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim()),
    ),
  ];
}

describe('screen 1 asks its question once', () => {
  it('says exactly one thing in its headings', () => {
    render(<ShareYourStoryForm />);
    expect(headings()).toEqual(['Who are you fundraising for?']);
  });

  it('makes that heading the h1, not a styled paragraph', () => {
    render(<ShareYourStoryForm />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    // Desktop aside and mobile bar each render one; CSS shows exactly one.
    expect(h1s.length).toBeGreaterThanOrEqual(1);
    for (const h of h1s) expect(h.textContent).toContain('Who are you fundraising for?');
  });

  it('no longer carries the marketing header that repeated on all six screens', () => {
    render(<ShareYourStoryForm />);
    expect(screen.queryByText(/Start a fundraiser on LastDonor/i)).toBeNull();
    expect(screen.queryByText(/medical bills, emergencies, memorial costs/i)).toBeNull();
  });

  it('drops the subtitle that told the visitor nothing actionable', () => {
    render(<ShareYourStoryForm />);
    expect(
      screen.queryByText(/helps us understand the beneficiary and fundraising need/i),
    ).toBeNull();
  });

  it('still offers both answers and the way forward', () => {
    render(<ShareYourStoryForm />);
    expect(screen.getAllByRole('radio', { name: /Yourself/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('radio', { name: /Someone else/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Continue$/i })).toBeInTheDocument();
  });
});

describe('the flow suppresses sitewide chrome and supplies its own', () => {
  it('marks itself as a focus flow, which is what hides the navbar and footer', () => {
    const { container } = render(<ShareYourStoryForm />);
    expect(container.querySelector('[data-focus-flow]')).not.toBeNull();
  });

  it('gives a phone a way out that keeps the draft', () => {
    render(<ShareYourStoryForm />);
    expect(screen.getByRole('link', { name: /Save & exit/i })).toHaveAttribute('href', '/');
  });

  it('still says where the visitor is in the flow', () => {
    render(<ShareYourStoryForm />);
    expect(screen.getAllByText(/Step 1 of 6/i).length).toBeGreaterThan(0);
  });
});

describe('advancing keeps one heading per screen', () => {
  it('screen 2 asks only about the goal', async () => {
    const user = userEvent.setup();
    render(<ShareYourStoryForm />);

    await user.click(screen.getAllByRole('radio', { name: /Yourself/i })[0]);
    await user.click(screen.getByRole('button', { name: /^Continue$/i }));

    const h = headings();
    expect(h).toContain('How much do you want to raise?');
    // Whatever else screen 2 shows, it must not restate its own heading.
    expect(h.filter((t) => /how much do you want to raise/i.test(t))).toHaveLength(1);
    expect(screen.queryByText(/Start a fundraiser on LastDonor/i)).toBeNull();
    // And the heading it replaced is gone with it.
    expect(screen.queryByText(/Tell us how much you'd like to raise/i)).toBeNull();
  });
});

describe('screen 2 promises nothing the product does not do', () => {
  async function goalScreen() {
    const user = userEvent.setup();
    render(<ShareYourStoryForm />);
    await user.click(screen.getAllByRole('radio', { name: /Yourself/i })[0]);
    await user.click(screen.getByRole('button', { name: /^Continue$/i }));
    return user;
  }

  /*
    The screen carried an "Automated goal setting" toggle, defaulted ON and
    badged "Recommended", saying "we'll gradually adjust your goal as
    donations come in" and printing "Your starting goal would be: $600"
    under a $25,000 entry. `autoGoal` was never in the POST body, no column
    stores a starting goal, and no job raises one. See docs/76.
  */
  it('no longer offers a toggle that adjusts nothing', async () => {
    await goalScreen();
    expect(screen.queryByRole('switch', { name: /automated goal setting/i })).toBeNull();
    expect(screen.queryByText(/gradually adjust your goal/i)).toBeNull();
  });

  it('does not tell the organiser their goal will start lower', async () => {
    const user = await goalScreen();
    await user.type(screen.getByLabelText(/fundraising goal amount/i), '25000');
    expect(screen.queryByText(/starting goal would be/i)).toBeNull();
  });

  /*
    "$5,000" was a hardcoded string, not derived from category, location or
    anything else - and it could not have been: the platform has recorded no
    real fundraisers and no donations, so there is no "fundraisers like
    yours" to average.
  */
  it('states no average it cannot compute', async () => {
    await goalScreen();
    expect(screen.queryByText(/typically aim to raise/i)).toBeNull();
    expect(screen.queryByText(/Fundraisers like yours/i)).toBeNull();
  });

  it('says instead what actually happens to the number', async () => {
    await goalScreen();
    expect(screen.getByText(/a reviewer checks the goal/i)).toBeInTheDocument();
  });
});
