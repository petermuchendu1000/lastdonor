import Link from 'next/link';
import { FooterDarkModeToggle } from '@/components/layout/FooterDarkModeToggle';
import { FooterNewsletter } from '@/components/layout/FooterNewsletter';
import { ShieldCheckIcon } from '@heroicons/react/24/solid';

const LINK_GROUPS = [
  {
    title: 'Platform',
    links: [
      { label: 'Campaigns', href: '/campaigns' },
      { label: 'Compare Platforms', href: '/compare' },
      { label: 'Completed Campaigns', href: '/completed-campaigns' },
      { label: 'How It Works', href: '/how-it-works' },
      { label: 'Newsletter', href: '/newsletter' },
      { label: 'Share Your Story', href: '/share-your-story' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { label: 'Transparency', href: '/transparency' },
      { label: 'Rejected Campaigns', href: '/cancelled-campaigns' },
      { label: 'Editorial Standards', href: '/editorial-standards' },
      { label: 'Campaign Verification', href: '/campaign-verification-policy' },
      { label: 'Fund Release Policy', href: '/fund-release-policy' },
      { label: 'Campaign Rules', href: '/campaign-rules' },
      { label: 'Last Donor Wall', href: '/last-donor-wall' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Donor FAQ', href: '/donor-faq' },
      { label: 'Refund Policy', href: '/refund-policy' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
] as const;

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-[#0F1A19] text-gray-300">
      {/* Newsletter CTA strip */}
      <div className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6 lg:px-8">
          <div>
            <p className="font-display text-lg font-bold text-white">Stay in the loop</p>
            <p className="mt-1 text-sm text-gray-400">Impact stories and new reviewed campaigns.</p>
          </div>
          <FooterNewsletter />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div>
            <Link
              href="/"
              className="flex items-center gap-1 text-lg font-display font-bold tracking-tight text-white"
            >
              Last
              <span className="text-[#14B8A6]">Donor</span>
              <span className="text-[#FBBF24]">.</span>
            </Link>
            {/* data-nosnippet prevents this brand tagline from being extracted as
                an alternative page description by AI summary pipelines. The vague
                "You're the reason it's done" phrase does not parse as a clean
                Subject-Verb-Object triple and would dilute the more precise
                meta description if ingested as a snippet. */}
            <p data-nosnippet className="mt-3 text-sm leading-relaxed text-gray-400">
              Reviewed fundraising for real people in crisis, with visible campaign progress.
              You&apos;re the reason it&apos;s done.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#14B8A6]/15 px-3 py-2">
              <ShieldCheckIcon className="h-4 w-4 text-[#14B8A6]" />
              <span className="text-xs font-medium text-[#14B8A6]">Reviewed Fundraising Platform</span>
            </div>

            {/* Contact details for privacy and commercial disclosure pages. */}
            <p className="mt-4 text-xs leading-relaxed text-gray-500">
              LastDonor.org<br />
              United States<br />
              contact@lastdonor.org
            </p>

            {/* Trust badges */}
            <div className="mt-4 flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                Secured by Stripe
              </span>
              <span className="flex items-center gap-1">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                SSL Protected
              </span>
            </div>
          </div>

          {/* Link groups */}
          {LINK_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-white">
                {group.title}
              </h3>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-400 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex items-center justify-between border-t border-white/10 pt-6">
          <p className="text-xs text-gray-500">
            &copy; {year} LastDonor.org. All rights reserved.
          </p>
          <FooterDarkModeToggle />
        </div>
      </div>
    </footer>
  );
}
