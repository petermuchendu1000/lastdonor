/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { organiserCampaignPath, publicCampaignPath } from './campaign-links';
import { PUBLICLY_VIEWABLE_STATUSES } from './campaign-visibility';

/*
  Every status the database can hold, read from the enum in schema.ts rather
  than retyped, so a new campaign status cannot slip past this file.
*/
const ALL_CAMPAIGN_STATUSES = [
  'draft',
  'active',
  'last_donor_zone',
  'completed',
  'archived',
  'paused',
  'under_review',
  'suspended',
  'cancelled',
] as const;

describe('publicCampaignPath', () => {
  it('⛔ refuses `archived` - the reported symptom', () => {
    /*
      `notifyCampaignStatusChange` produced a `campaign_archived` notification
      and linked `/campaigns/<slug>`, which the page does not serve.
      [VERIFIED live 2026-10-27] `GET /campaigns/zz-payments-test-mpesa-gateway`
      (a real archived row) -> 404, while an active slug -> 200.
    */
    expect(publicCampaignPath({ slug: 'help-ada', status: 'archived' })).toBeNull();
  });

  it('refuses the statuses that have no public page', () => {
    // The complement of PUBLICLY_VIEWABLE_STATUSES, derived not retyped.
    const notPublic = ALL_CAMPAIGN_STATUSES.filter(
      (s) => !(PUBLICLY_VIEWABLE_STATUSES as readonly string[]).includes(s),
    );
    // If this is ever empty the test below proves nothing.
    expect(notPublic.length).toBeGreaterThan(0);
    for (const status of notPublic) {
      expect(publicCampaignPath({ slug: 'help-ada', status }), status).toBeNull();
    }
  });

  it('returns the path for every status the page DOES serve', () => {
    // The control. Without this, returning null always would pass above.
    for (const status of PUBLICLY_VIEWABLE_STATUSES) {
      expect(publicCampaignPath({ slug: 'help-ada', status }), status).toBe(
        '/campaigns/help-ada',
      );
    }
  });

  it('covers every status in the enum, one way or the other', () => {
    // Guards against a status being added and silently landing in neither set.
    for (const status of ALL_CAMPAIGN_STATUSES) {
      const got = publicCampaignPath({ slug: 'help-ada', status });
      const isPublic = (PUBLICLY_VIEWABLE_STATUSES as readonly string[]).includes(status);
      expect(got, status).toBe(isPublic ? '/campaigns/help-ada' : null);
    }
  });

  it('refuses an unknown status rather than guessing', () => {
    expect(publicCampaignPath({ slug: 'help-ada', status: 'what-is-this' })).toBeNull();
    expect(publicCampaignPath({ slug: 'help-ada', status: null })).toBeNull();
    expect(publicCampaignPath({ slug: 'help-ada', status: undefined })).toBeNull();
  });

  it('⚠️ refuses an empty slug, which produced `/campaigns/` and a silent 308', () => {
    /*
      Two admin call sites pass `campaignSlug: full?.slug ?? ''`. The old code
      built `/campaigns/` from that, which is not a 404 - it redirects to the
      whole listing, so a donor told their campaign had concluded landed on a
      browse page with no explanation.
    */
    expect(publicCampaignPath({ slug: '', status: 'active' })).toBeNull();
    expect(publicCampaignPath({ slug: null, status: 'active' })).toBeNull();
    expect(publicCampaignPath({ slug: undefined, status: 'active' })).toBeNull();
  });
});

describe('organiserCampaignPath', () => {
  const ID = '284b06ff-4475-4cc9-97bf-efa67ac3f9aa';

  it('keys on the id, never a slug', () => {
    expect(organiserCampaignPath(ID)).toBe(`/dashboard/campaigns/${ID}`);
  });

  it.each([
    'updates',
    'edit',
    'donors',
    'verification',
    'impact-update',
    'payout-destination',
  ] as const)('builds the %s screen', (screen) => {
    expect(organiserCampaignPath(ID, screen)).toBe(
      `/dashboard/campaigns/${ID}/${screen}`,
    );
  });

  it('⛔ the id form is the one that works on all seven screens', () => {
    /*
      `[id]/page.tsx:33`, `[id]/updates:19`, `[id]/donors:30` and `[id]/edit:19`
      are `if (!UUID_RE.test(id)) notFound()`. The other three accept either.
      So a slug works on three screens and 404s on four, which is precisely
      why some hand-built links worked and others did not.
    */
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const screen of [undefined, 'updates', 'edit', 'donors'] as const) {
      const segment = organiserCampaignPath(ID, screen).split('/')[3];
      expect(uuid.test(segment), screen ?? '(none)').toBe(true);
    }
  });
});
