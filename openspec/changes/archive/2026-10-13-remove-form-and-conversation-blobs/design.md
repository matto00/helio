## Context

V128 (`backend/src/main/resources/db/migration/V128__stored_object_deletions.sql`) queues the key of every deleted
`image_uploads` / file-backed `data_sources` row from an AFTER DELETE row trigger. `StoredObjectDeletionService`
drains it on the scheduler tick. `StoredObjectDeletionRepository.isReferenced` checks only those two tables, and a
referenced key is dequeued without being deleted. Facts this design rests on (verified on 67cf9e0e0):

- `form-uploads/<uuid>.<ext>` keys are written only by `PanelFormFileSubmission.storeFormFiles`. The ext comes from
  `FormUploadConfig.extensionOf` (lower-cased, allowlisted). The key appears as `{"storageKey": ...}` inside
  `dataset_rows.data` (JSONB). `dataset_rows.data_source_id` is `ON DELETE CASCADE` (V106), and `data_sources.owner_id`
  cascades from `users` (V119).
- Transcript keys are `assistant-conversations/<userId>/<id>.json` in `assistant_conversations.gcs_body_ref` (V80).
  No route deletes a conversation and `owner_id` is NO ACTION. Today the only deletes are raw SQL, such as the e2e
  user cleanup. The trigger covers every path, including future ones.
- Derived copies of a key can sit in `binary_refs.storage_key`, `node_snapshots.data`, `node_payload_history.rows`
  and, through write-back, in another `dataset_rows.data`.
- Specs use `TRUNCATE ... CASCADE` heavily, so TRUNCATE triggers will also fire in test databases.
- The highest migration on origin/main is V130. Open PR #994 claims V131 and no other open PR adds a migration, so
  this change takes **V132**. Re-check this before pushing.

## Goals / Non-Goals

**Goals:** close the four leaks in ticket.md, keeping V128's security shape exactly. **Non-goals:** historic orphans
(HEL-1529). V132 enqueues nothing for rows that exist when it runs and has no backfill. Also out of scope: read-path
authorization of blobs, and a conversation delete route.

## Decisions

**D1. One migration, V132, additive only.** V128 is never edited. V132 adds nullable `not_before`/`lease_until` columns (D6) to
`stored_object_deletions` and an index on `binary_refs(storage_key)`. It also adds the functions and triggers below.
Every function is `SECURITY DEFINER`, `SET search_path = pg_catalog, public`, `SET row_security = off`, and is
re-owned to `helio_privileged` with V128's bracket (transient `GRANT CREATE ON SCHEMA public`, `ALTER FUNCTION ...
OWNER TO`, `REVOKE`). Every trigger is `ENABLE ALWAYS`. V132 adds the grants the definer needs: SELECT on
`dataset_rows` and `assistant_conversations` (UPDATE on the queue is already granted).

**D2. `dataset_rows`: statement-level AFTER DELETE and AFTER UPDATE triggers with transition tables.**
These use `REFERENCING OLD TABLE` / `NEW TABLE` with one `INSERT ... SELECT` per statement. A per-row trigger was
rejected because deleting a dataset source cascades over every row, and a per-row plpgsql call plus a JSON walk on
each would multiply that cost. Extraction is `jsonb_path_query(data, 'lax $.**.storageKey')`, keeping only values
with `jsonb_typeof = 'string'` that match `^form-uploads/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,16}$`.
Rows are prefiltered with `strpos(data::text, 'form-uploads/') > 0`. `lax` path evaluation cannot raise on any JSONB
value, so the trigger has no EXCEPTION block (an EXCEPTION block would add a subtransaction per call).
- The **regex is a security boundary**. Row JSON is user-writable through the rows API, so without the regex a user
  could queue an arbitrary key, such as another user's transcript. With it, only form-upload keys can be named, and
  the guard (D5) refuses any key a live row holds.
- **UPDATE** queues `keys(OLD row) EXCEPT keys(NEW row with the same id)`.
- **Distinct keys per statement:** use `SELECT DISTINCT`.

**D3. `assistant_conversations`: per-row AFTER DELETE trigger** that queues `NULLIF(OLD.gcs_body_ref, '')`. The
column is server-written, so no regex is needed, but the guard now checks this table too.

**D4. TRUNCATE.** Add a `BEFORE TRUNCATE FOR EACH STATEMENT` trigger on `image_uploads`, `data_sources`,
`dataset_rows` and `assistant_conversations`. Each one queues every key of its table, using the same expressions as
V128 and D2/D3. Postgres fires TRUNCATE triggers for every table a `TRUNCATE ... CASCADE` reaches. A rolled-back
truncate leaves nothing queued.

**D5. Guard: authoritative vs derived references.** `isReferenced` returns `Authoritative`, `DerivedOnly` or `None`.
- **Authoritative** = a row whose own delete re-queues this exact key: `image_uploads.storage_key`, file-backed
  `data_sources` (V128's expression), `assistant_conversations.gcs_body_ref`, or a `dataset_rows` row whose D2
  extraction (`lax $.**.storageKey`, string type, form-upload regex) yields the key. The entry is dequeued without
  deleting, because that row's delete will queue the key again.
- **DerivedOnly** = any other hit: `binary_refs.storage_key`, a quoted substring in `node_snapshots.data`,
  `node_payload_history.rows`, `alert_events.value`, or a `dataset_rows` row that names the key outside D2's
  extraction (an `images/...` or `assistant-conversations/...` key copied by a user or by pipeline write-back, or a
  bare string). The entry stays queued, deferred to `not_before = now + DeferSeconds` (default 3600), and `attempts`
  is NOT bumped. Treating a non-extractable dataset hit as authoritative would leak the object for good: nothing would
  re-queue it when the copying row goes (skeptic design-1, item 1).
- **None** → delete the object, then dequeue.

Substring matching uses `strpos(<json>::text, '"' || key || '"') > 0`. Keys are UUID-unique, so a false positive only
delays a delete. The derived scans are full scans, so the guard evaluates each claimed batch once per table per pass.
The executor measures the cost on the dev DB (row counts plus EXPLAIN ANALYZE) and records it in this change's
`measurements.md`. Known gap: a `binary_refs` row with `pipeline_id IS NULL` (legacy, V98) never goes away, so a key
held only there stays deferred for good. That is a leak, never a wrong delete.

**D6. New-style queue rows are invisible to V128-era code.** V132 adds `not_before TIMESTAMPTZ NULL` and
`lease_until TIMESTAMPTZ NULL`. Every row written by V132's trigger functions, by the app enqueue (D7), or by a
deferral gets `claimed_at = 'infinity'` permanently and a non-null `not_before`. V128's claim
(`claimed_at IS NULL OR claimed_at < stale`) can never match `'infinity'`, so an old revision still running during a
rolling deploy, whose guard knows only two tables, can never claim these rows, however long it lives. The new claim
takes legacy rows exactly as before (`not_before IS NULL`, `claimed_at` lease) plus new-style rows with
`claimed_at = 'infinity' AND not_before <= now AND (lease_until IS NULL OR lease_until < now)`, leasing them through
`lease_until`. `lease_until` holds the lease *expiry* time (claim time + `leaseSeconds`). A failed storage delete on a new-style row bumps
`attempts` and sets `not_before = now + LEAST(3600, 60 * 2^(attempts-1)) s` (V128's backoff formula), and the same
`maxAttempts` cap applies (excluded from the claim at the cap, as for legacy rows). A deferral moves `not_before` only
(no attempt bump). Both clear `lease_until` and never touch `claimed_at`. V128's own two triggers stay as they are (legacy rows), but the new drain now applies the
full guard to them too. A test runs V128's claim SQL verbatim, copied from the merged
`StoredObjectDeletionRepository`, against every kind of new-style row and asserts it claims none.

**D7. A failed append future goes through the guarded queue.** When `appendFormRow`'s future fails,
`PanelFormFileSubmission` queues each stored key through a new privileged repository method, `enqueue(keys,
sourceTable = "form_submit_failed", notBefore = now + GraceSeconds)` (default 900). It then returns the original
failure unchanged. If the enqueue itself fails, it logs the key count and exception class only. The drain deletes an
object only when no committed row holds its key (D5).
- **Why this is safe.** No `statement_timeout` or `lock_timeout` is configured for the app DB, so the grace window does
  not rest on any timeout. It rests on two facts. A Slick `db.run` future completes only after its transaction has
  ended, whether committed or rolled back. And a transaction whose client is lost before COMMIT never commits later.
  By the time the future fails, the row's fate is settled. The 900 s only absorbs clock skew and commit visibility
  across pool connections.
- **Committed-then-failed sources (corrected after skeptic design-2).** `triggerAutoRunAwaited` recovers every async
  failure (`DataSourceService.scala:130-133`), and `audit` is fire-and-forget, so neither can fail the future. The
  reachable post-commit failure sources are a *synchronous* throw from `autoRunTriggerService.triggerAutoRun`, which
  escapes the `flatMap` at `appendFormRow` (~line 930), a throw from `RowWriteResult.fromRepositoryRows` (~line 931),
  and any post-commit step added in the future. D7 covers all of them because the guard decides from DB state, not
  from where the failure came from. Test 3.3 injects a synchronous throw.
- **Partial write failure in `storeFormFiles`.** When one of several file writes fails, the files already written are
  removed best-effort (same `StoredObjectCleanup.delete`) before the failure propagates. Keys are generated
  first and cleanup waits for EVERY write to settle (not `Future.traverse`'s fail-fast), so a slow sibling write cannot
  land after the cleanup. This is covered here, since
  it is the same "files stored, no row" leak.
- The refused-append (`Left`) path keeps its immediate removal.
- Wiring is optional-nullable, like the other dependencies of `PanelFormFileSubmission`.

## Risks / Trade-offs

- [Write cost on `dataset_rows` updates and deletes] → statement-level triggers, the text prefilter, measured in
  `measurements.md` (bulk delete of 10k rows with and without a file field, before and after V132).
- [Old revision during deploy overlap] → D6: new-style rows are unclaimable by V128-era SQL, proven by test.
- [Guard full scans on large snapshot or history tables] → batched per pass, bounded by `batchSize`, and run only
  when the queue is non-empty. Measured as well.
- [A deferred key re-checked hourly, for as long as history retention keeps a copy (up to 365 days for owner tier)]
  → one batched check per hour, never counted as a failure.
- [A user copies a victim's form-upload key into their own dataset row] → the object is kept while either row
  exists. That is a leak, never a wrong deletion. Read authorization is unchanged and out of scope.
- [A pipeline snapshot written between the guard check and the delete] → the snapshot is derived, and the next run
  drops it. Documented, not prevented.
- [TRUNCATE triggers fire in spec databases, so tests that assert queue counts after a TRUNCATE could change] → the
  full backend suite runs in shards, and any spec that breaks is fixed by isolating its queue assertions.

## Migration Plan

V132 runs at backend boot through Flyway, as the NOSUPERUSER NOBYPASSRLS `helio` role. There is no backfill.
Deploy overlap is handled by D6. Rollback means deploying the previous revision. The old code never claims a
new-style row, so those rows simply wait. The PR body must carry an OWNER REVIEW section covering:
- what gets deleted and from when (objects whose rows are deleted after V132 is applied in prod);
- that historic orphans are untouched;
- deploy notes: after a rollback, V132's triggers keep queuing new-style rows that nothing drains (the queue grows, nothing
  is deleted); during the overlap an old revision still processes V128's own legacy rows with its two-table guard, as today;
- the read-only prod queries to run before release: counts of form-upload keys in `dataset_rows`, `assistant_conversations` rows,
  `stored_object_deletions` backlog by `source_table`/`attempts`, row counts of `node_snapshots` /
  `node_payload_history` / `binary_refs` / `alert_events` (guard-scan sizing), and the count of keys held only by
  legacy `binary_refs` rows with `pipeline_id IS NULL` (deferred for good).

## Planner Notes

- Self-approved: a deferral default of 3600 s, a grace default of 900 s, and both left as constructor defaults with
  no new env vars, matching V128's batch, attempt and lease defaults.
- Self-approved: V132 is reserved on the basis of `gh pr list` and the diffs of #996, #994, #991, #990 and #986.

## Implementation Notes (executor, deviations from the plan)

- **Deferral converts a legacy row.** D6 said a deferral moves `not_before` only. A V128 (legacy) row has
  `not_before IS NULL`, so setting only `not_before` would strand it (neither claim branch matches). `defer` therefore
  also sets `claimed_at = 'infinity'` and clears `lease_until` on a legacy row, converting it to a new-style row. It only
  strengthens C3.
- **Derived scan has a prefix gate.** D5's plain `rows x keys` `strpos` join measured 39 s against the dev DB's 1.6 M
  snapshot rows. The shipped scan tests each row's text against the batch's few distinct key prefixes first (2.4 s). See
  `measurements.md`.
- **Update trigger walks only changed rows** (a `MATERIALIZED` CTE of rows whose JSON differs or whose id vanished), so a
  `SET updated_at = now()` update does not pay the extraction.
- **The "legacy `binary_refs` with `pipeline_id IS NULL`" gap in D5 is probably empty**: V98 deleted those rows and
  added a CHECK requiring `root_id` XOR `node_step_id`. `pr-owner-review.md` still carries the count query.
- **Classification failure** (the batched guard query itself failing) fails the whole pass, which logs and leaves every
  claimed row's lease to expire, instead of bumping each row's `attempts` as a per-key guard failure used to.
- **A repository-level `claim` signature change**: `claim(now, leaseExpiredBefore, leaseSeconds, maxAttempts, limit)`.
- **Gate-chain** (CON-132): this change touches no `.husky/**` file and no script `.husky/pre-commit` runs, so the
  isolation-test step does not apply.
