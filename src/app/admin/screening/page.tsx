import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { campaigns, documentScreenings, verificationDocuments } from '@/db/schema';
import { ListCount } from '@/components/admin/ListCount';

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
 * ── THE LAYOUT RULE, RECORDED BECAUSE THE FIRST VERSION BROKE IT ────────────
 *
 * A reviewer opens this screen to answer ONE question per row: do I need to
 * look at this file myself? So a row leads with the answer, then with the
 * single fact that produced it, and everything else is subordinate to those.
 *
 * The first version inverted that, and it is worth naming how:
 *
 *   - The campaign title, IDENTICAL on every row, was the largest text on the
 *     page; the filename and verdict were 11px grey. It is now a heading over
 *     its documents and is said once.
 *   - The name mismatch - the whole point of the screen - rendered in the same
 *     weight as "Reference". It is now the line that decides, and the only
 *     emphasised thing in the row.
 *   - Four absent fields printed "not read" four times. Absent fields are now
 *     omitted; absence is reported once, as a reason.
 *   - A raw provider error ran to six lines, including advice about plugging a
 *     model into a coding agent. It is behind a disclosure.
 *   - Every reason was stated twice, as a chip AND as a sentence. Once now.
 *
 * The rule those all come from: say each thing once, in the place where it
 * carries the most meaning, at a weight proportional to how much it matters.
 */

/** docs/88 F8: cap the fetch, and take the tiles from the database, not from JS. */
const ROW_CAP = 200;

/** One line, in the reviewer's words. The flag name is for the log, not for them. */
const FLAG_COPY: Record<string, string> = {
  extraction_failed: 'It could not be read',
  type_not_screenable: 'This kind is always checked by a person',
  no_trusted_name: 'No verified name on file to check against',
  no_name_on_document: 'No name could be read',
  name_mismatch: 'The name does not match',
  name_close_not_exact: 'The name is close but not exact',
  no_issuer_found: 'No issuer could be read',
  no_amount_found: 'No amount could be read',
  model_not_approved: 'Read by a model that cannot approve on its own',
  low_text_yield: 'Hardly any text could be read',
  pages_not_read: 'Only page 1 was read',
};

interface ExtractedShape {
  issuer?: string | null;
  personName?: string | null;
  totalAmountText?: string | null;
  currency?: string | null;
  reference?: string | null;
}

export default async function AdminScreeningPage() {
  /*
    Two queries, one after the other. No request may issue more than three
    CONCURRENT database queries (docs/87, after seven pool wedges in a day),
    and the admin layout's `auth()` already holds one of the five.
  */
  const [tiles] = await db
    .select({
      total: sql<number>`count(*)::int`,
      autoApproved: sql<number>`count(*) FILTER (WHERE ${documentScreenings.action} = 'auto_approve')::int`,
      needsHuman: sql<number>`count(*) FILTER (WHERE ${documentScreenings.action} = 'needs_human')::int`,
    })
    .from(documentScreenings);

  const rows = await db
    .select({
      id: documentScreenings.id,
      documentId: documentScreenings.documentId,
      campaignId: documentScreenings.campaignId,
      action: documentScreenings.action,
      flags: documentScreenings.flags,
      nameMatchKind: documentScreenings.nameMatchKind,
      nameMatchScore: documentScreenings.nameMatchScore,
      extracted: documentScreenings.extracted,
      latencyMs: documentScreenings.latencyMs,
      pageCount: documentScreenings.pageCount,
      hasMorePages: documentScreenings.hasMorePages,
      error: documentScreenings.error,
      createdAt: documentScreenings.createdAt,
      documentType: verificationDocuments.documentType,
      fileName: verificationDocuments.fileName,
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

  // Grouped so a campaign's title is said ONCE, as a heading over its rows.
  const groups = new Map<
    string,
    { title: string; slug: string; trustedName: string | null; rows: typeof rows }
  >();
  for (const r of rows) {
    const g = groups.get(r.campaignId);
    if (g) g.rows.push(r);
    else groups.set(r.campaignId, { title: r.campaignTitle, slug: r.campaignSlug, trustedName: r.trustedName, rows: [r] });
  }

  const waiting = tiles?.needsHuman ?? 0;

  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Document screening</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {waiting === 0
            ? 'Nothing is waiting for you.'
            : `${waiting} ${waiting === 1 ? 'document needs' : 'documents need'} your eyes. The rest were checked automatically.`}
        </p>
      </header>

      {/*
        Three numbers on one line, no boxes. The first version drew four
        bordered cards around four integers, which is more furniture than the
        data needs and competed with the rows beneath it for attention.
      */}
      <dl className="mb-8 flex flex-wrap gap-x-10 gap-y-3 border-b pb-6">
        <Stat label="Screened" value={tiles?.total ?? 0} />
        <Stat label="Approved automatically" value={tiles?.autoApproved ?? 0} />
        <Stat label="Waiting for you" value={waiting} emphasis={waiting > 0} />
      </dl>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-14 text-center">
          <p className="text-sm font-medium">Nothing has been screened yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Documents are read within five minutes of being uploaded. No verification
            document has been uploaded to this platform yet.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-10">
            {[...groups.values()].map((group) => (
              <section key={group.slug}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
                  <h2 className="text-sm font-semibold">
                    <Link href={`/campaigns/${group.slug}`} className="hover:underline">
                      {group.title}
                    </Link>
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {group.trustedName ? (
                      <>
                        Verified name{' '}
                        <span className="font-medium text-foreground">{group.trustedName}</span>
                      </>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-500">
                        No verified name on file
                      </span>
                    )}
                  </p>
                </div>

                <ul className="divide-y">
                  {group.rows.map((r) => {
                    const flags = Array.isArray(r.flags) ? (r.flags as string[]) : [];
                    const ex = (r.extracted ?? null) as ExtractedShape | null;
                    const approved = r.action === 'auto_approve';
                    const reasons = flags.map((f) => FLAG_COPY[f] ?? f);
                    const nameDiffers = ['mismatch', 'near', 'subset'].includes(r.nameMatchKind);

                    const detail = [
                      ex?.issuer,
                      ex?.totalAmountText && `${ex.totalAmountText}${ex.currency ? ` ${ex.currency}` : ''}`,
                      ex?.reference,
                    ]
                      .filter(Boolean)
                      .join(' · ');

                    const meta = [
                      r.createdAt.toISOString().replace('T', ' ').slice(0, 16),
                      r.nameMatchKind !== 'indeterminate' && `name ${r.nameMatchScore}%`,
                      r.latencyMs !== null && `${(r.latencyMs / 1000).toFixed(1)}s`,
                      r.hasMorePages && `page 1 of ${r.pageCount}`,
                      approved && r.reviewerId === null && 'not opened by a person',
                    ]
                      .filter(Boolean)
                      .join(' · ');

                    return (
                      <li key={r.id} className="flex items-start gap-3 py-4">
                        {/*
                          One mark, not a chip with a word in it. Position and
                          colour carry the verdict; the line beside it says what
                          to do. A chip reading "Needs a person" on every amber
                          row is a third copy of something already clear twice.
                          The screen-reader text below carries it for anyone who
                          cannot see the colour.
                        */}
                        <span
                          aria-hidden
                          className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${
                            approved ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-medium">{r.fileName}</span>
                            <span className="text-xs text-muted-foreground">
                              {r.documentType.replace(/_/g, ' ')}
                            </span>
                            <span className="sr-only">
                              {approved ? 'Approved automatically' : 'Needs a person'}
                            </span>
                          </div>

                          {/*
                            THE LINE THAT DECIDES. For a name that differs it is
                            the two names, side by side, and it is the only
                            emphasised thing in the row. Otherwise it is what was
                            read, or the one reason it needs a person.
                          */}
                          {nameDiffers && ex?.personName ? (
                            <p className="mt-1 text-sm">
                              <span className="font-semibold text-amber-800 dark:text-amber-400">
                                {ex.personName}
                              </span>
                              <span className="mx-2 text-muted-foreground">on the document, not</span>
                              <span className="font-semibold">{r.trustedName}</span>
                            </p>
                          ) : !approved && reasons[0] ? (
                            <p className="mt-1 text-sm">{reasons[0]}</p>
                          ) : detail ? (
                            <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
                          ) : null}

                          {/* Only the reasons the line above did not already carry. */}
                          {!approved && reasons.length > 1 && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Also: {reasons.slice(1).map((s) => s.toLowerCase()).join('; ')}
                            </p>
                          )}

                          <p className="mt-1.5 text-xs text-muted-foreground">{meta}</p>

                          {/*
                            The provider's own words, collapsed. The first
                            version printed six lines of model-fallback failure
                            into the card. One reader in twenty wants that; it
                            must not cost the other nineteen a paragraph.

                            `<details>` needs no JavaScript, which matters where
                            the CSP blocks `unsafe-eval` (docs/63, docs/64).
                          */}
                          {r.error && (
                            <details className="mt-1.5">
                              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                                Technical detail
                              </summary>
                              <p className="mt-1 break-words rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                                {r.error}
                              </p>
                            </details>
                          )}
                        </div>

                        <Link
                          href={`/api/v1/admin/verification-documents/${r.documentId}`}
                          className="shrink-0 text-sm font-medium text-primary hover:underline"
                        >
                          Open
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-8 border-t pt-4">
            {/*
              docs/88 F16: state the page range, what was loaded, and the true
              total - eight admin lists used to claim two different totals.
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

function Stat({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 text-2xl font-semibold tabular-nums ${
          emphasis ? 'text-amber-700 dark:text-amber-500' : ''
        }`}
      >
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
