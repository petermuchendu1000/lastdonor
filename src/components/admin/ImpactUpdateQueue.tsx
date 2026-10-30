'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListCount } from '@/components/admin/ListCount';
import { publicCampaignPath, organiserCampaignPath } from '@/lib/campaign-links';
import {
  IMPACT_UPDATE_STATUS_LABEL as STATUS_LABEL,
  IMPACT_UPDATE_STATUS_VARIANT as STATUS_VARIANT,
} from '@/lib/impact-update-labels';

/** This project's `Button` has no `asChild`, so a link styled as one is spelled out. */
const LINK_BUTTON =
  'inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-100 hover:bg-muted/60';

/*
  ─────────────────────────────────────────────────────────────────────────
  THE DOOR THAT WAS MISSING.                                      docs/139
  ─────────────────────────────────────────────────────────────────────────

  `GET /api/v1/admin/impact-updates` and
  `PATCH /api/v1/admin/impact-updates/[id]/review` both existed, both
  correct, both gated `requireRole(['admin'])` - and had **zero callers**.
  No admin screen listed the queue and no button called the review route, so
  an organiser's report on how a family's money was spent could be submitted
  and never seen. [VERIFIED by executing the codebase's own route oracle:
  `isNavigablePath('/admin/impact-updates')` returned false, against
  `/admin/campaigns` and `/admin/settings` as positive controls.]

  Same shape as `docs/88` F1 - *"the API was always correct, only the door
  was missing"* - which is the precedent for building the door rather than
  calling it a feature.

  ⚠️ Cards, not a table. `docs/128` §5 found four admin tables overflowing at
  390px with the root cause still [UNKNOWN] and `overflow-x-auto` already
  present on all of them; a new table would be a fifth instance of a defect
  nobody has explained.

  ⚠️ AMENDED 2026-10-30: that root cause is now KNOWN and fixed (`docs/154`) -
  a `.sr-only` "Actions" header is `position: absolute`, and the scroll wrapper
  was not a containing block, so the 1x1 span escaped the clip and extended
  `html`'s scroll area. Every scroller is `relative` now, with a ratchet. So
  the reason above no longer argues against a table here. Cards remain the
  shape chosen, but if anyone converts this to a table, the hazard it was
  avoiding is gone.
*/

export type ImpactUpdateRow = {
  id: string;
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  campaignStatus: string;
  campaignPublishedAt: string | null;
  title: string | null;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
};


/*
  ⛔ The zone is a PROP, not read here.

  Every other admin component renders a timestamp with
  `new Date(x).toLocaleDateString('en-GB', …)` - which pins the locale and
  NOT the timezone, so the server's render and the browser's can disagree and
  React reports a hydration mismatch (`docs/107` §8.1, where the same class
  threw #418 on every mobile load). Formatting against an explicit zone makes
  both renders identical.

  And it cannot be read from `REPORTING_TIMEZONE` in here: that reads
  `process.env.REPORTING_TIMEZONE`, which is `undefined` in a client bundle
  and falls back to 'UTC' - so a configured zone would make the server say one
  thing and the browser another. Reading it inside the component would BE the
  defect. `docs/88` F15 also requires the screen to name the zone, which it
  does below. `docs/139`.
*/
function stamp(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ImpactUpdateQueue({
  rows,
  total,
  loaded,
  timeZone,
  timeZoneLabel,
}: {
  rows: ImpactUpdateRow[];
  total: number;
  loaded: number;
  timeZone: string;
  timeZoneLabel: string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  async function review(id: string, action: 'approve' | 'reject') {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/admin/impact-updates/${id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes: notes[id] ?? undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        /*
          ⛔ The route's own message is rendered verbatim. It explains the
          two refusals a reviewer will actually meet - a reject with no
          reason, and a row somebody else already decided (409) - and
          inventing a friendlier sentence here would hide which one it was.
          `docs/129` made the same call on the batch retry.
        */
        setError(json?.error?.message ?? 'The review could not be saved.');
        return;
      }
      setDone((d) => ({ ...d, [id]: action === 'approve' ? 'approved' : 'rejected' }));
    } catch {
      setError('The review could not be saved. Check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center">
        <p className="font-medium">No impact updates yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          An organiser sends one of these to show how the money was used. When
          one arrives it waits here for a person to read it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-1">
        <ListCount
          from={1}
          to={rows.length}
          shown={rows.length}
          loaded={loaded}
          total={total}
          noun="impact updates"
        />
        {/* docs/88 F15: a time on screen says which zone it is in. */}
        <p className="text-xs text-muted-foreground">Times are {timeZoneLabel}.</p>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const decided = done[row.id];
          const status = decided ?? row.status;
          const canReview = status === 'submitted';
          const publicPath = publicCampaignPath({
            slug: row.campaignSlug,
            status: row.campaignStatus,
            publishedAt: row.campaignPublishedAt,
          });

          return (
            <div key={row.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.title ?? 'Untitled update'}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {row.campaignTitle}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[status] ?? 'outline'} className="shrink-0">
                  {STATUS_LABEL[status] ?? status}
                </Badge>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {row.submittedAt && <span>Sent {stamp(row.submittedAt, timeZone)}</span>}
                {row.reviewedAt && <span>Read {stamp(row.reviewedAt, timeZone)}</span>}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={organiserCampaignPath(row.campaignId, 'impact-update')} className={LINK_BUTTON}>
                  Read the update
                </Link>
                {/*
                  ⛔ `publicCampaignPath` returns null for a campaign with no
                  public page, and that is every campaign still in review -
                  so this link is omitted rather than pointed at a 404.
                  `docs/118`, and `docs/120` §11.3 found six admin sites that
                  had skipped exactly this guard.
                */}
                {publicPath && (
                  <Link href={publicPath} className={LINK_BUTTON}>
                    View campaign
                  </Link>
                )}
              </div>

              {canReview && (
                <div className="mt-4 border-t pt-3">
                  <label
                    htmlFor={`notes-${row.id}`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    What needs to change? The organiser is sent your words.
                  </label>
                  <textarea
                    id={`notes-${row.id}`}
                    rows={2}
                    value={notes[row.id] ?? ''}
                    onChange={(e) =>
                      setNotes((n) => ({ ...n, [row.id]: e.target.value }))
                    }
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="Needed only when you ask for a change."
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => review(row.id, 'approve')}
                    >
                      Approve and publish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === row.id || (notes[row.id] ?? '').trim().length < 3}
                      onClick={() => review(row.id, 'reject')}
                    >
                      Ask for a change
                    </Button>
                  </div>
                </div>
              )}

              {decided && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Saved. The organiser has been told.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
