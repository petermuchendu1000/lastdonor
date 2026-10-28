/*
  ─────────────────────────────────────────────────────────────────────────
  SHARED LABELS, IN A MODULE WITH NO `'use client'`.                docs/139
  ─────────────────────────────────────────────────────────────────────────

  ⛔ These lived in `ImpactUpdateQueue.tsx`, which is `'use client'`, and the
  server page imported them from there. It TYPECHECKED and it rendered
  BLANK: a server component importing a plain value out of a client module
  gets a client-reference proxy, not the object, so `STATUS_LABEL.submitted`
  was `undefined`.

  ⚠️ Nothing in the toolchain says so. `tsc` sees a valid
  `Record<string, string>`, the build succeeds, no console error appears, and
  the tile simply renders with no label. It was found by LOOKING at a
  screenshot - the probe's own regex had reported "NONE" and I had already
  dismissed that once as a probe artifact, which it was the first time
  (`docs/119` §9.1, `docs/121`).

  The controlled comparison that settled it: the SAME constant rendered
  correctly inside the client component (the row badge read "Published")
  and blank in the server page, in the same response.

  So: a constant shared across the server/client boundary belongs in a plain
  module that neither side owns.
*/

/** Plain words for the impact-update states, in the `docs/110` spirit. */
export const IMPACT_UPDATE_STATUS_LABEL: Record<string, string> = {
  pending: 'Not sent yet',
  submitted: 'Waiting for a review',
  approved: 'Published',
  rejected: 'Change asked for',
};

export const IMPACT_UPDATE_STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  submitted: 'default',
  approved: 'secondary',
  rejected: 'destructive',
  pending: 'outline',
};
