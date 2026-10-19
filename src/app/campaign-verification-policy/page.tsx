import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Campaign Verification Policy',
  description:
    'How we check a campaign before it goes live, what we may ask you to send, and what we do if something is wrong.',
  alternates: { canonical: 'https://lastdonor.org/campaign-verification-policy' },
  openGraph: {
    title: 'Campaign Verification Policy | LastDonor.org',
    description:
      'How we check campaigns, what we may ask you to send, and what we do if something is wrong.',
    images: [
      {
        url: '/api/v1/og/page?title=Verification+Policy&subtitle=How+we+check+a+campaign+before+it+goes+live.',
        width: 1200,
        height: 630,
        alt: 'Campaign Verification Policy at LastDonor.org',
      },
    ],
  },
};

export default function CampaignVerificationPolicyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
        Campaign Verification Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: April 27, 2026
      </p>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        A person on our team reads a campaign before it goes live. We check it
        again before any money is paid out. This lowers the risk for donors. It
        is not a promise that every fact stays true or complete after a
        campaign is published.
      </p>

      <div className="mt-10 space-y-9 text-muted-foreground">
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            What we check before a campaign goes live
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>Why the money is needed, who it is for, and how much is asked for.</li>
            <li>What kind of campaign it is, and where the person is.</li>
            <li>How the organizer knows the person the money is for.</li>
            <li>Whether the story says enough for you to understand the need.</li>
            <li>
              Whether we can back up the claims. We may use documents, public
              sources, photos, or a direct follow-up.
            </li>
            <li>
              Whether the campaign looks like it breaks our rules, the rules of
              the company that handles our payments, or the law.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            What we may ask you to send
          </h2>
          <p className="mt-3 leading-relaxed">
            What we need depends on the campaign. We may ask for things like
            these:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>A medical bill, a cost estimate for treatment, an insurance notice, or a letter from a doctor.</li>
            <li>A repair invoice, a funeral home estimate, a school bill, or another record of the cost.</li>
            <li>
              Your ID. We may ask the person the money is for to confirm that
              they agree. We may ask how the two of you know each other. If you
              are raising money for someone else, we may ask for proof that they
              let you.
            </li>
            <li>Photos, news links, official statements, public records, or someone who can vouch for you.</li>
            <li>Your bank details, checked through Stripe Connect, once a campaign can be paid out.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            What each status means
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li><strong className="text-foreground">Pending:</strong> You have sent us the campaign. Nobody has read it yet.</li>
            <li><strong className="text-foreground">Documents uploaded:</strong> You have sent us files to back up the campaign.</li>
            <li><strong className="text-foreground">Identity verified:</strong> The ID checks we needed are done.</li>
            <li><strong className="text-foreground">Fully verified:</strong> Our checks are done. The money may now become available to take out.</li>
            <li><strong className="text-foreground">Info requested:</strong> We need more from you before we can go on.</li>
            <li><strong className="text-foreground">Rejected or suspended:</strong> The campaign cannot go ahead until the problem is fixed.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            We keep checking after a campaign is live
          </h2>
          <p className="mt-3 leading-relaxed">
            New facts can change what we think. We may pause a campaign, edit
            it, suspend it, or take it down. We may also ask for more documents.
            We may ask the organizer to say what the money paid for. We may
            limit how much can be taken out. We may refund donors where that is
            the right thing to do.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            What we do not allow
          </h2>
          <p className="mt-3 leading-relaxed">
            Campaigns must follow our{' '}
            <Link href="/campaign-rules" className="text-primary underline underline-offset-4">
              Campaign Rules
            </Link>
            . We do not publish a campaign that involves:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>Anything illegal, or claims that mislead people.</li>
            <li>Breaking sanctions rules.</li>
            <li>Goods or services we are not allowed to take money for.</li>
            <li>Hate or harassment.</li>
            <li>Schemes that ask people to invest, or gambling.</li>
            <li>Adult content, controlled drugs, or weapons.</li>
            <li>
              Anything else that is too risky for us, or for the companies that
              handle our payments.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Tell us if something looks wrong
          </h2>
          <p className="mt-3 leading-relaxed">
            If you think a campaign says something untrue, email{' '}
            <a href="mailto:editorial@lastdonor.org" className="text-primary underline underline-offset-4">
              editorial@lastdonor.org
            </a>
            . Give us the campaign name, say what is wrong, and add anything
            that backs it up. We read every report. We may update, pause,
            suspend, or take down the campaign.
          </p>
        </section>
      </div>
    </div>
  );
}
