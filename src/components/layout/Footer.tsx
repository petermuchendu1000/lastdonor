import Link from 'next/link';
import { CreditCardIcon } from '@/components/ui/icon';
import { FooterDarkModeToggle } from '@/components/layout/FooterDarkModeToggle';
import { FooterNewsletter } from '@/components/layout/FooterNewsletter';
import { SOCIAL_LINKS } from '@/lib/social-links';

const LINK_GROUPS = [
  {
    title: 'Platform',
    links: [
      /*
       * `/about` is here because the footer is the only CRAWLER-VISIBLE
       * navigation on this site. `Navbar.tsx`'s `ABOUT_ITEMS` does list it,
       * but inside a Radix `DropdownMenuContent` (and a `useState` mobile
       * menu), which mount only when opened - so the link never appeared in
       * the server-rendered HTML and `/about` had ZERO inbound internal
       * links across all 56 sitemap URLs, while the Organization `@graph`
       * advertised it as a `SiteNavigationElement`. See docs/143.
       */
      { label: 'About LastDonor', href: '/about' },
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

            {/*
              Contact details for privacy and commercial disclosure pages.

              `text-gray-400`, not `-500`. This footer sits on the dark
              `--surface-ink` (docs/59), where `text-gray-500` (#6a7282) is
              3.67:1 against #0f1a19 and AA wants 4.5:1. `gray-400`
              (#99a1af) is 6.83:1 and is the smallest step that passes.
              Measured with axe, see docs/99.
            */}
            <p className="mt-4 text-xs leading-relaxed text-gray-400">
              LastDonor.org<br />
              United States<br />
              contact@lastdonor.org
            </p>

            {/*
              Social profiles, from `SOCIAL_LINKS` - the same list the
              Organization JSON-LD publishes as `sameAs`, so the footer and
              the entity graph cannot disagree about which accounts exist.

              An entry whose `href` is null is a platform we are not on yet.
              It renders as inert text, never as a link, and `layout.tsx`
              reads `PUBLISHED_SOCIAL_LINKS` so it cannot reach `sameAs` -
              which is an ownership assertion, not a link. The two profiles
              `sameAs` used to claim both returned 404 (docs/76); this is the
              arrangement that lets the row exist before the accounts do
              without repeating that. See docs/91.

              Text, not brand icons, and deliberately: the icon system is
              stroke-only (`fill="none"`, one stroke width - docs/70), so
              X, Instagram and the rest would have to be redrawn as outlines,
              which misrepresents marks their owners publish as filled
              shapes. Real brand SVGs can be added with the real URLs, as a
              documented exception to that system rather than a silent one.
            */}
            {SOCIAL_LINKS.length > 0 && (
              <nav aria-label="LastDonor on social media" className="mt-4">
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {SOCIAL_LINKS.map((link) =>
                    link.href === null ? (
                      /*
                        No `href`, so it is not a link and not focusable -
                        a keyboard user tabbing the footer should not land
                        on something that does nothing. The visible text is
                        the platform name alone, kept dim; the screen-reader
                        name carries "coming soon" so the state is not
                        conveyed by colour only (WCAG 1.4.1).

                        It used to be `text-gray-600` to look visibly inert,
                        which on this dark footer measured **2.35:1** - the
                        worst contrast on the page, against AA's 4.5:1.
                        Dimming below the legibility floor is not a way to
                        signal state, and the signals that matter are listed
                        above: no `href`, not focusable, an sr-only "coming
                        soon". So `text-gray-400` (6.83:1) costs nothing
                        semantically. A placeholder nobody can read is not a
                        placeholder. See docs/99.
                      */
                      <li key={link.name}>
                        <span className="inline-block py-0.5 text-sm text-gray-400">
                          <span aria-hidden="true">{link.name}</span>
                          <span className="sr-only">{link.name} - coming soon</span>
                        </span>
                      </li>
                    ) : (
                      <li key={link.name}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="me noopener noreferrer"
                          className="inline-block py-0.5 text-sm text-gray-400 transition-colors hover:text-white"
                        >
                          {link.name}
                        </a>
                      </li>
                    ),
                  )}
                </ul>
              </nav>
            )}

            {/* Trust badges. `gray-400` for the contrast reason above. */}
            <div className="mt-4 flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1.5">
                {/*
                  Was a hand-rolled inline SVG element with its own viewBox and
                  strokeWidth={2}, one of seventeen such in `src/`. It now
                  comes through the icon layer, so it carries the brand
                  stroke and the shared size scale like everything else.
                  See docs/70.
                */}
                <CreditCardIcon size="sm" />
                Card details never reach us
              </span>
              {/*
                "SSL Protected" was removed: every site has been HTTPS for
                years, so it signals nothing and spends a line saying so.

                ⛔ "Secured by Stripe" was removed 2026-10-26, `docs/116` §5.
                Who holds the card details IS a real question a donor has, so
                the line stays - but it now names the property instead of a
                vendor. Stripe cannot take a payment on this platform
                (`docs/72`) and every donation ever collected came over
                M-Pesa (`docs/92`), so a Stripe badge on every page of the
                site was a security claim about a company not in the request
                path.

                What replaced it is traced, not assumed: the card rail uses
                `ui_mode: 'embedded'` Stripe Checkout
                (`create-checkout/route.ts:239`), whose fields are in the
                processor's own iframe, and the M-Pesa rail takes a phone
                number and an STK push - the PIN is entered on the handset.
                Neither puts a card number on our servers.
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
          {/* `gray-400` for the contrast reason above. */}
          <p className="text-xs text-gray-400">
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
