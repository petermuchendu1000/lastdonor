import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { campaigns, documentScreenings, verificationDocuments } from '@/db/schema';
import { ListCount } from '@/components/admin/ListCount';
import { CheckIcon, WarningIcon } from '@/components/ui/icon';

/*
  NO `revalidate` EXPORT, and no `dynamic` either.

  `src/app/admin/layout.tsx` sets `force-dynamic`, which applies to every
  segment beneath it and pins `revalidate` to 0 - so a page-level directive
  here could not take effect and would read as a promise that does nothing.
  docs/88 F14 removed sixteen of those from this tree; do not add a
  seventeenth.
*/

/**
 * What the machine made of uploaded verification documents.
 *
 * A SEPARATE SCREEN FROM /admin/verification ON PURPOSE. That page answers
 * "which campaigns are waiting on a decision"; this one answers "what did the
 * reader make of the files, and which ones does a person still need to open".
 * Folding the second question into the first would also have meant touching
 * the queue that is the only working path to approving an identity (docs/83).
 */

/** docs/88 F8: cap the fetch, and take the tiles from the database, not from JS. */
const ROW_CAP = 200;

const FLAG_COPY: Record<string, string> = {
  extraction_failed: 'could not be read',
  type_not_screenable: 'always reviewed by a person',
  no_trusted_name: 'no verified name on file',
  no_name_on_document: 'no name read from the document',
  name_mismatch: 'name does not match',
  name_close_not_exact: 'name close but not exact',
  no_issuer_found: 'no issuer read',
  no_amount_found: 'no amount read',
  model_not_approved: 'read by a model that cannot approve',
  low_text_yield: 'hardly any text read',
  pages_not_read: 'only page 1 was read',
};

interface ExtractedShape {
  issuer?: string | null;
  personName?: string | null;
  totalAmountText?: string | null;
  currency?: string | null;
  reference?: string | null;
  textLength?: number | null;
}

export default async function AdminScreeningPage() {
  /*
    Two queries, run one after the other. No request on this machine may issue
    more than three CONCURRENT database queries (docs/87 amendment 5, after
    seven pool wedges in a day), and the admin layout's `auth()` already holds
    one of the five.
  */
  const [tiles] = await db
    .select({
      total: sql<number>`count(*)::int`,
      autoApproved: sql<number>`count(*) FILTER (WHERE ${documentScreenings.action} = 'auto_approve')::int`,
      needsHuman: sql<number>`count(*) FILTER (WHERE ${documentScreenings.action} = 'needs_human')::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${documentScreenings.error} IS NOT NULL)::int`,
    })
    .from(documentScreenings);

  const rows = await db
    .select({
      id: documentScreenings.id,
      documentId: documentScreenings.documentId,
      campaignId: documentScreenings.campaignId,
      action: documentScreenings.action,
      flags: documentScreenings.flags,
      summary: documentScreenings.summary,
      nameMatchKind: documentScreenings.nameMatchKind,
      nameMatchScore: documentScreenings.nameMatchScore,
      extracted: documentScreenings.extracted,
      modelUsed: documentScreenings.modelUsed,
      latencyMs: documentScreenings.latencyMs,
      pageCount: documentScreenings.pageCount,
      hasMorePages: documentScreenings.hasMorePages,
      error: documentScreenings.error,
      createdAt: documentScreenings.createdAt,
      documentType: verificationDocuments.documentType,
      fileName: verificationDocuments.fileName,
      documentStatus: verificationDocuments.status,
      reviewerId: verificationDocuments.reviewerId,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      trustedName: campaigns.diditVerifiedName,
    })
    .from(documentScreenings)
    .innerJoin(verificationDocuments, eq(verificationDocuments.id, documentScreenings.documentId))
    .innerJoin(campaigns, eq(campaigns.id, documentScreenings.campaignId))
    .orderBy(desc(documentScreenings.createdAt))
    .limit(ROW_CAP);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Document screening</h1>
        <p className="text-sm text-muted-foreground">
          What the reader made of uploaded documents. A document is approved automatically
          only when nothing was flagged; everything else waits for you.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Screened', value: tiles?.total ?? 0 },
          { label: 'Approved automatically', value: tiles?.autoApproved ?? 0 },
          { label: 'Waiting for a person', value: tiles?.needsHuman ?? 0 },
          { label: 'Could not be read', value: tiles?.failed ?? 0 },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{t.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm font-medium">Nothing has been screened yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Documents are read within five minutes of being uploaded. No verification
            document has been uploaded to this platform yet, so there is nothing here.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {rows.map((r) => {
              const flags = Array.isArray(r.flags) ? (r.flags as string[]) : [];
              const ex = (r.extracted ?? null) as ExtractedShape | null;
              const auto = r.action === 'auto_approve';
              const machineApproved = r.documentStatus === 'approved' && r.reviewerId === null;

              return (
                <section key={r.id} className="overflow-hidden rounded-lg border bg-card">
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/campaigns/${r.campaignSlug}`}
                        className="truncate font-medium hover:underline"
                      >
                        {r.campaignTitle}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.fileName} &middot; {r.documentType.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {auto ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                          <CheckIcon size="xs" />
                          Approved automatically
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                          <WarningIcon size="xs" />
                          Needs a person
                        </span>
                      )}
                    </div>
                  </header>

                  <div className="grid gap-4 p-4 md:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Read from the document
                      </h3>
                      {r.error ? (
                        <p className="text-sm text-destructive">
                          Could not be read.
                          <span className="mt-1 block text-xs text-muted-foreground">{r.error}</span>
                        </p>
                      ) : (
                        <dl className="space-y-1 text-sm">
                          <Field label="Issuer" value={ex?.issuer} />
                          <Field label="Name on document" value={ex?.personName} strong />
                          {/*
                            The amount is shown as the TEXT that was read, not
                            through `Money`. `Money` renders a platform figure
                            in minor units (docs/92); this is a string a model
                            read off a photograph, and formatting it like a
                            ledger entry would dress a guess up as an amount
                            the platform holds.
                          */}
                          <Field
                            label="Amount (as read)"
                            value={ex?.totalAmountText ? `${ex.totalAmountText}${ex.currency ? ` ${ex.currency}` : ''}` : null}
                          />
                          <Field label="Reference" value={ex?.reference} />
                        </dl>
                      )}
                    </div>

                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Name check
                      </h3>
                      <dl className="space-y-1 text-sm">
                        <Field label="Verified name on file" value={r.trustedName} />
                        <Field
                          label="Result"
                          value={`${r.nameMatchKind.replace(/_/g, ' ')} (${r.nameMatchScore}%)`}
                        />
                      </dl>

                      {flags.length > 0 && (
                        <div className="mt-3">
                          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Why it needs you
                          </h3>
                          <ul className="flex flex-wrap gap-1.5">
                            {flags.map((f) => (
                              <li
                                key={f}
                                className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                              >
                                {FLAG_COPY[f] ?? f}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="border-t bg-sky-50/60 px-4 py-2.5 text-sm dark:bg-sky-950/30">
                    {r.summary}
                  </p>

                  <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
                    <span>{r.createdAt.toISOString().replace('T', ' ').slice(0, 16)} UTC</span>
                    {r.modelUsed && <span>read by {r.modelUsed}</span>}
                    {r.latencyMs !== null && <span>{(r.latencyMs / 1000).toFixed(1)}s</span>}
                    {r.pageCount !== null && (
                      <span>
                        {r.pageCount} page{r.pageCount === 1 ? '' : 's'}
                        {r.hasMorePages && ' - only page 1 was read'}
                      </span>
                    )}
                    {machineApproved && <span>no person has opened this file</span>}
                  </footer>
                </section>
              );
            })}
          </div>

          <div className="mt-4">
            {/*
              docs/88 F16: every capped list on this screen states the page
              range, what was actually loaded, and the true total - because
              eight admin lists used to claim two different totals at once.
            */}
            <ListCount
              from={1}
              to={rows.length}
              shown={rows.length}
              loaded={rows.length}
              total={tiles?.total ?? rows.length}
              noun="screenings"
            />
          </div>
        </>
      )}
    </>
  );
}

function Field({ label, value, strong }: { label: string; value?: string | null; strong?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-words ${strong ? 'font-semibold' : ''}`}>
        {value ?? <span className="text-muted-foreground">not read</span>}
      </dd>
    </div>
  );
}
