# ⚠️ SUPERSEDED — historical only, not applied

**These 33 files are no longer the migration path.** `drizzle.config.ts` points
at `../migrations-v2`, which holds a single validated baseline. Nothing here is
read by `drizzle-kit migrate`, because the migrator iterates only the
`meta/_journal.json` of the directory `out` names (`drizzle-orm/migrator.js:12`).

Kept for history and for the audit trail in `docs/29` and `docs/34`. **Do not
add migrations here** — add them to `migrations-v2/`.

## Why this directory was abandoned

It contains **two overlapping lineages that cannot be replayed together**:

1. **Journaled (9 entries, `0000`–`0008` codename style).** `0007_smart_tusk.sql`
   is a *late regenerated baseline* that already creates `notification_type`,
   `verification_status`, `withdrawal_status`, `blog_source`,
   `blog_topic_status`, `milestone_status` and 10 further types.
2. **Unjournaled (24 descriptive-name files, `0007_add_notifications` onward).**
   `0015_user_campaigns.sql`, `0018_blog_pipeline.sql` and
   `0019_trust_verification.sql` **re-create those same types**.

Replaying all 33 in filename order fails immediately. Verified 2026-10-14
against the live database: `ERROR 42710: type "notification_type" already
exists`, on a database independently confirmed to hold zero enums — so the
collision is between two migrations, not with pre-existing state.

`0027_oblique_audit_enforcement.sql` carries a second, independent defect: it
adds `CHECK (failed_login_count >= 0)` for a column **no migration in this
directory creates**, so it fails with `42703` and, because Drizzle runs pending
migrations in one transaction, takes its other 10 CHECK constraints, 3 blog
foreign keys and the donation trigger down with it. The baseline has the column
and the check, since `schema.ts:270` declares both.

See `docs/34-MIGRATION-BASELINE-ADR.md`.
