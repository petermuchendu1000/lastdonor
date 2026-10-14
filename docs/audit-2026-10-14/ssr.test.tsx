import { describe, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeroSection } from '@/components/homepage/HeroSection';
import { TrustBar } from '@/components/homepage/TrustBar';

describe('SSR markup of motion sections', () => {
  it('HeroSection', () => {
    const html = renderToStaticMarkup(<HeroSection />);
    console.log('--- HERO: occurrences of opacity:0 ---', (html.match(/opacity:\s*0/g) || []).length);
    const i = html.indexOf('Browse Reviewed Campaigns');
    console.log('--- context around primary CTA ---');
    console.log(html.slice(Math.max(0, i - 700), i + 60));
  });
  it('TrustBar', () => {
    const html = renderToStaticMarkup(<TrustBar stats={{ totalRaised: 123456, campaignCount: 7, donorCount: 42 } as never} />);
    console.log('--- TRUSTBAR opacity:0 count ---', (html.match(/opacity:\s*0/g) || []).length);
    console.log(html.slice(0, 900));
  });
});
