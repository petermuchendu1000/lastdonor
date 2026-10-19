import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { NewsletterForm } from './form';
import { seoKeywords } from '@/lib/seo/keywords';

export const metadata: Metadata = {
  title: 'Newsletter',
  description:
    'New campaigns, stories of what your money paid for, and ways to help.',
  keywords: seoKeywords('campaigns', 'trust', 'donor', 'medical', 'emergency'),
  alternates: { canonical: 'https://lastdonor.org/newsletter' },
  openGraph: {
    title: 'Newsletter | LastDonor.org',
    description:
      'Updates on reviewed campaigns, impact stories, and ways to help.',
    images: [
      {
        url: '/api/v1/og/page?title=Newsletter&subtitle=Updates+on+reviewed+campaigns+and+impact+stories.',
        width: 1200,
        height: 630,
        alt: 'LastDonor.org Newsletter',
      },
    ],
  },
};

/*
 * Design rationale:
 *
 * This is a conversion page. The sole goal is: visitor enters email.
 * Every element either builds motivation or removes friction.
 *
 * Visual hierarchy (Z-pattern, top to bottom):
 *   1. Headline = value ("what you get")
 *   2. Subhead = specificity ("every Thursday")
 *   3. Form = action (single field, dominant CTA)
 *   4. Inline trust = objection handling (no spam, one-click unsub)
 *   5. "What's inside" = curiosity gap (sample content preview)
 *   6. Bottom quote = social proof (real donor voice)
 *
 * Psychology:
 *   - "See where your money goes" > "Stay in the loop": specific > vague.
 *   - "Every Thursday" anchors frequency expectation, reducing "how often?" anxiety.
 *   - The sample newsletter structure answers "what will I actually receive?" before asking.
 *   - A single real testimonial at the bottom is more persuasive than 3 abstract icons.
 *   - Trust promises are inline with the form, not buried at the bottom.
 *
 * Accessibility:
 *   - All interactive elements are keyboard-accessible (native form elements).
 *   - Semantic heading hierarchy: h1 > h2 > h3.
 *   - Color contrast: all text passes WCAG AA on both light/dark backgrounds.
 *   - Icons are aria-hidden; text carries meaning alone.
 */

export default function NewsletterPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
      <Breadcrumbs />

      {/* ── Hero: value proposition ── */}
      <div className="mt-8 text-center">
        <h1 className="font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          See Where Your Money Goes
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
          One email every Thursday with reviewed campaigns, real impact
          updates, and stories from the people you helped.
        </p>
      </div>

      {/* ── Signup form ── */}
      <div className="mt-10 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <NewsletterForm />
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon />
            Only when there is something to say
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon />
            No spam or data selling
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon />
            One-click unsubscribe
          </span>
        </div>
      </div>

      {/* ── What's inside: sample content preview ── */}
      <div className="mt-14">
        <h2 className="text-center font-display text-xl font-bold text-foreground sm:text-2xl">
          What&apos;s inside each email
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-center text-sm text-muted-foreground">
          Three sections, ~2 minutes to read. Here&apos;s what to expect:
        </p>

        <ol className="mt-8 space-y-6">
          {SECTIONS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-sm font-bold text-primary">
                {i + 1}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">
                  {s.title}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {s.weight}
                  </span>
                </h3>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                  {s.example}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Social proof ── */}
      <figure className="mt-14 rounded-xl border border-border bg-muted/30 p-6">
        <blockquote className="text-sm leading-relaxed text-foreground">
          &ldquo;I donated $50 and got an update with receipts showing exactly
          how it was used. I have never experienced that from any other
          platform.&rdquo;
        </blockquote>
        <figcaption className="mt-3 text-xs text-muted-foreground">
          Linda R., donor from Ohio
        </figcaption>
      </figure>
    </div>
  );
}

/* ── Static data ── */

const SECTIONS = [
  {
    title: 'Featured campaign',
    weight: '~50%',
    example:
      'A photo, a 3-sentence story, a live progress bar, and a link to donate. One reviewed campaign.',
  },
  {
    title: 'Impact update',
    weight: '~30%',
    example:
      '"47 donors raised $3,200 for Maria\'s family." Real numbers, real names, proof of where the money went.',
  },
  {
    title: 'One thing to know',
    weight: '~20%',
    example:
      'A short fact, a behind-the-scenes note, or a link to a blog post. Context on why this work matters.',
  },
] as const;

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className="h-3.5 w-3.5 shrink-0 text-brand-teal"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M12.416 3.376a.75.75 0 01.208 1.04l-5 7.5a.75.75 0 01-1.154.114l-3-3a.75.75 0 011.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 011.04-.207z"
        clipRule="evenodd"
      />
    </svg>
  );
}
