## OWNER REVIEW (HEL-1530) -- this PR is PARKED unmerged, awaiting owner review

### What gets deleted, and from when

From the moment V132 is applied in prod (the first backend boot of the revision that contains it), the app deletes the
stored object (local file / GCS object) behind:

1. a `dataset_rows` row holding a `form-uploads/<uuid>.<ext>` binary-ref, when that row is DELETED (row delete, a
   full-set replace, deleting the dataset source, the `users` cascade) or UPDATED so that it no longer holds that key;
2. an `assistant_conversations` row's transcript object (`gcs_body_ref`), when the row is deleted by any path (there is
   no route today; the trigger covers raw SQL and future routes);
3. any of those, plus `image_uploads` and file-backed `data_sources` keys, when the owning table is TRUNCATEd (directly
   or by `TRUNCATE ... CASCADE`);
4. the `form-uploads/` objects of a form submit whose append FUTURE failed: queued behind a 15-minute grace window,
   deleted only if no committed row references the key then. (The refused-append `Left` path already removed its files
   immediately, unchanged.)

Before any object is removed the drain checks every table that can hold the key (`image_uploads`, file-backed
`data_sources`, `dataset_rows`, `assistant_conversations`, `binary_refs`, `node_snapshots`, `node_payload_history`,
`alert_events`). A key still held by an authoritative row is dequeued without deleting (that row's own delete re-queues
it); a key held only by a derived copy (snapshot / history / alert payload / `binary_refs` / a dataset row naming it
outside what its delete would queue) stays queued, re-checked hourly, and is deleted once the copy is gone.

**Historic orphans are NOT touched.** V132 has no backfill and enqueues nothing for rows that exist when it runs; only
rows deleted, updated away or truncated AFTER V132 is applied are queued. Cleaning what is already orphaned in storage
(dev measured 48 `assistant-conversations/` and 5 `form-uploads/` objects, unclassified) is the owner's HEL-1529.

### Deploy notes

- Rolling deploy: every queue row V132 writes (and every deferred row) has `claimed_at = 'infinity'`, so an older
  revision's V128 claim SQL can never match it; the older revision's two-table guard therefore never sees, and can
  never wrongly delete, one of these keys. Proven by running V128's claim SQL verbatim against each kind of new row
  (`FormAndConversationObjectDrainSpec`, "V128's own claim SQL (3.2a)").
- Rollback: deploying the previous revision leaves V132's triggers in place (a migration cannot be un-applied by the
  app). They keep queueing new-style rows that nothing drains, so the queue grows and NOTHING is deleted. Roll forward,
  or drop the triggers by hand.
- The drain cost: a pass with at least one unreferenced key sweeps the derived tables once for its whole batch
  (measured 2.4 s on the dev DB's 1.6 M `node_snapshots` rows, see `measurements.md`). It runs on the existing
  scheduler tick, at most one pass in flight per process.
- **Flyway merge-order hazard (V131 / V132).** #994 holds V131 and is unmerged. If V132 is applied to a database before
  V131, Flyway then refuses to start with "Detected resolved migration not applied to database: 131" (reproduced by the
  skeptic). Either #994 deploys first, or whichever of the two PRs merges second renumbers its migration above the other.
  This applies to the shared dev DB as well as prod.
- V132 is the migration number on the basis of `gh pr list` at the time of writing (#994 holds V131; no other open PR
  adds a migration). Re-check before merging.
- Flyway runs V132 as the NOSUPERUSER NOBYPASSRLS `helio` role; the new functions are re-owned to `helio_privileged`
  with V128's bracket. Proven by `FormAndConversationObjectDeletionsMigrationSpec` (a delete as an RLS-bound user and as
  an unset-context cascade both commit and queue).

### Read-only prod queries to run BEFORE release (nothing here writes)

**Run them as a BYPASSRLS role.** `stored_object_deletions`, `dataset_rows`, `assistant_conversations`,
`node_snapshots`, `node_payload_history`, `binary_refs` and `alert_events` are all FORCE ROW LEVEL SECURITY, and prod's
`helio` role is NOSUPERUSER NOBYPASSRLS. As `helio` the queue backlog always reads empty, and every other count covers
only rows visible to the current user context (0 with the GUC unset; `assistant_conversations`' policy may even error).
Run as `helio` with `SET ROLE helio_privileged` inside a read-only transaction. If `SET ROLE` is refused, or query 0 does
not show `rolbypassrls = true`, do not trust any count below. Only if you connect as a role that already shows
`rolbypassrls = true` in query 0 may you omit `SET ROLE`:

```sql
BEGIN READ ONLY;
SET ROLE helio_privileged;

-- 0. sanity: must report helio_privileged | true. If rolbypassrls is false, a 0 from ANY count below means RLS hid the
--    rows, not that the table is empty -- stop and fix the role before trusting any number.
SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;

-- 1. form-upload keys referenced from dataset_rows -- exactly the keys the V132 trigger will own (same regex)
SELECT count(*) AS rows_with_form_key, count(DISTINCT v #>> '{}') AS distinct_form_keys
FROM dataset_rows r
CROSS JOIN LATERAL jsonb_path_query(r.data, 'lax $.**.storageKey') v
WHERE strpos(r.data::text, 'form-uploads/') > 0 AND jsonb_typeof(v) = 'string'
  AND (v #>> '{}') ~ '^form-uploads/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,16}$';

-- 2. conversations (each one's transcript is deleted when its row is)
SELECT count(*) FROM assistant_conversations;

-- 3. current queue backlog by origin and attempts (V128 rows are source_table image_uploads / data_sources)
SELECT source_table, attempts, count(*) FROM stored_object_deletions GROUP BY 1, 2 ORDER BY 1, 2;

-- 4. guard-scan sizing: the derived tables the drain sweeps once per non-empty pass
SELECT 'node_snapshots' t, count(*) n, pg_size_pretty(pg_total_relation_size('node_snapshots')) sz FROM node_snapshots
UNION ALL SELECT 'node_payload_history', count(*), pg_size_pretty(pg_total_relation_size('node_payload_history')) FROM node_payload_history
UNION ALL SELECT 'binary_refs', count(*), pg_size_pretty(pg_total_relation_size('binary_refs')) FROM binary_refs
UNION ALL SELECT 'alert_events', count(*), pg_size_pretty(pg_total_relation_size('alert_events')) FROM alert_events
UNION ALL SELECT 'dataset_rows', count(*), pg_size_pretty(pg_total_relation_size('dataset_rows')) FROM dataset_rows;

-- 5. legacy binary_refs rows with no pipeline (a key held only there would stay deferred for good: a leak, not a wrong
--    delete). V98 should have removed these; expect 0.
SELECT count(*) FROM binary_refs WHERE pipeline_id IS NULL;

ROLLBACK;
```

Measured on dev (not prod): `node_snapshots` 1.64 M rows / 1.59 GB makes the derived sweep 2.4 s. If prod's
`node_snapshots` is an order of magnitude larger, say so and the sweep gets rate-limited in a follow-up.

### Known gaps and non-goals

- Derived-scan cost on prod: measured 2.4 s on the dev desktop. On a Cloud SQL instance about 5x slower, expect about
  10 s or more per pass that has at least one unreferenced key, holding one privileged-pool connection for that time. Use
  query 4 to size it before release.
- Check-then-delete race: between the guard's check and the storage delete, a write-back could re-add a just-removed form
  key to a dataset row; the object would then be deleted while a row references it. The window is the length of one
  batch's processing. Not prevented here.

- Historic orphans (HEL-1529) and a user-facing conversation delete route / account deletion (HEL-1301) are out of scope.
- A key still held by a derived copy is re-checked hourly for as long as retention keeps the copy (owner tier history is
  365 days): one batched check per hour, never counted as a failure.
- A user who copies another user's form-upload key into their own dataset row keeps that object alive while either row
  exists (a leak, never a wrong delete). Read authorization of blobs is unchanged.
- A pipeline snapshot written between the guard check and the delete can end up pointing at a deleted object; it is
  derived and the next run replaces it.
- `row_security = off` on the new functions is part of the V128 shape, but no behaviour test can fail without it
  (the definer is BYPASSRLS), so only the catalogue-pinning test covers it.
