## Standing Constraints

- [C1] Historic orphans are never touched: V132 has no backfill and enqueues nothing for pre-existing rows (HEL-1529).
- [C2] Every new trigger function: SECURITY DEFINER, `search_path = pg_catalog, public`, `row_security = off`, owner
  `helio_privileged` via V128's bracket, trigger ENABLE ALWAYS; never an EXCEPTION block.
- [C3] Every queue row written by new code is unclaimable by V128-era claim SQL (`claimed_at = 'infinity'`), proven by running that SQL verbatim.

### Backend

## 1. Migration V132

- [x] 1.1 Re-check origin/main migrations and open PR diffs; confirm V132 is free (record result in files-modified.md notes) -- origin/main head is V130; open PR diffs checked with `gh pr diff --name-only` for #997 #996 #994 #991 #990 #986 #266: only #994 adds a migration (V131)
- [x] 1.2 Add `not_before`/`lease_until` columns + `binary_refs(storage_key)` index + grants (D1); verify Flyway migrate on a fresh DB
- [x] 1.3 `dataset_rows` statement-level DELETE/UPDATE triggers with form-upload regex extraction (D2); verify with 3.1
- [x] 1.4 `assistant_conversations` AFTER DELETE trigger (D3); verify with 3.1
- [x] 1.5 BEFORE TRUNCATE statement triggers on the four tables (D4); verify with 3.1
- [x] 1.6 V132 trigger inserts are new-style rows (`claimed_at = 'infinity'`, `not_before` set) (D6); verify with 3.1

## 2. Drain + form submit

- [x] 2.1 Repository: dual claim (legacy + new-style via `lease_until`), guard Authoritative/DerivedOnly/None per D5 (dataset authoritative only via D2 extraction; alert_events derived), batched; verify with 3.2
- [x] 2.2 Repository: `defer`/failure backoff move `not_before` only on new-style rows (never `claimed_at`); `enqueue(keys, sourceTable, notBefore)` new-style; verify with 3.2
- [x] 2.3 Service: Authoritative → dequeue, DerivedOnly → defer, None → delete+dequeue; verify with 3.2
- [x] 2.4 `PanelFormFileSubmission`: failed append future → guarded enqueue with grace, original failure returned (D7); wire it in; verify with 3.3

- [x] 2.5 Update `README.md` in `services/sources/`, `services/panels/`, `infrastructure/persistence/sources/` to describe V132 coverage; verify by grep

### Tests

## 3. Tests (red first where behaviour changes)

- [x] 3.1 V132 migration spec as NOSUPERUSER NOBYPASSRLS owner (mirror `StoredObjectDeletionsMigrationSpec`): function attributes, `tgenabled = 'A'`, app-role delete with RLS context, users cascade with context unset, update diff, malformed JSON / non-form keys enqueue nothing and never abort the delete, truncate cascade + rollback; mutation-check that dropping `row_security = off` or SECURITY DEFINER turns it red
- [x] 3.2 `StoredObjectDeletionServiceSpec`: authoritative dequeue, derived deferral then deletion once copy gone, `not_before` honored, shared form key kept until last row deleted, image/transcript key copied into a dataset row is deferred (not dequeued) and deleted after the copy row goes
- [x] 3.2a V128's claim SQL, copied verbatim from the merged repository, claims none of: V132 trigger rows, app-enqueued rows, deferred rows, failed-backoff new-style rows
- [x] 3.3 `FormSubmitRoutesSpec`: flip the pinned "leave the stored objects in place when the in-lock append future fails" test red-first (rolled-back append → `form_submit_failed` new-style row, deleted after grace + pass; mutation: removing the enqueue turns it red); committed-then-failed via a stub whose `triggerAutoRun` throws SYNCHRONOUSLY → assert non-2xx, exactly one row committed, a `form_submit_failed` row with `claimed_at='infinity'` and `not_before`≈now+900s, and after grace + drain pass the queue row is gone and the object still exists; partial `storeFormFiles` write failure (with a slow sibling write) removes every written file; seam hint: subclass `DataSourceRepository` and override `appendBuiltRow` to fail after `super` commits
- [x] 3.4 `measurements.md`: dev-DB row counts, EXPLAIN ANALYZE of batched guard, 10k-row dataset delete with/without V132 triggers
- [x] 3.5 Full backend suite in foreground shards (`sbt testFull` split by package, ≤600 s each, nice -n 19, capped workers), list exactly what ran and report `stored_object_deletions` row count before/after; scalafmt/code-quality gate green
- [x] 3.6 Draft the PR body OWNER REVIEW section (what is deleted and from when, historic orphans untouched, read-only prod queries, deploy-overlap behaviour per D6, known gaps) into `pr-owner-review.md` in this change
