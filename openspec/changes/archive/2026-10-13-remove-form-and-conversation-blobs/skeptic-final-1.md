## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `05db0333d9a8279001ff5d9cf0679e27646b5c7f`. Diff base was resolved live with
`resolve-review-base.sh <wt> main origin`, which returned `67cf9e0e0451b781be463e82db25c57a8c8795bf` (exit 0). That
is the merge-base with origin/main (`f63ab8365`). origin/main has moved one commit since then: HEL-1527 is
frontend-only and adds no migration.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/form-assistant-blob-cleanup/HEL-1530`.

**Acceptance criteria, traced to code and tests:**

- **AC1 (dataset_rows delete, replace, source delete, users cascade, update).**
  - V132 adds `hel1530_enqueue_dataset_row_delete` and `hel1530_enqueue_dataset_row_update`, both statement-level with transition tables.
  - `replaceRowsAction` (`DataSourceRepository.scala:701-735`) runs its delete and insert in one `withUserContext(...).transactionally`. So a replace that keeps a key is queued and then judged Authoritative, and the key is not deleted. `FormAndConversationObjectDrainSpec` "survive a full-set replace" covers this.
  - Source delete, users cascade and update are covered in both the migration spec and the drain spec.
- **AC2 (conversations).**
  - The per-row trigger `hel1530_enqueue_conversation_object` handles this, and the drain spec covers removal.
  - `owner_id` is NO ACTION, so no cascade reaches this table. That matches design.md.
- **AC3 (guard tables).**
  - In `StoredObjectDeletionRepository.classify`, the authoritative set is image_uploads, file data_sources, assistant_conversations, and dataset_rows matched by the exact trigger extraction.
  - The derived set is binary_refs, node_snapshots, node_payload_history, alert_events, and dataset_rows matched by quoted substring.
  - The drain spec has a keep-then-delete test for each derived holder. evaluation-2 records mutations M1/M2 failing exactly those tests.
- **AC4 (TRUNCATE).** V132 adds four BEFORE TRUNCATE statement triggers. The migration spec checks that `TRUNCATE users CASCADE` as the NOBYPASSRLS owner queues all 5 keys, and that a rolled-back truncate queues nothing.
- **AC5 (failed append).**
  - `PanelFormFileSubmission.scala` handles this with `transformWith`: a `Failure` goes to `queueFailedAppend`, which enqueues behind a 900 s grace window and then re-raises the original failure.
  - The pinned HEL-1434 test in `FormSubmitRoutesSpec` was flipped. It now checks a grace-window queue row and deletion after the window.
  - `PanelFormFileSubmissionFailedAppendSpec` covers the committed-then-failed case: the object is kept because the row is Authoritative.
- **AC6 (C2 shape).**
  - The migration spec's catalogue test pins SECURITY DEFINER, owner `helio_privileged`, `row_security=off`, the pinned search_path, no EXCEPTION block, all 7 triggers at `tgenabled='A'`, and 0 policies on the queue.
  - Behaviour tests run as a LOGIN NOSUPERUSER NOBYPASSRLS schema-owner role. DELETE, UPDATE, the cascade, the conversation delete and TRUNCATE all commit and queue. The odd-JSON delete (14 shapes) commits and queues nothing.
  - The migration is V132, and V131 is absent from the branch.
- **AC7 (no backfill, owner review).**
  - I read V132 line by line. Its only `INSERT`s are inside trigger function bodies, and there is no top-level DML, so C1 holds.
  - `pr-owner-review.md` exists. Its accuracy is assessed below.

**C3 / rolling-deploy unclaimability.**
- The spec's `v128Claim` SQL is identical to `claim` in the merged repository file. The file at base and at origin/main has the same md5 (`b4df1aebf1ece0f3dd186c2a4e9e3251`), and I compared the text side by side.
- The spec runs it 10 years in the future against pristine trigger rows, app-enqueued rows, deferred rows and failed-backoff rows. It claims only the legacy control row. `'infinity' < stale` can never be true, so this holds.
- Deviation 1 (a deferral converts a legacy row to `claimed_at='infinity'`) only strengthens C3.

**Gates, re-run by me at 05db0333d:**
- I ran `sbt -J-Xmx3g testOnly` over the 4 changed specs plus the 4 HEL-1434/RLS neighbours: `FormAndConversationObjectDeletionsMigrationSpec`, `FormAndConversationObjectDrainSpec`, `PanelFormFileSubmissionFailedAppendSpec`, `FormSubmitRoutesSpec`, `StoredObjectDeletionsMigrationSpec`, `StoredObjectDeletionServiceSpec`, `PipelineSchedulerServiceStoredObjectDrainSpec` and `RlsPolicyGuardSpec`.
  - Result: `Suites: completed 8, aborted 0 / Tests: succeeded 203, failed 0 / All tests passed.`
- I ran full-suite shard 2 of 6: `HELIO_TEST_SHARD_INDEX=2 HELIO_TEST_SHARD_COUNT=6 HEL924_TEST_GROUP_CONCURRENCY=1 nice -n 19 sbt -J-Xmx3g testFull`.
  - Result: `Suites: completed 98, aborted 0 / Tests: succeeded 1575, failed 0, canceled 1 / [hel1468-guard] failed=0 aborted=0`.
  - This matches evaluation-1's pasted shard-2 count (98/1575).
  - `git diff 0cb6eebf8 05db0333d -- backend/src/main` is empty, so evaluation-1's 6-shard result (593 suites / 7816 tests) still applies to the shipped main code.
- **Not run by me:** shards 0, 1, 3, 4 and 5.

**Can any path delete an object an authoritative row still holds?**
- The classification is per batch on the privileged pool and sees every row (BYPASSRLS).
- The dataset_rows authoritative check uses the exact trigger extraction and regex.
- Server-generated form keys always match the regex: the UUID is lower-case, and the extension comes from the allowlist in `FormUploadConfig.scala:19-20`, enforced by `validate`. So a committed form row is always recognised as Authoritative.
- A user who forges a key into their own row and then deletes it cannot delete the victim's object. The victim's row is Authoritative, so the key is dequeued. The regex also blocks forging image or transcript keys.
- **Remaining path:** a check-then-act race (non-blocking note 2).

**Can a new trigger abort a user's DELETE/UPDATE/TRUNCATE?**
- The functions are SECURITY DEFINER as BYPASSRLS `helio_privileged` with SELECT granted on every table they read.
- The JSON walk uses `lax` path evaluation, the regex has no backtracking hazard, and there is no EXCEPTION block.
- The tests above prove this as the NOBYPASSRLS owner, including a GUC-unset cascade.

**Derived-scan cost.**
- `measurements.md` describes the method: EXPLAIN ANALYZE, read-only on dev, 2.44 s over 1.64 M `node_snapshots`, compared with 39.4 s for the unshipped draft.
- The drain is fire-and-forget from the tick (`PipelineSchedulerService.scala:148-149`, `Future.delegate(...)`), so the tick is never blocked.
- See non-blocking note 1 on prod hardware.

**The 7 design deviations.** I reviewed each against the code.
- Defer-converts-legacy, the prefix gate (a necessary condition, because the quoted key starts with `"<prefix>`), the changed-rows CTE, the claim signature, and the gate-chain N/A are all sound.
- Classify failure leaves leases to expire and never deletes. It is pinned by a test, and evaluation-2 records mutation M3 failing it.
- The `binary_refs pipeline_id IS NULL` note is consistent with V98 (`pipeline_id TEXT NOT NULL` in the V98 table definition).

**Prod review queries.**
- `helio` is a member of `helio_privileged` (`V34__rls_privileged_role.sql:27`, `GRANT helio_privileged TO current_user`), and `helio_privileged` holds blanket SELECT (`V38:19` plus default privileges at `V38:27`). So `BEGIN READ ONLY; SET ROLE helio_privileged; ... ROLLBACK;` works for `helio`.
- The SQL is read-only.

**Migration ordering, probed.** I ran the repo's own Flyway 10.20.1 (the test classpath exported by sbt) against zonky embedded Postgres in the scratchpad:
- First run: migrate V130 and V132. Result: "first migrate (V130,V132) ok".
- Second run: add V131 and migrate again with the default config, which is also what `Database.scala:23-28` uses (no `outOfOrder`, default validation). Result: **"Validate failed: Migrations have failed validation Detected resolved migration not applied to database: 131. To ignore this migration, set -ignoreMigrationPatterns='*:ignored'. To allow executing this migration, set -outOfOrder=true."**
- `gh pr list` shows that #994 (HEL-1522, OPEN) is the only open PR adding a migration, and it adds `V131__patch_set_applied_proposals.sql`.
- Probe script (scratchpad `probe.jsh`, reproducible): `Flyway.configure().dataSource(ds).locations("filesystem:m1").load().migrate()`, then the same call with `m2`, where m2 = m1 plus `V131__b.sql`.

**UI.** The diff touches no `frontend/**` file, so the design-judgment step does not apply. I started no servers and never touched the shared dev DB. All DB probes used embedded Postgres.

### Verdict: REFUTE

The code, migration and tests satisfy AC1 to AC6 and constraints C1 to C3. I found no code defect.

The REFUTE is limited to `pr-owner-review.md`, the AC7 deliverable the owner will rely on before releasing a change that deletes objects in prod. It leaves out a deploy-breaking merge-order hazard, which I confirmed above, and it recommends a role path that the SQL block it provides cannot use. Both are text fixes. No code changes are requested.

### Change Requests

1. **Add the V131/V132 merge-order hazard to `pr-owner-review.md` (Deploy notes).** The current text says only "Re-check before merging". It must say plainly:
   - Open PR #994 adds V131. If this PR (V132) is merged and deployed first, every later boot of a revision that contains V131 fails Flyway validation with "Detected resolved migration not applied to database: 131". Flyway runs `.migrate()` at backend start (`Database.scala:23-28`), and the config has no `outOfOrder`.
   - So either #994 merges and deploys first, or whichever PR merges second renumbers its migration above the other's, before it merges.
   - The same applies to any other migration that lands on main between now and the merge.
2. **Fix the role guidance in `pr-owner-review.md` ("Read-only prod queries").** It currently offers "the Cloud SQL `postgres` admin" as an alternative, but the SQL block always runs `SET ROLE helio_privileged`.
   - Cloud SQL's `postgres` user is not a true superuser and is not a member of `helio_privileged` unless granted. So under `postgres` the block fails at `SET ROLE`.
   - If the line is dropped, query 0 decides: correct counts need BYPASSRLS, because every listed table is FORCE RLS and owned by `helio`.
   - Either remove the `postgres` alternative and keep "connect as `helio`, then `SET ROLE helio_privileged`", or state "as `postgres`, omit `SET ROLE` and trust the numbers only if query 0 reports `rolbypassrls = true`".

### Non-blocking notes

1. **The derived-scan cost on prod hardware is understated by one factor.** 2.44 s was measured on the owner's desktop.
   - HEL-1435's measurements found the `db-g1-small`-class proxy about 5x slower than the desktop on comparable passes (96.7 s against 18.4 s, cited in CLAUDE.md).
   - At the same `node_snapshots` size, a sweep could plausibly take around 10 s or more on prod, and it holds one privileged-pool connection for that time. It runs on every non-empty pass that has an unreferenced or derived-held key, including the hourly re-checks of deferred keys.
   - Consider adding one line to the owner review: "Measured on desktop; expect several times slower on the prod instance class; judge using query 4's `node_snapshots` size."
2. **Check-then-act race that could be disclosed.**
   - Trigger rows get `not_before = now()`, with no grace. The batch is classified once and then its storage deletes run one after another.
   - So a write that re-introduces a just-removed form key into a dataset row after the classify, and before that key's delete, leaves an authoritative row pointing at a deleted object. Example: a pipeline write-back of a row read before the user's delete.
   - This is narrow, and it is the same class as the "snapshot written between check and delete" gap the review already lists, but this case produces a dataset row, not a derived copy that the next run replaces.
   - Possible fixes: a short `not_before` grace on trigger rows, which is cheap, or a line in "Known gaps".
3. **A queue row holds a key literally.** A data-source key containing `"` or `\` would never match the quoted-substring derived check, because JSON text escapes those characters. Such a key is classified Unreferenced even when a derived copy exists. Server-generated keys contain neither character, so this is theoretical.
4. **Untracked file.** `evaluation-2.md` is untracked in the worktree (`git status`). The orchestrator should commit it with the rest of the change artifacts.
