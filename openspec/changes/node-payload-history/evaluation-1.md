## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `679070dcc1c604e8f26a3e879ec2dafc427c4d96` (branch `feature/opt-in-payload-history/HEL-1276`).
Diff base: `d9473814f16df0c54ef76117c00ce9c071297b2b`, resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — PASS
Issues: none.

- **Acceptance criteria.** Each AC has a test:
  - Transactional write: `NodePayloadHistoryWriteSpec` "a failing payload insert".
  - D5 run filter: dry-run and blocked-run cases.
  - Sharing-aware RLS: `NodePayloadHistoryRlsSpec`.
  - Privileged-pool access behind `outputRepo.findById`: `OutputHistoryService.payloadRows`.
  - Size cap: the `NodePayloadHistoryWriteSpec` "the size caps" block.
  - Free tier writes nothing.
  - Non-BYPASSRLS two-role RLS proof.
  - Public dashboards never receive payloads: `OutputHistoryPayloadPublicRoutesSpec` and `NodePayloadWiringSpec`.
- **Tasks.** All of tasks.md is ticked and matches the code. V116 is a new file. V115 is not in the diff.
- **Scope.** `NodeSnapshotRepository.scala`, `BinaryRefRepository.scala`, `.github/workflows/ci.yml` and `playwright.config.ts` are absent from `git diff --name-only`, so the HEL-1282 guard tables did not need to change.
- **CONSTRAINTS C1–C5 are honored:**
  - C1: `NodePayloadHistoryRepository.scala` writeAction uses `>` for both caps, measures UTF-8 bytes, and never truncates.
  - C2: `PayloadOptIn` is validated on all 3 write paths.
  - C3: the RLS spec runs as `helio_app_test` and `helio_privileged`, and it asserts `rolsuper OR rolbypassrls = false`.
  - C4: no HEL-1285 position is taken.
  - C5: `OutputHistoryRetentionService` has non-defaulted payload params, and `NodePayloadWiringSpec` builds ApiRoutes from `dbContext` only.
- **CLAUDE.md.** A whitespace-normalised diff of base against HEAD shows only additions: 4 env-var rows and 1 endpoint bullet. No existing row's content changed. The executor's "prettier re-padded only" claim holds.

### Phase 2: Code Review — FAIL

**Gates.** I ran all of these myself in WORKTREE_PATH at 679070dc:
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: `Tests: succeeded 6014, failed 0`, "All tests passed", EXIT=0, 422 s. No FirstRunRoutesSpec timeout and no "Java heap space" occurred. All 9 new or touched specs executed.
- Green: `check:schemas`, `check:scala-quality`, `check:node-root-encoding` and its selftest, `check:openspec`, `check:spec-structure`, `check:helio-mcp-types`, `check:no-credential-leak`, `format:check` and `lint`.
- No `frontend/**` files changed, so jest and the frontend build were not triggered. helio-mcp has no `test` script; its typecheck passed.

**Specific points I verified:**
- **Byte-cap boundary is correct.** The code rejects on `bytes > config.maxBytes`. The test stores at `cap = size`. It rejects at `cap = size - 1`, where the payload is one byte over the cap, and asserts a WARN and that the summary is kept. The executor's "one byte under" wording describes the cap, not the payload, so the behavior is the right direction. The size is UTF-8 based:
  - `getBytes(UTF_8).length` is the measure.
  - The test asserts `byte_size > compactPrint.length` on `é€é`/`ünï` rows.
  - `(size - 1) >= chars` makes a `String.length` mutation fail.
- **The row cap boundary** is `>`, with "exactly at the row cap" stored and cap 2 against 3 rows rejected.
- **D-3 ordering** is tier, then rows, then bytes. The free-tier opted-in node, over both caps, logs no `PAYLOAD_HISTORY` WARN. Reordering the checks would make that test fail.
- **The write-time trim** is `DELETE ... WHERE id = (SELECT ... OFFSET keep LIMIT 1)`, so it deletes at most one row. It is always pipeline-scoped and has no bare `IS NULL`.
- **Payload linking** is limited to opted-in Outputs: `payloadLinks(plainOutput) shouldBe Vector(None)`.
- **The D9 atomicity test is real.** The overridden `writeAction` performs the real insert and then fails. The test then asserts all three: the sentinel snapshot is intact, the payload count is 0, and the point count is 0 for both Outputs. A separate-transaction write would leave a payload behind.
- **D5.** Dry-run and blocked-run (error assert) leave 0 payloads and 0 points.
- **RLS red mutations were observed in my own run** (testFull log):
  - `MUTATION policy dropped: owner=0 grantee=0 stranger=0`
  - `MUTATION USING (true): owner=2 grantee=2 stranger=2`
  - Both are measured through the same `visibleTo` helper the committed owner=1, grantee=1, stranger=0 assertions use, so those assertions are falsifiable.
- **D8.** Public points' key set equals `{capturedAt,rowCount,summary}`, and neither the point id nor the payload id appears in the body. `PublicDashboardRoutes` gives `handled=false` for the payload path. The full ApiRoutes tree gives 401 with no `rows`/`label`. I confirmed the 401 live with curl against :9615 for both paths.
- **Purge.** It covers four predicates:
  - zero or unknown tier (fail-closed via `ANY(string_to_array)`)
  - age
  - per-node newest-N (`PARTITION BY pipeline_id,node_step_id,root_id`)
  - unreferenced

  It reuses `OutputHistoryRepository.PurgeAdvisoryLockKey` (HEL1272) under `pg_try_advisory_xact_lock`, and a failure is logged without undoing the summary purge.
- **Wiring.** Main builds the repo and config once and passes them to ApiRoutes and the retention service. ApiRoutes derives them from `dbContext` when absent.

**Issues:**
1. **CONTRIBUTING.md "Imports & Qualifiers" ("never inline a fully-qualified name when an `import` would do").** New code adds 4 inline FQNs. `check:scala-quality` does not catch them because its pattern list omits `java.sql.`/`java.time.`, but the rule still applies.
   - `backend/src/test/scala/com/helio/testsupport/NodePayloadFixtures.scala:73`: `java.sql.Timestamp.from(at)`
   - `backend/src/test/scala/com/helio/testsupport/NodePayloadFixtures.scala:84`: `java.sql.Timestamp.from(at)`
   - `backend/src/test/scala/com/helio/api/NodePayloadWiringSpec.scala:128`: `java.time.Instant.now()`
   - `backend/src/test/scala/com/helio/api/NodePayloadWiringSpec.scala:135`: `java.time.Instant.now()`

### Phase 3: UI Review — PASS
Issues: none.

The trigger matched only because of `schemas/**`. There are no frontend changes and no UI consumer of the new fields.
- I started the servers with `start-servers.sh` and `assert-phase.sh servers` returned PASS.
- The app loaded at :6708 with 0 console errors or warnings.
- Both payload paths return 401 unauthenticated.
- No UI interaction was needed, and I created no data through the UI.

**Shared-dev-DB side effect (C4).** Starting the backend applied V116 to the shared dev DB at localhost:5432/helio. The resulting `flyway_schema_history` row is installed_rank=116, version='116', description 'node payload history', checksum 561952068, installed_on 2026-10-05 22:14:20.79. The migration created the empty `node_payload_history` table (count 0) and added `output_snapshot_history.payload_id`. No other rows were created. Other worktrees on main that share this DB may now see "applied migration not resolved locally" for V116 until this merges. See MEMORY "shared dev DB Flyway collision".

### Overall: FAIL

### Change Requests
1. Replace the four inline FQNs with top-of-file imports:
   - `NodePayloadFixtures.scala`: add `import java.sql.Timestamp` and use `Timestamp.from(at)` at lines 73 and 84.
   - `NodePayloadWiringSpec.scala`: add `import java.time.Instant` and use `Instant.now()` at lines 128 and 135.

### Non-blocking Suggestions
- `NodePayloadHistoryRepository.findById`: `rowsJson.parseJson.asInstanceOf[JsArray]` is an undocumented cast. A non-array `rows` value would throw ClassCastException and return a 500, and the app-role INSERT policy does not constrain the shape. Pattern-match instead, or add `CHECK (jsonb_typeof(rows) = 'array')` in a later migration (never by editing V116).
- No test guards "trim deletes at most ONE row". A mutation that deletes all excess rows would still pass the 11-to-10 test. Consider a test that lowers the cap and asserts only one row is removed per write.
- `NodePayloadWiringSpec` uses `?token=some-share-token`, which is not a valid share token. The spec scenario says "with and without a valid share token". The public-subtree `handled=false` test covers the substance.
- `PipelineRunService.scala`: `import slick.dbio.DBIO` sits in the middle of the `com.helio` import block.
