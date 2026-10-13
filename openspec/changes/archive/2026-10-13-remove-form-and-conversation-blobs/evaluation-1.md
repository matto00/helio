## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `0cb6eebf8255aaf3c96d741abe0cc0d3866d8561`. Diff base: `67cf9e0e0451b781be463e82db25c57a8c8795bf`, resolved live with `resolve-review-base.sh`.
Changed paths: `backend/**` and `openspec/changes/remove-form-and-conversation-blobs/**` only. No `frontend/**`, `schemas/**` or `openspec/specs/**` file changed.

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1 dataset-row form keys (row delete, replace, source delete, users cascade, update) | PASS. V132 statement triggers. Tests: `FormAndConversationObjectDrainSpec` and `FormAndConversationObjectDeletionsMigrationSpec`. |
| AC2 conversation transcript queued on any delete | PASS |
| AC3 guard covers `dataset_rows`, `assistant_conversations`, `binary_refs`, `node_snapshots`, `node_payload_history` (plus `alert_events`) | Code PASS. Coverage is incomplete: see CR1. |
| AC4 TRUNCATE queues keys, nothing on rollback | PASS (migration spec, as the NOBYPASSRLS role) |
| AC5 failed append future goes to the guarded queue after a grace window; pinned HEL-1434 test flipped | PASS. Covers rolled-back, committed-then-sync-throw, enqueue-failure and partial-write cases. The route-level flip is in `FormSubmitRoutesSpec` and uses the real `ApiRoutes`. |
| AC6 V128 security shape, V132 | PASS. Catalogue test checks SECURITY DEFINER, `row_security=off`, `search_path`, owner `helio_privileged`, `tgenabled='A'` and no EXCEPTION block. The delete as an RLS-bound user and the users cascade with the GUC unset both commit. |
| AC7 OWNER REVIEW: what is deleted and from when, historic orphans untouched, read-only prod queries | Partly met. The "what" and "from when" are correct. Historic orphans are stated as untouched, and the migration has no backfill (C1). The queries are SELECT-only, but they give silently wrong results under the prod app role: see CR2. |
| No silent AC reinterpretation, no scope creep | PASS. The partial-write cleanup in `storeFormFiles` is a design D7 item and is in the spec delta. |
| Planning artifacts match the implementation | PASS. The spec delta's MODIFIED requirement matches the canonical header and replaces the HEL-1434 "not removed" scenario. |
| Constraints C1 / C2 / C3 | C1 PASS (no backfill). C2 PASS. C3 PASS: `FormAndConversationObjectDrainSpec` "V128's own claim SQL (3.2a)" runs the merged claim SQL, which I diffed against `67cf9e0e0` and found byte-identical apart from bind names. It claims the legacy control row and none of these: dataset-trigger, conversation-trigger, app-enqueue, deferred or failed-backoff rows. TRUNCATE rows are not in that test, but the migration spec asserts `claimed_at='infinity'` on all 5. |

#### The executor's 7 implementation-note deviations, checked against the specs and the confirmed design

1. **Deferral converts a legacy row (`claimed_at='infinity'`).** Correct and necessary. Under D6's literal wording, a legacy row with only `not_before` set matches neither claim branch, so it would be stranded. Worse, if `not_before` were set and `claimed_at` were later released, a V128-era revision could reclaim it with its two-table guard. The conversion strengthens C3. Tested: the "defer an image key ... bare string" case asserts `(0, true, true, false)` after the deferral.
2. **Derived scan prefix gate.** It returns the same results: a hit needs `"<key>"` in the text, and that string always contains `"<split_part(key,'/',1)>`. Reproduced on the dev DB, read-only (`BEGIN READ ONLY`, 100 random form/image keys, the shipped SQL shape, 1,643,391 `node_snapshots` rows): **Execution Time 2396 ms**, in line with the claimed 2.44 s. The scan runs only when a batch has at least one key not authoritatively held. The scheduler starts the drain without awaiting it (`PipelineSchedulerService.scala:148-152`), so the tick is never blocked.
3. **The update trigger walks only changed rows.** Equivalent: an unchanged row with the same id has the same old and new key sets, so nothing would be queued for it anyway. Tested: an `updated_at`-only update queues nothing.
4. **The `binary_refs.pipeline_id IS NULL` gap is probably empty.** Confirmed in the source: `V98__pipeline_roots.sql:169-195` deletes those rows. Prod query 5 is kept.
5. **A classification failure fails the whole pass.** Acceptable. `runPass` recovers and logs, and leases expire (300 s), so it never causes a wrong delete. The trade-off is that a persistent guard failure is retried without the attempt cap. The specs say nothing about guard failures (the canonical "Storage delete fails" scenario covers only the storage delete, which still counts attempts). There is no test for it (see the non-blocking suggestions).
6. **`claim` signature change.** Internal only, and every caller is updated (the suite compiles and passes).
7. **The gate-chain step does not apply.** Correct: no `.husky/**` change.

#### Other executor claims I checked

- **Dev DB not polluted.** Checked with read-only `psql` before and after my own full-suite run. Flyway head is V131, `stored_object_deletions` has its 7 V128 columns only (no `not_before`/`lease_until`), and its row count is 0. The 110k TRUNCATE CASCADE figure came from per-spec embedded zonky Postgres (the specs use `VerifiedEmbeddedPostgres`). It does not touch the shared dev DB.
- **`files-modified.md` paths.** All repo-relative.
- **Red-first.** On base `67cf9e0e0` nothing writes a `form_submit_failed` row. So the flipped `FormSubmitRoutesSpec` case (`queued should have size 1`) cannot pass there, and its red is established by construction. I did not re-run the executor's migration mutations (dropping SECURITY DEFINER, skipping the re-own). The catalogue assertions would fail under either mutation.

### Phase 2: Code Review — FAIL (tests only; the code is sound)

**Gates, my own fresh runs in `WORKTREE_PATH` at the reviewed commit:**

- `sbt testFull`, the whole backend suite, run in 6 foreground shards with `HELIO_TEST_SHARD_INDEX=0..5 HELIO_TEST_SHARD_COUNT=6 HEL924_TEST_GROUP_CONCURRENCY=1 nice -n 19 sbt -J-Xmx3g testFull`. Each shard was under 600 s.
  - Results per shard (suites / tests): 97/1404, 98/1155, 98/1575, 100/1277, 100/1134, 100/1271.
  - Totals: **593 suites** (equal to the number of `*Spec.scala` files), **7816 succeeded, 0 failed, 0 aborted**, and `[hel1468-guard] failed=0 aborted=0` on every shard.
  - 4 tests were canceled; all 4 are `HELIO_MEASURE=1` opt-in measurement tests.
- Targeted `testOnly` over the 8 stored-object specs (the 4 new or changed ones plus HEL-1434's): 85/85 passed. Log timestamps confirm the tests ran fresh rather than being replayed from cache.
- `npm run check:scala-quality`: clean. Changed files get soft size warnings only: `FormAndConversationObjectDrainSpec` 389 lines, the migration spec 257, and `FormSubmitRoutesSpec`/`PanelService`/`ApiRoutes`, which were already over budget.
- `check:openspec`, `check:spec-structure`, `check:test-temp-dir-hygiene`, `check:repo-integrity`, `format:check`: all clean.

**Code checklist:**

| Check | Result |
|---|---|
| CONTRIBUTING mechanical rules | No inline FQNs in the added code (grep), no TODO/FIXME, no `asInstanceOf`/`Any`. |
| Security | The form-upload regex is the extraction boundary for user-writable JSON. The odd-JSON test proves that image keys, transcript keys, a malformed uuid, an uppercase extension, a `/../` suffix, a newline suffix, non-strings and arrays queue nothing and never abort the delete. Table and column names in `derivedAction`'s `#$` splice are constants. Keys are bound through a JSON parameter. |
| Error handling | Enqueue failure is logged by count and exception class, and the original failure is returned. A partial write settles every sibling write before cleanup (tested with a slow sibling). |
| DRY | The form-upload regex and extraction appear 4 times in V132 and once in `authoritativeAction`. An SQL migration and Scala cannot easily share this; see the non-blocking suggestions. |
| Type safety / modularity / readability | `KeyReference` is a sealed ADT and the three-way service match is exhaustive. |
| Tests meaningful | **Gap: see CR1.** |

### Phase 3: UI Review — N/A (justified)

The only trigger path in the diff is `backend/src/main/scala/com/helio/api/ApiRoutes.scala`. The change there is two lines: an import, and one constructor argument (`new StoredObjectDeletionRepository(dbContext)`) passed to `PanelService`. There is no route, contract, schema or UI change, and no `frontend/**` file changed.

That wiring is already exercised end to end. `FormSubmitRoutesSpec` builds the real `new ApiRoutes(...)` (line 186), and its flipped test passes only if the repository reaches `PanelFormFileSubmission`.

I deliberately did not start servers. `start-servers.sh` boots `sbt run` against the shared dev DB through `backend/.env`. Flyway would then apply this parked, unmerged V132 to the DB every worktree shares (currently at V131), and any later edit to V132 would break every lane through a checksum mismatch (the MISTAKES.md "Every worktree shares one Postgres database" hazard). A live run would observe nothing that the route spec does not already cover. I started no servers and stopped none.

### Overall: FAIL

### Change Requests

1. **AC3 coverage: add drain cases for `binary_refs` and `node_payload_history`.** The guard's `binary_refs` clause (`StoredObjectDeletionRepository.scala`, `derivedAction`, the `SELECT k FROM wanted WHERE EXISTS (SELECT 1 FROM binary_refs ...)` line) and the `("node_payload_history", "rows")` entry in the `scans` Seq have no test. Deleting either one leaves every test green, yet AC3 names both tables.
   - Add two cases in `backend/src/test/scala/com/helio/services/sources/FormAndConversationObjectDrainSpec.scala` under "the extended shared-key guard", mirroring "keep an image key held by a node snapshot":
     - (a) insert a `binary_refs` row whose `storage_key` is the image key, delete the image row, run `pass()`, assert the object is present and one row is queued; delete the `binary_refs` row, run `withOffset(3700)(pass())`, assert the object is gone.
     - (b) the same, with the key inside a `node_payload_history.rows` JSON value.
   - Use `session_replication_role = replica` for FK-free seeding, as the alert test already does.
   - Show each case red under the matching mutation (remove the clause or the Seq entry), then revert.
2. **AC7: the read-only prod queries return silently wrong counts under the prod app role.** `stored_object_deletions` (V128, FORCE RLS with no policy), `dataset_rows`, `assistant_conversations`, `node_snapshots`, `node_payload_history`, `binary_refs` and `alert_events` are all FORCE ROW LEVEL SECURITY. Prod's `helio` role is NOBYPASSRLS. Run as `helio`, query 3 always returns an empty backlog and queries 1, 2 and 4 count only the rows visible to the current user context, which is 0 when the GUC is unset. `assistant_conversations`' policy reads the GUC without `missing_ok`, so query 2 may error instead.
   - In `openspec/changes/remove-form-and-conversation-blobs/pr-owner-review.md`, under "Read-only prod queries to run BEFORE release", state that the queries must run as a BYPASSRLS role: `SET ROLE helio_privileged` inside a `BEGIN READ ONLY` transaction, or the Cloud SQL `postgres` admin.
   - Add a first sanity query, `SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;`, and say that a `0` from any count under a non-bypass role means RLS, not an empty table. This is exactly the RLS-masking trap recorded in MISTAKES.md / HEL-286.

### Non-blocking Suggestions

- Add a test for deviation 5: a `classify` failure, using a repository subclass that fails `classify`, leaves every claimed row queued with `attempts` unchanged and `runPass` returning 0.
- `measurements.md` §3: "TRUNCATE users CASCADE (about 60 k dataset rows, 30 k with a key) ... queued 110,000 rows" does not reconcile with `SELECT DISTINCT` over at most 30k keys. It may be the cumulative queue count rather than the rows queued by that statement. The spec that produced it was deleted, so say which it is. This does not affect correctness.
- Prod query 1 omits the trigger's form-upload regex, so it can over-count keys relative to what V132 owns. Add the same `~ '^form-uploads/...'` filter so the count means exactly "keys the trigger will own".
- Consider one `IMMUTABLE` SQL helper for the form-upload key regex, used by the 4 trigger functions and `authoritativeAction`, so the security-boundary regex cannot drift between copies. Weigh this against the per-row call cost measured in `measurements.md`.
