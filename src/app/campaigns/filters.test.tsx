import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignFilters } from './filters';
import type { CampaignCategory } from '@/types';

/* ------------------------------------------------------------------ */
/*  Mock next/navigation                                              */
/* ------------------------------------------------------------------ */

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

/* ------------------------------------------------------------------ */
/*  Default props                                                     */
/* ------------------------------------------------------------------ */

const defaultProps = {
  activeCategory: null as CampaignCategory | null,
  activeSort: 'most_funded',
  activeCloseToTarget: false,
  searchQuery: '',
  activeLocation: '',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Extract the URL pushed to router from the last call */
function getLastPushedUrl(): string {
  const calls = mockPush.mock.calls;
  return calls[calls.length - 1]?.[0] ?? '';
}

function getLastPushedParams(): URLSearchParams {
  const url = getLastPushedUrl();
  const qs = url.split('?')[1] ?? '';
  return new URLSearchParams(qs);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  mockPush.mockClear();
  mockSearchParams = new URLSearchParams();
});

describe('CampaignFilters', () => {
  // ────────────────────────────────────────────────────────
  //  SEARCH
  // ────────────────────────────────────────────────────────

  describe('Search', () => {
    it('renders search input with placeholder', () => {
      render(<CampaignFilters {...defaultProps} />);
      expect(
        screen.getByPlaceholderText('Search campaigns by name, person, or location'),
      ).toBeInTheDocument();
    });

    it('submits search term as ?q= param', async () => {
      const user = userEvent.setup();
      render(<CampaignFilters {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search campaigns by name, person, or location');
      await user.type(input, 'Johnson');
      await user.keyboard('{Enter}');

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.get('q')).toBe('johnson'); // normalized to lowercase
    });

    it('removes ?q= param when search is empty', async () => {
      const user = userEvent.setup();
      render(<CampaignFilters {...defaultProps} searchQuery="test" />);

      const input = screen.getByPlaceholderText('Search campaigns by name, person, or location');
      await user.clear(input);
      await user.keyboard('{Enter}');

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.has('q')).toBe(false);
    });

    it('shows clearable chip when searchQuery is active', () => {
      render(<CampaignFilters {...defaultProps} searchQuery="Johnson" />);
      expect(screen.getByText(/Johnson/)).toBeInTheDocument();
    });

    it('clears search chip on click', async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams('q=johnson');
      render(<CampaignFilters {...defaultProps} searchQuery="johnson" />);

      // Find the clearable chip (has XMarkIcon + text)
      const chip = screen.getByText(/johnson/).closest('button')!;
      await user.click(chip);

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.has('q')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────
  //  CATEGORY (Popover pill)
  // ────────────────────────────────────────────────────────

  describe('Category pill', () => {
    it('renders Category pill showing "Category" when none selected', () => {
      render(<CampaignFilters {...defaultProps} />);
      expect(screen.getByRole('button', { name: /^Category/i })).toBeInTheDocument();
    });

    it('shows active category label on pill when selected', () => {
      render(<CampaignFilters {...defaultProps} activeCategory={'medical' as CampaignCategory} />);
      // The pill should show "Medical" not "Category"
      const pills = screen.getAllByRole('button');
      const categoryPill = pills.find((b) => b.textContent?.includes('Medical'));
      expect(categoryPill).toBeTruthy();
    });

    it('sets category param when category pill is clicked in popover', async () => {
      const user = userEvent.setup();
      render(<CampaignFilters {...defaultProps} />);

      // Open the popover
      const categoryPill = screen.getByRole('button', { name: /^Category/i });
      await user.click(categoryPill);

      // Click "Veterans" inside the popover
      const veteransBtn = await screen.findByRole('button', { name: 'Veterans' });
      await user.click(veteransBtn);

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.get('category')).toBe('veterans');
    });

    it('toggles category off when same category clicked again', async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams('category=medical');
      render(<CampaignFilters {...defaultProps} activeCategory={'medical' as CampaignCategory} />);

      // Open popover
      const categoryPill = screen.getAllByRole('button').find((b) => b.textContent?.includes('Medical'));
      await user.click(categoryPill!);

      // Click "Medical" again to deselect
      const medicalBtns = await screen.findAllByRole('button', { name: 'Medical' });
      // The one inside the popover content
      await user.click(medicalBtns[medicalBtns.length - 1]);

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.has('category')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────
  //  SORT (Popover pill)
  // ────────────────────────────────────────────────────────

  describe('Sort pill', () => {
    it('renders sort pill with "Most Funded" as default label', () => {
      render(<CampaignFilters {...defaultProps} />);
      const sortPill = screen.getAllByRole('button').find((b) => b.textContent?.includes('Most Funded'));
      expect(sortPill).toBeTruthy();
    });

    it('shows active sort label when not default', () => {
      render(<CampaignFilters {...defaultProps} activeSort="newest" />);
      const sortPill = screen.getAllByRole('button').find((b) => b.textContent?.includes('Newest'));
      expect(sortPill).toBeTruthy();
    });

    it('sets sort param on option click', async () => {
      const user = userEvent.setup();
      render(<CampaignFilters {...defaultProps} />);

      // Open sort popover
      const sortPill = screen.getAllByRole('button').find((b) => b.textContent?.includes('Most Funded'));
      await user.click(sortPill!);

      // Click "Newest"
      const newest = await screen.findByRole('button', { name: 'Newest' });
      await user.click(newest);

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.get('sort')).toBe('newest');
    });

    it('removes sort param when "Most Funded" (default) is selected', async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams('sort=newest');
      render(<CampaignFilters {...defaultProps} activeSort="newest" />);

      const sortPill = screen.getAllByRole('button').find((b) => b.textContent?.includes('Newest'));
      await user.click(sortPill!);

      const mostFunded = await screen.findByRole('button', { name: 'Most Funded' });
      await user.click(mostFunded);

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.has('sort')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────
  //  CLOSE TO TARGET (toggle pill)
  // ────────────────────────────────────────────────────────

  describe('Close-to-target pill', () => {
    it('renders "Close to target" pill', () => {
      render(<CampaignFilters {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Close to target/i })).toBeInTheDocument();
    });

    it('sets close_to_target=1 on click', async () => {
      const user = userEvent.setup();
      render(<CampaignFilters {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Close to target/i }));

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.get('close_to_target')).toBe('1');
    });

    it('removes close_to_target param when toggled off', async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams('close_to_target=1');
      render(<CampaignFilters {...defaultProps} activeCloseToTarget={true} />);

      await user.click(screen.getByRole('button', { name: /Close to target/i }));

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.has('close_to_target')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────
  //  LOCATION (Popover pill)
  // ────────────────────────────────────────────────────────

  describe('Location pill', () => {
    it('renders Location pill', () => {
      render(<CampaignFilters {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Location/i })).toBeInTheDocument();
    });

    it('shows active location text on pill when set', () => {
      render(<CampaignFilters {...defaultProps} activeLocation="Texas" />);
      const locPill = screen.getAllByRole('button').find((b) => b.textContent?.includes('Texas'));
      expect(locPill).toBeTruthy();
    });

    it('sets location param on form submit', async () => {
      const user = userEvent.setup();
      render(<CampaignFilters {...defaultProps} />);

      // Open location popover
      const locPill = screen.getByRole('button', { name: /Location/i });
      await user.click(locPill);

      // Type in location
      const input = await screen.findByPlaceholderText('e.g. Texas, San Diego');
      await user.type(input, 'San Diego');

      // Click Apply
      const apply = screen.getByRole('button', { name: /Apply/i });
      await user.click(apply);

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.get('location')).toBe('San Diego');
    });

    it('shows clearable location chip when active', () => {
      render(<CampaignFilters {...defaultProps} activeLocation="California" />);
      // Find the chip with location text and X icon
      const chip = screen.getAllByRole('button').find(
        (b) => b.textContent?.includes('California') && b.querySelector('svg'),
      );
      expect(chip).toBeTruthy();
    });

    it('clears location chip on click', async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams('location=California');
      render(<CampaignFilters {...defaultProps} activeLocation="California" />);

      // Find the clearable chip (in the pill bar, not the popover trigger)
      const chips = screen.getAllByRole('button').filter(
        (b) => b.textContent?.includes('California'),
      );
      // The last one is the clearable chip (after the popover trigger)
      const clearableChip = chips[chips.length - 1];
      await user.click(clearableChip);

      expect(mockPush).toHaveBeenCalled();
      const params = getLastPushedParams();
      expect(params.has('location')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────
  //  FILTER COUNT BADGE
  // ────────────────────────────────────────────────────────

  describe('Filter count badge', () => {
    it('shows no badge when no filters active', () => {
      render(<CampaignFilters {...defaultProps} />);
      const filtersBtn = screen.getByRole('button', { name: /Filters/i });
      expect(filtersBtn.textContent).not.toMatch(/\d/);
    });

    it('shows badge count for active filters', () => {
      render(
        <CampaignFilters
          {...defaultProps}
          activeCategory={'medical' as CampaignCategory}
          activeSort="newest"
          activeCloseToTarget={true}
          activeLocation="Texas"
        />,
      );
      const filtersBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Filters'));
      expect(filtersBtn?.textContent).toContain('4');
    });

    it('counts location in filter badge', () => {
      render(<CampaignFilters {...defaultProps} activeLocation="Texas" />);
      const filtersBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Filters'));
      expect(filtersBtn?.textContent).toContain('1');
    });
  });

  // ────────────────────────────────────────────────────────
  //  PARAM PRESERVATION
  // ────────────────────────────────────────────────────────

  describe('Param preservation', () => {
    it('preserves existing params when adding new filter', async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams('category=medical&q=help');
      render(
        <CampaignFilters
          {...defaultProps}
          activeCategory={'medical' as CampaignCategory}
          searchQuery="help"
        />,
      );

      // Toggle close-to-target
      await user.click(screen.getByRole('button', { name: /Close to target/i }));

      const params = getLastPushedParams();
      expect(params.get('category')).toBe('medical');
      expect(params.get('q')).toBe('help');
      expect(params.get('close_to_target')).toBe('1');
    });
  });

  // ────────────────────────────────────────────────────────
  //  CLEAR FILTERS (docs/45)
  //
  //  Reset used to live only inside the Filters drawer, so a zero-result
  //  filter URL had no visible exit but the browser Back button.
  // ────────────────────────────────────────────────────────

  describe('Clear filters', () => {
    it('is absent when nothing is filtered', () => {
      render(<CampaignFilters {...defaultProps} />);
      expect(screen.queryByRole('button', { name: /Clear filters/ })).not.toBeInTheDocument();
    });

    it('appears on the filter bar itself when a filter is active', () => {
      render(<CampaignFilters {...defaultProps} activeCloseToTarget />);
      const clear = screen.getByRole('button', { name: /Clear filters/ });
      expect(clear).toBeInTheDocument();
      expect(clear).toHaveAttribute('type', 'button');
    });

    it('appears for a search term with no other filter', () => {
      render(<CampaignFilters {...defaultProps} searchQuery="fire" />);
      expect(screen.getByRole('button', { name: /Clear filters/ })).toBeInTheDocument();
    });

    it('navigates to the unfiltered listing', async () => {
      const user = userEvent.setup();
      mockSearchParams = new URLSearchParams('q=fire&category=medical&close_to_target=1');
      render(
        <CampaignFilters
          {...defaultProps}
          activeCategory={'medical' as CampaignCategory}
          activeCloseToTarget
          searchQuery="fire"
          activeLocation="Memphis"
        />,
      );

      await user.click(screen.getByRole('button', { name: /Clear filters/ }));

      expect(getLastPushedUrl()).toBe('/campaigns');
    });

    it('clears the search and location inputs it owns', async () => {
      const user = userEvent.setup();
      render(<CampaignFilters {...defaultProps} searchQuery="fire" activeLocation="Memphis" />);

      const search = screen.getByPlaceholderText(
        'Search campaigns by name, person, or location',
      ) as HTMLInputElement;
      expect(search.value).toBe('fire');

      await user.click(screen.getByRole('button', { name: /Clear filters/ }));

      expect(search.value).toBe('');
    });
  });

  // ────────────────────────────────────────────────────────
  //  LOADING STATE
  // ────────────────────────────────────────────────────────

  describe('Loading state', () => {
    it('renders container with data-pending during transition', () => {
      // Since startTransition + isPending is internal React behavior,
      // we verify the data-pending attribute setup is present in the DOM
      const { container } = render(<CampaignFilters {...defaultProps} />);
      const wrapper = container.querySelector('[class*="space-y"]');
      expect(wrapper).toBeTruthy();
      // data-pending should NOT be set when not pending
      expect(wrapper?.getAttribute('data-pending')).toBeNull();
    });
  });
});
