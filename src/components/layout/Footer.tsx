import Link from 'next/link';
import { CreditCardIcon } from '@/components/ui/icon';
import { FooterDarkModeToggle } from '@/components/layout/FooterDarkModeToggle';
import { FooterNewsletter } from '@/components/layout/FooterNewsletter';

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
    // `data-site-chrome` marks this as sitewide furniture that a checkout
    // page suppresses. See the `:has([data-focus-flow])` rule in globals.css.
    <footer data-site-chrome="footer" className="bg-[#0F1A19] text-gray-300">
      {/* Newsletter CTA strip */}
      <div className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 px-4 py-6 sm:flex-row sm:items-center sm:gap-4 sm:px-6 sm:py-8 lg:px-8">
          <div>
            <p className="font-display text-lg font-bold text-white">Stay in the loop</p>
            <p className="mt-1 text-sm text-gray-400">Impact stories and new reviewed campaigns.</p>
          </div>
          <FooterNewsletter />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        {/*
          The brand block spans the row on a phone and the three link groups
          sit two-up beneath it. They used to stack one per row: eighteen
          links in a single column ran the footer to 1,408px at 390px wide,
          against 589px on desktop, which was roughly a fifth of the whole
          homepage. See docs/69.
        */}
        <div className="grid gap-8 sm:grid-cols-2 sm:gap-10 lg:grid-cols-4">
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
            {/*
              The "Reviewed Fundraising Platform" pill was removed on
              2026-10-16: the tagline directly above it already opens with
              "Reviewed fundraising", and the trust bar at the top of the
              page says "Human reviewed". Three statements of one claim
              inside one viewport. See docs/69.
            */}

            {/* Contact details for privacy and commercial disclosure pages. */}
            <p className="mt-4 text-xs leading-relaxed text-gray-500">
              LastDonor.org<br />
              United States<br />
              contact@lastdonor.org
            </p>

            {/* Trust badges */}
            <div className="mt-4 flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                {/*
                  Was a hand-rolled inline SVG element with its own viewBox and
                  strokeWidth={2}, one of seventeen such in `src/`. It now
                  comes through the icon layer, so it carries the brand
                  stroke and the shared size scale like everything else.
                  See docs/70.
                */}
                <CreditCardIcon size="sm" />
                Secured by Stripe
              </span>
              {/*
                "SSL Protected" was removed: every site has been HTTPS for
                years, so it signals nothing and spends a line saying so.
                "Secured by Stripe" stays, because who holds the card
                details is a real question a donor has.
              */}
            </div>
          </div>

          {/*
            Multi-column on a phone, grid columns from sm up.

            A two-column GRID looked right and was not: the three groups have
            6, 7 and 4 links, so row one took its height from Trust and left
            dead space under Platform while Legal started a new row. CSS
            columns flow the groups instead, so they pack. `break-inside:
            avoid` keeps a group from splitting across the gutter, and
            `contents` hands the groups back to the grid at sm, where each
            one wants its own column.

            Eighteen links in one stacked column ran this footer to 1,408px
            at 390px wide against 589px on desktop, about a fifth of the
            whole homepage. See docs/69.
          */}
          {/*
            CSS columns on a phone, grid columns from `sm`.

            Three attempts, and the reason the simplest one wins:

            1. A two-column GRID of the three groups put Platform and Trust
               in row one and pushed Legal to row two, so row one took its
               height from Trust and left dead space under Platform.
            2. Pairing Platform and Legal into one cell balanced it and cost
               30px, but a paired cell is adjacent in the DOM while being
               visually split by Trust, so the focus order stopped matching
               the reading order (WCAG 2.4.3). Adding `sm:order-*` only
               moved that mismatch from mobile to desktop.
            3. `columns-2` flows the groups down the first column and on to
               the second, which is exactly DOM order, so reading order and
               focus order agree at every width. It leaves some space under
               the shorter column. That is a cosmetic cost, and it is the
               right one to pay.

            Eighteen links stacked in a single column ran this footer to
            1,408px at 390px wide against 589px on desktop, about a fifth of
            the whole homepage. See docs/69.
          */}
          <div className="columns-2 gap-x-6 sm:contents">
            {LINK_GROUPS.map((group) => (
              <div key={group.title} className="mb-7 break-inside-avoid sm:mb-0">
                <FooterLinkGroup group={group} />
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex items-center justify-between border-t border-white/10 pt-6 sm:mt-12">
          <p className="text-xs text-gray-500">
            &copy; {year} LastDonor.org. All rights reserved.
          </p>
          <FooterDarkModeToggle />
        </div>
      </div>
    </footer>
  );
}

/** One titled column of footer links. Extracted so the mobile pairing above
 *  can place the same markup in two different cells. */
function FooterLinkGroup({ group }: { group: (typeof LINK_GROUPS)[number] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white">{group.title}</h3>
      <ul className="mt-2.5 space-y-1.5">
        {group.links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-block py-0.5 text-sm text-gray-400 transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
