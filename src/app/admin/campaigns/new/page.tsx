import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { CampaignEditor } from '@/components/admin/CampaignEditor';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'New Campaign - Admin - LastDonor.org',
  robots: { index: false },
};

/*
  Admin-only, and the whole page is the control: the form it renders submits
  `POST /api/v1/campaigns`, which is `requireRole(['admin'])`, so for an
  editor this screen could only ever 403 on save. `src/app/admin/layout.tsx:30`
  admits `editor`, so the gate has to be here. `docs/133`.
*/
export default async function NewCampaignPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin/campaigns');
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Create Campaign</h1>
      <p className="mt-1 text-sm text-muted-foreground">Fill in the details to launch a new campaign.</p>
      <div className="mt-6">
        <CampaignEditor mode="create" />
      </div>
    </div>
  );
}
