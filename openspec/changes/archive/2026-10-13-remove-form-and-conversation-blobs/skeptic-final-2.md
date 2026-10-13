## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `0364c4c406e9665c730303765631a0f70fdb508c`. I resolved the diff base live with
`resolve-review-base.sh <wt> main origin`, which returned `67cf9e0e0451b781be463e82db25c57a8c8795bf` (exit 0).
origin/main has moved one commit since then, `f63ab8365` (HEL-1527), and that commit adds no migration.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/form-assistant-blob-cleanup/HEL-1530`.

**Scope of the fix commit.**
- `git show --stat 0364c4c40`: the commit touches only `pr-owner-review.md` (+15/-1), `evaluation-2.md` and `skeptic-final-1.md`.
- `git diff --stat 0cb6eebf8 HEAD -- backend/src/main` and `git diff --stat 05db0333d HEAD -- backend` are both empty. The shipped code is the same code that round 1 reviewed.

**Code read independently (not from the reports).** I read all of V132, the V128 shape it copies, and the full main-code diff: `StoredObjectDeletionRepository` (dual claim, `classify`, `defer`, `recordFailure`, `enqueue`), `StoredObjectDeletionService`, `PanelFormFileSubmission`, `PanelService` and `ApiRoutes`.

**Acceptance criteria:**

- **AC1: met.**
  - Statement-level `AFTER DELETE` and `AFTER UPDATE` triggers on `dataset_rows` use transition tables. The update trigger queues a key only when that row id's new JSON no longer holds it. Both triggers filter keys with a strict `form-uploads/<uuid>.<ext>` regex.
  - Source delete and the `users` cascade reach `dataset_rows` through FK cascades, which fire the statement trigger.
  - A replace that keeps a key re-queues it. The key is then classified Authoritative and dequeued, not deleted.
  - Server-generated extensions always match the regex: `FormUploadConfig.extensionOf` lower-cases them (`FormUploadConfig.scala:37-40`).
- **AC2: met.**
  - A per-row `AFTER DELETE` trigger queues `gcs_body_ref`.
  - The repository has no delete method, which matches the review's "no route today".
  - `gcs_body_ref` is only ever rewritten to the same path (`AssistantConversationRepository.scala:114-134`).
- **AC3: met.**
  - `classify` treats these as Authoritative: `image_uploads`, file-backed `data_sources`, `assistant_conversations`, and `dataset_rows` matched by the trigger's own extraction.
  - It treats these as DerivedOnly, which defers the key and never drops it: `binary_refs`, plus a quoted-key match in `node_snapshots`, `node_payload_history`, `alert_events` and `dataset_rows`.
  - The prefix gate is a necessary condition for a quoted-key hit, so it can only skip rows that could never match.
- **AC4: met.** Four `BEFORE TRUNCATE` statement triggers cover the four owning tables. Each copies its table's own key extraction.
- **AC5: met.**
  - `transformWith` sends `Failure` to `queueFailedAppend`, which writes a new-style row with a 900 s grace and then re-raises the original failure.
  - A committed row holding the key makes it Authoritative, so the object is kept.
  - The pinned `FormSubmitRoutesSpec` test was flipped to match.
- **AC6 and C2: met.**
  - All 7 functions are SECURITY DEFINER with `search_path = pg_catalog, public` and `row_security = off`. They are re-owned with V128's bracket, every trigger is ENABLE ALWAYS, and no function has an EXCEPTION block. I confirmed this by reading the file.
  - The migration spec runs as a NOSUPERUSER NOBYPASSRLS schema owner.
  - The migration is V132. V131 is not on the branch.
- **C1 / AC7 no-backfill: met.**
  - Every `INSERT` in V132 sits inside a trigger function body, and V132 has no top-level DML.
  - My probe below shows the queue empty after migrating, until a delete happens.
- **C3: met.**
  - Every new writer sets `claimed_at = 'infinity'`: the triggers, `enqueue`, and `defer` (which also converts a legacy row). `recordFailure` never clears `claimed_at` on a new-style row.
  - V128's predicate `claimed_at IS NULL OR claimed_at < stale` cannot match `'infinity'`.

**Gates, re-run fresh by me at HEAD** (`nice -n 19`, `sbt -J-Xmx3g`, `HEL924_TEST_GROUP_CONCURRENCY=1`, foreground):

- `testOnly` over 8 suites:
  - Suites: `FormAndConversationObjectDeletionsMigrationSpec`, `FormAndConversationObjectDrainSpec`, `PanelFormFileSubmissionFailedAppendSpec`, `FormSubmitRoutesSpec`, `StoredObjectDeletionsMigrationSpec`, `StoredObjectDeletionServiceSpec`, `PipelineSchedulerServiceStoredObjectDrainSpec` and `RlsPolicyGuardSpec`.
  - Result: `Suites: completed 8, aborted 0 / Tests: succeeded 203, failed 0 / All tests passed.`
  - The log shows live embedded-Postgres Flyway runs at 09:07 today, so this was a real run, not an sbt cache replay.
- Full-suite shard 4 of 6 (`HELIO_TEST_SHARD_INDEX=4 HELIO_TEST_SHARD_COUNT=6 ... testFull`):
  - Result: `Suites: completed 100, aborted 0 / Tests: succeeded 1134, failed 0 / [hel1468-guard] failed=0 aborted=0`.
  - Round 1's skeptic ran shard 2. evaluation-1 ran all 6 shards on byte-identical main code.
  - I did not run shards 0, 1, 2, 3 and 5 myself.

**`pr-owner-review.md` checked against ground truth:**

- **The prod SQL block, executed.**
  - Setup: zonky embedded PG 14.10 in the scratchpad, using the repo's Flyway 10.20.1 and the worktree's migration directory, applied as a LOGIN NOSUPERUSER NOBYPASSRLS schema-owner role `helio`, which is prod's shape. Flyway head reached 132. I seeded 2 form rows and 1 conversation, then deleted one form row as `helio` with a user context.
  - I extracted the review's `sql` fence verbatim and ran it with `psql -f` as `helio`.
  - With `SET ROLE helio_privileged`, every statement succeeded:
    - Query 0 returned `helio_privileged | t`.
    - Query 1 returned `2 | 1` (see note 1).
    - Query 2 returned `1`.
    - Query 3 returned `dataset_rows | 0 | 1`.
    - Query 4 returned all 5 sizes.
    - Query 5 returned `0`.
    - `ROLLBACK` succeeded. Nothing was written, because the block runs inside `BEGIN READ ONLY`.
  - With `SET ROLE` removed, query 0 returned `helio | f` and query 1 failed with `unrecognized configuration parameter "app.current_user_id"`. The review's "do not trust any count unless query 0 shows true" guidance therefore protects the owner.
  - This confirms both role-guidance fixes from round 1 (CR2). `helio` holds `helio_privileged` through V34's `GRANT ... TO current_user`, and V38/V128/V132 grant the needed SELECTs.
- **Merge-order hazard (round 1, CR1).** It is now stated plainly, with the exact Flyway error, both remedies and the dev-DB scope.
  - `gh pr list` today still shows #994 (V131) as the only open PR that adds a migration.
  - The evaluator's read-only check reports the dev DB already at V131, so dev is not at risk.
- **What gets deleted, and from when.** This matches the code: triggers only, from the first boot that applies V132; a 900 s grace equals the "15-minute" window; deferred keys are re-checked hourly (`DefaultDeferSeconds = 3600`).
- **Historic orphans untouched.** V132 has no backfill and nothing in it is enqueued at migrate time.
- **Rollback note.** Correct: an older revision's claim can never match `'infinity'` rows, so they accumulate and nothing is deleted.
- **Check-then-delete race and prod scan cost.** Both are now disclosed.

**No prod or dev DB contact.** I booted no servers and never touched the shared dev DB. The only DB I used was the embedded probe DB, which was torn down with the JVM.

**UI.** The diff contains no `frontend/**` file, so the design-judgment step does not apply.

### Verdict: CONFIRM

The code, migration and tests meet AC1 to AC7 and constraints C1 to C3. Both round-1 change requests are addressed accurately, and the owner-review SQL works as written under prod's role shape.

### Non-blocking notes

1. In `pr-owner-review.md` query 1, `rows_with_form_key` counts JSON-path hits, not rows. `lax $.**` yields the same `storageKey` twice for a cell inside an array. In the probe, 1 row with 1 key returned `2 | 1`. The number overstates (it is conservative, and `distinct_form_keys` is right). `count(DISTINCT r.id)` would make the column match its label.
2. The review says that without the BYPASSRLS role the counts read 0, and that `assistant_conversations` "may even error". In practice, the `dataset_rows` query already errors with the GUC unset. The protective guidance is unaffected.
3. "Either #994 deploys first": the exact condition is that no database applies V132 before V131. Merging both and deploying them together is also safe. The current wording is conservative, so no change is needed.
4. `CREATE INDEX idx_binary_refs_storage_key` is not `CONCURRENTLY`, so it briefly blocks writes to `binary_refs` during the deploy migration. Query 4 sizes `binary_refs`, so the owner can judge this. It is not mentioned explicitly.
5. The derived sweep runs on any pass that has a key not authoritatively held. That includes each deferred key's hourly re-check, not only passes with an "unreferenced key" as the deploy note says. Deferrals spread over time could trigger sweeps more often than hourly.
