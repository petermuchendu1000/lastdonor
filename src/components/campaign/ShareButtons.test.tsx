/**
 * The public campaign share row.
 *
 * Two things are under test, and they fail for different reasons.
 *
 * **Reach.** WhatsApp was absent from this row while three other surfaces
 * carried it, and the row is the only share control on a campaign page that
 * is not donatable. Facebook got no text, X got a bare title.
 *
 * **Attribution.** `docs/58` says a signed-in sharer gets a countable
 * `/s/<token>`, because `/dashboard/impact` can only report what a link
 * carried. Neither this component nor `SidebarShareButton` had any test
 * before this file, so the mint had no coverage at all - which is how this
 * row came to hand out the plain URL while its sibling minted.
 *
 * ⚠️ The `rel="noopener"` assertion is a SECURITY property, not tidiness.
 * The documented way to attribute a social intent link is to hold a
 * `window.open` handle across the mint, and that handle is `null` when
 * `noopener` is passed - so the pressure to drop it comes precisely from
 * trying to improve this file. See the trade-off note in the component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUseSession = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: mockToast }));

import { ShareButtons } from '@/components/campaign/ShareButtons';
import { resetSessionReadHealth } from '@/lib/auth-state';

const URL_PLAIN = 'https://lastdonor.org/campaigns/marcus-delgado';
const TITLE = 'Help Marcus get home';
const ATTRIBUTED = 'https://lastdonor.org/s/abc123';

/** A signed-in viewer whose mint succeeds. */
function signedIn() {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1' } },
    status: 'authenticated',
  });
}

function anonymous() {
  mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSessionReadHealth();
  mockUseSession.mockReset();
  mockToast.success.mockReset();
  mockToast.error.mockReset();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  global.fetch = vi.fn();
});

afterEach(() => {
  resetSessionReadHealth();
  vi.restoreAllMocks();
});

function hrefFor(label: string): string {
  return screen.getByLabelText(label).getAttribute('href') ?? '';
}

describe('reach: every channel a visitor would actually use', () => {
  beforeEach(() => anonymous());

  it('offers WhatsApp, carrying both the message and the link', () => {
    render(<ShareButtons url={URL_PLAIN} title={TITLE} />);

    const href = hrefFor('Share on WhatsApp');
    expect(href).toContain('https://wa.me/?text=');
    // The failure this guards is a link with the URL and no words, or words
    // and no URL - WhatsApp has one text field and it must hold both.
    expect(decodeURIComponent(href)).toContain(TITLE);
    expect(decodeURIComponent(href)).toContain(URL_PLAIN);
  });

  it('sends X the share sentence, not a bare title', () => {
    render(<ShareButtons url={URL_PLAIN} title={TITLE} />);

    const text = decodeURIComponent(hrefFor('Share on X'));
    expect(text).toContain(TITLE);
    expect(text).toMatch(/please take a look/i);
  });

  it('gives the mail body the link, not just the subject', () => {
    render(<ShareButtons url={URL_PLAIN} title={TITLE} />);

    const href = decodeURIComponent(hrefFor('Share via email'));
    expect(href).toMatch(/body=.*please take a look/i);
    expect(href).toContain(URL_PLAIN);
  });

  it('still offers Facebook, which accepts only a URL', () => {
    render(<ShareButtons url={URL_PLAIN} title={TITLE} />);
    expect(hrefFor('Share on Facebook')).toContain(
      `facebook.com/sharer/sharer.php?u=${encodeURIComponent(URL_PLAIN)}`,
    );
  });

  it('⚠️ every external intent link keeps rel="noopener"', () => {
    render(<ShareButtons url={URL_PLAIN} title={TITLE} />);

    for (const label of ['Share on WhatsApp', 'Share on Facebook', 'Share on X']) {
      const rel = screen.getByLabelText(label).getAttribute('rel') ?? '';
      expect(rel, `${label} lost noopener`).toContain('noopener');
    }
  });
});

describe('attribution: copy-link credits the sharer', () => {
  it('copies this sharer\'s /s/ link when signed in', async () => {
    signedIn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { url: ATTRIBUTED } }),
    });

    render(<ShareButtons url={URL_PLAIN} title={TITLE} campaignSlug="marcus-delgado" />);
    await userEvent.click(screen.getByLabelText('Copy link to clipboard'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ATTRIBUTED));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/campaigns/marcus-delgado/share-link',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('never mints for an anonymous viewer, and copies the plain URL', async () => {
    anonymous();
    render(<ShareButtons url={URL_PLAIN} title={TITLE} campaignSlug="marcus-delgado" />);
    await userEvent.click(screen.getByLabelText('Copy link to clipboard'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_PLAIN));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not mint when there is no campaign to credit (the blog)', async () => {
    signedIn();
    render(<ShareButtons url={URL_PLAIN} title={TITLE} />);
    await userEvent.click(screen.getByLabelText('Copy link to clipboard'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_PLAIN));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to the plain URL when the mint is refused', async () => {
    signedIn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });

    render(<ShareButtons url={URL_PLAIN} title={TITLE} campaignSlug="marcus-delgado" />);
    await userEvent.click(screen.getByLabelText('Copy link to clipboard'));

    // The share is the feature; attribution is the enhancement. A 429 from
    // the mint route must not leave the sharer with nothing on the clipboard.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_PLAIN));
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('falls back to the plain URL when the mint never answers', async () => {
    signedIn();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('timed out', 'TimeoutError'),
    );

    render(<ShareButtons url={URL_PLAIN} title={TITLE} campaignSlug="marcus-delgado" />);
    await userEvent.click(screen.getByLabelText('Copy link to clipboard'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_PLAIN));
  });

  it('a second copy costs no second request', async () => {
    signedIn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { url: ATTRIBUTED } }),
    });

    render(<ShareButtons url={URL_PLAIN} title={TITLE} campaignSlug="marcus-delgado" />);
    const button = screen.getByLabelText('Copy link to clipboard');
    await userEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ATTRIBUTED));
    await userEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

    // `mintShareLink` is idempotent per (campaign, user), so a re-POST would
    // be harmless - but a sharer who taps five times should not send five
    // writes, and the cached handle is what proves the ref is doing its job.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a clipboard failure, which is the one failure worth a toast', async () => {
    anonymous();
    writeText.mockRejectedValue(new Error('denied'));

    render(<ShareButtons url={URL_PLAIN} title={TITLE} />);
    await userEvent.click(screen.getByLabelText('Copy link to clipboard'));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });
});
