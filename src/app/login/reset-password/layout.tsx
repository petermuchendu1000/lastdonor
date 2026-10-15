import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset Password | Last Donor',
  description:
    'Create a new password for your Last Donor account. Choose something strong and get back to supporting the causes you care about.',
  openGraph: {
    title: 'Reset Password | Last Donor',
    description:
      'Create a new password for your Last Donor account. Choose something strong and get back to supporting the causes you care about.',
  },
  // This URL carries a live reset token in its query string. It was the only
  // auth layout without a noindex directive (compare `login/layout.tsx`), so a
  // crawler that reached a reset link — from a referrer header, a pasted link
  // or a shared inbox — could get the page, and the credential with it, into an
  // index.
  robots: { index: false, follow: false },
};

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
