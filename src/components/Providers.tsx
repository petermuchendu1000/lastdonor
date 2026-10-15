'use client';

import { SessionBootstrap } from '@/components/SessionBootstrap';
import { TawkProvider } from '@/components/TawkProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionBootstrap>
      {children}
      {/*
       * TawkProvider is a sibling of {children}, not a wrapper.
       * It returns null (zero DOM output) so it adds no layout or
       * rendering cost to the content tree. It must live inside
       * SessionBootstrap because it calls useSession() internally, and
       * specifically inside it rather than beside it: SessionBootstrap
       * re-publishes the session context, and anything mounted outside that
       * inner provider would read the placeholder value the outer
       * next-auth provider is seeded with. See docs/44.
       */}
      <TawkProvider />
    </SessionBootstrap>
  );
}
