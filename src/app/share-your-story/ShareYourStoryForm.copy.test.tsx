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

/**
 * Render the wizard and stop on `step` — the SAME zero-based index the
 * component uses, so `advanceTo(5)` is the screen headed "Step 6 of 6".
 *
 * Each block fills only what that screen needs to unlock Continue, then
 * returns if it is the destination. Asserted below by the step indicator,
 * because an off-by-one here silently tests the wrong screen — which it
 * did on the first attempt.
 */
async function advanceTo(step: number) {
  const user = userEvent.setup();
  render(<ShareYourStoryForm />);
  const next = () => user.click(screen.getByRole('button', { name: /^Continue$/i }));

  await user.click(screen.getAllByRole('radio', { name: /Yourself/i })[0]);
  if (step > 0) {
    await next();
    await user.type(screen.getByLabelText(/fundraising goal amount/i), '25000');
  }
  if (step > 1) await next(); // screen 3 requires nothing
  if (step > 2) {
    await next();
    await user.type(screen.getByPlaceholderText(/City, State/i), 'Austin, TX');
    await user.click(screen.getByRole('radio', { name: /^Medical$/i }));
  }
  if (step > 3) {
    await next();
    await user.type(
      screen.getByPlaceholderText(/Help \[Name\] recover|Help .* with/i),
      'Help the Okonkwo family rebuild after the fire',
    );
    await user.type(
      screen.getByRole('textbox', { name: /story/i }),
      'A fire destroyed the family home last week and they need help rebuilding it. '.repeat(4),
    );
  }
  if (step > 4) await next();

  expect(screen.getAllByText(new RegExp(`Step ${step + 1} of 6`, 'i')).length).toBeGreaterThan(0);
  return user;
}

describe('screens 3 to 5 each say one thing once', () => {
  it('screen 3 does not head "Add photos or video" and then say it again', async () => {
    await advanceTo(2);
    const h = headings();
    expect(h).toEqual(['Add photos or video']);
    expect(screen.queryByText(/Add a cover photo or video/i)).toBeNull();
    expect(screen.queryByText(/Cover media helps tell your story/i)).toBeNull();
  });

  it('screen 4 asks for a category once, and calls the city field what it is', async () => {
    await advanceTo(3);
    const h = headings();
    expect(h).toContain('What is this fundraiser for?');
    expect(h).toContain('Category');
    expect(h).toContain('Where is the person based?');
    // The duplicate question, and a heading that asked about money over a
    // field that collects a town.
    expect(screen.queryByText(/What best describes why you.{1,3}re fundraising/i)).toBeNull();
    expect(screen.queryByText(/Where will the funds go/i)).toBeNull();
  });

  it('screen 5 keeps the personalised story heading without repeating the step heading', async () => {
    await advanceTo(4);
    const h = headings();
    expect(h).toContain('Title and story');
    expect(h).toContain('Campaign title');
    expect(h.some((t) => /^Tell .*story$/i.test(t))).toBe(true);
    // The step heading used to be "Tell the story", colliding with the one above.
    expect(h.filter((t) => /story/i.test(t)).length).toBeLessThanOrEqual(2);
  });

  it('screen 5 keeps the writing tips, behind a disclosure', async () => {
    await advanceTo(4);
    const summary = screen.getByText('Writing tips');
    expect(summary.closest('details')).not.toBeNull();
    expect(summary.closest('details')!.open).toBe(false);
    // Closed, but still in the DOM for anyone who opens it.
    expect(screen.getByText(/Show strength, not helplessness/i)).toBeInTheDocument();
  });
});

describe('screen 6 describes what the button actually does', () => {
  /*
    `POST /api/v1/user-campaigns` inserts with status 'active' and
    publishedAt set, and its own comments say "instant-live" and "campaign
    is live, no review needed". The screen used to promise an editorial
    review "typically within 24 hours" and approval before going live.
    See docs/77.
  */
  it('does not promise a review before publication', async () => {
    await advanceTo(5);
    expect(screen.queryByText(/typically within 24 hours/i)).toBeNull();
    expect(screen.queryByText(/Once approved, your campaign goes live/i)).toBeNull();
    expect(screen.queryByText(/editorial team reviews your campaign/i)).toBeNull();
  });

  it('says the page goes live straight away, which is what happens', async () => {
    await advanceTo(5);
    expect(screen.getByText(/goes live and can accept donations straight away/i)).toBeInTheDocument();
  });

  it('keeps the two next-steps that are true', async () => {
    await advanceTo(5);
    // notifyWelcomeCampaigner fires on this request and its template really
    // does carry sharing tips.
    expect(screen.getByText(/tips to maximize your reach/i)).toBeInTheDocument();
    expect(screen.getByText(/Share your campaign link/i)).toBeInTheDocument();
  });

  it('states the instruction once, not three times', async () => {
    await advanceTo(5);
    expect(screen.queryByText(/Review Your Campaign/i)).toBeNull();
    expect(screen.queryByText(/Check the details below, then agree/i)).toBeNull();
    expect(headings()).toContain('Review and submit');
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
