import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { AcceptInviteClient } from '@/components/collaborators/AcceptInviteClient';

/**
 * Where an invitation email lands.
 *
 * ⛔ THIS PAGE DOES NOT ACCEPT ANYTHING ON LOAD, and that is the whole design.
 * A GET must not mutate: mail clients, link scanners and anti-virus proxies
 * fetch the URLs in an email before a person ever sees it, so accepting on
 * load would hand the membership to whichever machine opened the message
 * first - or burn the invitation before the invitee clicked. The page shows a
 * button; the button POSTs.
 *
 * ⚠️ No `revalidate` export. This page reads `searchParams`, which makes it
 * dynamic in Next 15, so the directive would be inert -
 * `src/app/revalidate-honesty.ratchet.test.ts` fails the build on the
 * combination (`docs/104` §4).
 *
 * The page exists in the same change as the email that links to it. `docs/109`
 * is the doc about a flow whose redirect pointed at something that could not
 * render; shipping the mail first would have been that defect on purpose.
 */
export const metadata: Metadata = {
  title: 'Accept an invitation | LastDonor',
  // An invitation link is private; keep it out of the index.
  robots: { index: false, follow: false },
};

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const session = await auth();

  if (!token) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-foreground">
          This link is incomplete
        </h1>
        <p className="mt-3 text-muted-foreground">
          Open the link from your email again, or ask the organiser to send a
          new invitation.
        </p>
      </div>
    );
  }

  /*
    Sign-in first, carrying the token through so the person lands back here
    rather than on a dashboard with no idea what happened to their
    invitation. The token is already in a URL that was emailed to them, so
    putting it in the callback adds no exposure it did not have.
  */
  if (!session?.user) {
    const back = `/collaborate/accept?token=${encodeURIComponent(token)}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(back)}`);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <h1 className="font-display text-2xl font-bold text-foreground">
        Help with this fundraiser
      </h1>
      <p className="mt-3 text-muted-foreground">
        You were asked to help run a campaign. If you accept, you will be able
        to write updates for its page and change what it says.
      </p>
      {/*
        Stated on the screen where the decision is made, not only in the
        email. Somebody accepting an invitation to help with a fundraiser will
        reasonably assume it includes the money unless told plainly. See
        `docs/111` §1.
      */}
      <p className="mt-4 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">You will not be able to touch
        the money.</strong>{' '}
        Only the person who started the campaign can ask for a payout or
        change where it goes.
      </p>
      <AcceptInviteClient token={token} />
    </div>
  );
}
