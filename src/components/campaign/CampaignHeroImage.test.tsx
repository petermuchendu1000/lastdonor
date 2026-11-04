/**
 * ⛔ What a CRAWLER sees, which is the whole reason this component changed.
 *
 * The previous version of this file asserted, as its first test, that the
 * stored image renders on initial load - with
 * `src: 'https://example.com/hero.jpg'`. That was the defect written down as
 * desired behaviour (`docs/109`'s shape, and `docs/150`'s): it pinned the
 * stock photograph in place while the fallback it tested, which only ever ran
 * in a browser, was invisible to the crawler that mattered.
 *
 * So these assertions are about the FIRST render, not the error path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CampaignHeroImage } from './CampaignHeroImage';
import { CATEGORY_CONTENT } from '@/lib/category-content';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, onError, ...rest } = props;
    return (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img
        {...rest}
        data-fill={fill ? 'true' : undefined}
        onError={onError as React.ReactEventHandler<HTMLImageElement>}
      />
    );
  },
}));

const SUPABASE = 'https://vavxdjqufxrsbyohcwdh.supabase.co';
const UPLOAD = `${SUPABASE}/storage/v1/object/public/media/campaign-photos/59171bbc.jpg`;
/** What the resolver now renders for it: our own domain (see `campaign-hero.ts`). */
const FIRST_PARTY_UPLOAD = '/media/campaign-photos/59171bbc.jpg';
const STOCK = 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=800';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('CampaignHeroImage, on the first render', () => {
  it('⛔ a stored stock photo is ALREADY the panel, with no error needed', () => {
    render(
      <CampaignHeroImage
        src={STOCK}
        alt="Keisha Wallace Fights to Keep Her Four Kids Off Atlanta Streets"
        category="medical"
      />,
    );
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/images/categories/medical-panel.webp');
    // The crawler must never be handed the stock URL at all.
    expect(img.getAttribute('src')).not.toContain('unsplash');
  });

  it('⛔ and it is not captioned with the named person\'s crisis', () => {
    render(
      <CampaignHeroImage
        src={STOCK}
        alt="Keisha Wallace Fights to Keep Her Four Kids Off Atlanta Streets"
        category="medical"
      />,
    );
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'LastDonor Medical campaign');
  });

  it('⚠️ CONTROL: an organiser\'s own photo renders, and keeps the campaign title', () => {
    /*
      Without this the fix would be satisfied by "show a panel always", which
      would delete the two real photographs the platform has.
    */
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    render(
      <CampaignHeroImage src={UPLOAD} alt="Help John Recover After a Car Accident" category="medical" />,
    );
    const img = screen.getByRole('img');
    /*
      FIRST-PARTY, not the stored URL. This used to assert `UPLOAD` itself;
      the upstream host sends `X-Robots-Tag: none`, so the photo is now
      served from our own `/media/` route. The property guarded here is
      unchanged - the real photograph is still rendered, not a panel.
    */
    expect(img).toHaveAttribute('src', FIRST_PARTY_UPLOAD);
    expect(img).not.toHaveAttribute('src', UPLOAD);
    expect(img).toHaveAttribute('alt', 'Help John Recover After a Car Accident');
  });

  it('passes fill, sizes, priority and className through', () => {
    render(
      <CampaignHeroImage
        src={STOCK}
        alt="T"
        category="medical"
        fill
        sizes="100vw"
        priority
        className="object-cover"
      />,
    );
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('data-fill', 'true');
    expect(img).toHaveAttribute('sizes', '100vw');
    expect(img).toHaveAttribute('class', 'object-cover');
  });
});

describe('the error path, which is now only for a real photo that 404s', () => {
  it('a deleted organiser photo falls back to the panel', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    render(<CampaignHeroImage src={UPLOAD} alt="Gone" category="memorial" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', FIRST_PARTY_UPLOAD);

    fireEvent.error(img);

    expect(img).toHaveAttribute('src', '/images/categories/memorial-panel.webp');
    expect(img).toHaveAttribute('alt', 'LastDonor Memorial campaign');
  });

  it('does not loop once the panel is showing', () => {
    render(<CampaignHeroImage src={STOCK} alt="T" category="medical" />);
    const img = screen.getByRole('img');
    const first = img.getAttribute('src');

    fireEvent.error(img);
    fireEvent.error(img);

    expect(img).toHaveAttribute('src', first!);
  });

  it('an unknown category uses the community panel', () => {
    render(<CampaignHeroImage src={STOCK} alt="T" category="not-real" />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/images/categories/community-panel.webp',
    );
  });

  it('defaults to community when no category is given', () => {
    render(<CampaignHeroImage src={STOCK} alt="T" />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/images/categories/community-panel.webp',
    );
  });
});

describe('every category renders its own panel', () => {
  it.each(CATEGORY_CONTENT.map((c) => c.slug))('%s', (slug) => {
    render(<CampaignHeroImage src={STOCK} alt="T" category={slug} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      `/images/categories/${slug}-panel.webp`,
    );
  });
});
