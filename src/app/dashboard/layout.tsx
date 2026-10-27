import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { hasAnyCampaign } from '@/lib/dashboard/my-campaigns.server';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/dashboard');
  }

  /*
    Created OR helping with - `hasAnyCampaign` shares its predicate with
    `listMyCampaigns`, so the "My campaigns" nav entry cannot disagree with
    what that list contains. This was `where(eq(campaigns.creatorId, ...))`,
    creator-only, which is why a collaborator had no door (`docs/119`).
  */
  const hasCampaigns = await hasAnyCampaign(session.user.id);

  return (
    <DashboardShell hasCampaigns={hasCampaigns}>
      {children}
    </DashboardShell>
  );
}
