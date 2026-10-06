## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `30ea19233006480833c813cb77e37fef2bbfc3db` (branch `feature/opt-in-payload-history/HEL-1276`).
Diff base: `d9473814f16df0c54ef76117c00ce9c071297b2b`, resolved live by `resolve-review-base.sh` (rc=0).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/opt-in-payload-history/HEL-1276`.

### What I verified (with evidence)

**Gates (I ran these myself at 30ea1923)**
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` in the worktree's `backend/` produced:
  `Total number of tests run: 6015`, `Suites: completed 424, aborted 0`, `Tests: succeeded 6015, failed 0`,
  `All tests passed.`, EXIT=0.
  - FirstRunRoutesSpec ran to completion. The log has no timeout and no "Java heap space".
  - Every new spec ran: NodePayloadHistoryWriteSpec, NodePayloadHistoryRetentionSpec, NodePayloadHistoryRlsSpec,
    NodePayloadWiringSpec, OutputHistoryPayloadRoutesSpec, OutputHistoryPayloadPublicRoutesSpec,
    PayloadHistoryConfigSpec, PayloadOptInWriteValidationSpec, and the updated RlsPolicyGuardSpec,
    RlsPrivilegedDmlSpec and FlywayNonSuperuserMigrationSpec.
  - `sbt --client shutdown` was run afterwards as a separate call.
- `node scripts/check-node-root-encoding.mjs` reported clean (3 files). Its selftest passed every case.
- `npm run check:schemas` printed "schemas in sync with JsonProtocols (121 checked …)", rc=0.
- `npm run check:scala-quality` printed clean (soft warnings only).

**Red mutations against the COMMITTED assertions**
I ran these in a throwaway detached worktree at 30ea1923, then removed it by exact path. `git worktree list` shows no
straggler.

Run 1 applied these mutations together. Each fails a distinct test.

| Mutation | Committed test that went red |
|---|---|
| V116 `node_payload_history_select` changed to `USING (true)` | NodePayloadHistoryRlsSpec "show a non-grantee zero rows": `1 was not equal to 0 (…RlsSpec.scala:124)` |
| V116 `FORCE ROW LEVEL SECURITY` removed | RlsPolicyGuardSpec "node_payload_history has relforcerowsecurity = true": `Left("… relforcerowsecurity is false")` |
| `writeAction` tier gate removed (`case Some(limit) =>`, keep `max 1`) | "write NOTHING for a free-tier owner …": `1 was not equal to 0 (WriteSpec.scala:93)`. Also "log NO over-cap WARN for a free-tier …" |
| Row cap neutralised (`maxRows * 1000`) | "store no payload over the row cap …": `1 was not equal to 0 (WriteSpec.scala:124)` |
| Byte cap measured as `String.length` | "measure compact-JSON UTF-8 BYTES …": `59 was not greater than 59 (WriteSpec.scala:144)` |

Run 1 totals: 130 succeeded, 6 failed, EXIT=1.

Run 2 added one more mutation: the payload write was made best-effort (`.asTry.map(_.toOption.flatten)` before linking).
That is a D9 violation. The test "roll back the node's snapshot replace and its summary insert" went red:
`false was not equal to true (WriteSpec.scala:189)`.

So the size-cap, free-tier, transactional (D9) and non-BYPASSRLS RLS proofs can all fail. They are not vacuous.

**Acceptance criteria traced to code**

1. **Transactional write (D9).**
   - `PipelineRunService.scala` ~1457-1466 composes `nodePayloadRepo.writeAction(...).flatMap(pid => outputHistoryRepo.insertAction(...))` as the `andThen` of `nodeSnapshotRepo.overwriteRowsWith`.
   - `overwriteRowsWith` runs `ctx.withSystemContext(overwriteRowsAction(...).andThen(andThen))`.
   - `withSystemContext` is `privilegedDb.run(action.transactionally)` (`DbContext.scala:63-64`).
   - So one transaction covers the write. The atomicity test proves it, and that test goes red under the best-effort mutation above.
2. **D5 run filter.**
   - The payload path is reachable only inside the existing succeeded-run, history-writing branch (`materializedWrites`, after the `succeeded` publish).
   - WriteSpec covers "write nothing for a dry run" and "… a blocked run (error-severity assertion fails)". Both are green.
3. **Sharing-aware RLS.**
   - V116 makes the table ENABLE+FORCE, with four policies on `helio_can_access_pipeline(pipeline_id)` and an explicit `GRANT … TO helio_privileged`.
   - It is registered in RlsPolicyGuardSpec, RlsPrivilegedDmlSpec and FlywayNonSuperuserMigrationSpec (forceRlsTables).
4. **Privileged-pool access behind `outputRepo.findById`.**
   - `OutputHistoryService.payloadRows` calls `outputRepo.findById(id, user)` first. `None` returns `NotFound("Output not found")`, the same as for an unknown id.
   - Next it calls `historyRepo.findPoint(outputId, pointId)`, which is scoped to `id AND output_id`.
   - Then it calls `payloadRepo.findById`.
   - The last two run under `withSystemContext`.
5. **Size-cap test.**
   - Tests: "store no payload over the row cap …", "store exactly at the row cap", and the multi-byte byte-cap test, which covers the exact cap and the cap minus 1.
   - All three are red under mutation, as shown above.
   - The order is the tier check, then the row check, then serialising and measuring the bytes (`NodePayloadHistoryRepository.writeAction`). This matches C1 (no truncation, WARN, summary still written) and ruling Q1 `1mib-skip`.
6. **"Free tier writes nothing" test.**
   - "write NOTHING for a free-tier owner even when opted in, while still recording the summary point".
   - It is red under mutation, as shown above.
7. **Non-BYPASSRLS RLS proof, two-role topology.**
   - NodePayloadHistoryRlsSpec asserts that `helio_app_test` has `rolsuper OR rolbypassrls = false`, and that `helio_privileged` is a separate BYPASSRLS role.
   - Owner and grantee each see 1 row. The stranger sees 0.
   - INSERT with no context and INSERT by the stranger are both rejected "by row-level security policy".
   - The committed assertion is red under `USING (true)`, as shown above.
8. **Public dashboards never receive payloads.**
   - `PublicDashboardRoutes` is not in the diff, and no file under `api/routes/dashboards/` changed in `src/main`.
   - `PublicOutputHistoryPoint` and its writer are unchanged. The public spec asserts the point key set is exactly `{capturedAt,rowCount,summary}`, with no point id or payload id in the raw body.
   - The public sub-tree does not handle `/history/<realPointId>/rows`.
   - In NodePayloadWiringSpec, the full `ApiRoutes` tree returns 401 with no row data, for an anonymous request and for one carrying only a real, valid share token (its SHA-256 hash is stored in `share_tokens`).

**Owner rulings and constraints**
- Q1 `1mib-skip` and Q2 `output-config` appear in `.concertino/runs/HEL-1276/events.jsonl` (line 5, `escalation.answered`, `answer_source: human`). The implementation matches both: 1 MiB skip, and `config.historyPayloads`.
- Opt-in validation is chained at both write paths: `OutputService.validateConfig` and `PipelineService` around line 684. PayloadOptInWriteValidationSpec covers POST, PATCH and single-call create.
- **HEL-1285 is not settled.** Thinning and `forOutput`/`previous_run` resolution are untouched (a grep of the main diff finds no `previous_run` or `1285`). The payload purge only deletes payloads that no point references, so it takes no position on which point is "previous".
- **Untouched files.** `git diff --name-only d9473814...HEAD` lists none of `NodeSnapshotRepository.scala`, `BinaryRefRepository.scala`, `.github/workflows/ci.yml` or `playwright.config.ts`, and `git log` over those paths in the range is empty. V115 is also unchanged.
- **Production wiring (C5).**
  - `Main.scala` builds `NodePayloadHistoryRepository(ctx)` and `PayloadHistoryConfig.fromEnv()` once.
  - It passes both into `ApiRoutes` (`nodePayloadHistoryRepo = …`, `payloadHistoryConfig = …`) and into `OutputHistoryRetentionService(…, nodePayloadHistoryRepo, payloadHistoryConfig)`. Those retention-service parameters are non-defaulted.
  - `ApiRoutes` threads `nodePayloadHistoryRepoOpt.orNull` and `payloadHistoryConfig` into `PipelineRunService`, and builds `OutputHistoryService(outputRepo, historyRepo, payloadRepo)`. If a DbContext is present, it derives the repo from it.
  - NodePayloadWiringSpec builds `ApiRoutes` with only `dbContext`. A real `POST /api/pipelines/:id/run` then stores a payload that the rows route serves.
- **V116 is still the next free migration.** On `origin/main` (77bdaec8) the newest migration is `V115__output_snapshot_history.sql`.
- **The branch merges cleanly into current main.** `git merge-tree --write-tree origin/main HEAD` produced a tree with no conflicts.
  - origin/main's HEL-1287 `TestShards` gives unknown suites the median weight, so the new specs are sharded rather than rejected.
  - HEL-1275's frontend `HistoryPoint` does not validate against the history schema, and `PATCH` shallow-merges config, so a UI save keeps `historyPayloads`.
- **CLAUDE.md** is touched only to add the `PAYLOAD_HISTORY_*` env-var rows. The rest of the diff is Prettier re-padding the table columns.

**UI:** there are no `frontend/**` changes in the diff, so step 4 does not apply. I started no servers.

**Shared dev DB:** I created no rows. Every test ran on EmbeddedPostgres.

### Verdict: CONFIRM

### Non-blocking notes
- `openspec/changes/node-payload-history/evaluation-2.md` is untracked in the worktree. It should be committed with the archive step.
- The branch sits on d9473814, two commits behind origin/main (HEL-1287, HEL-1275). The merge-tree is clean, but the first full post-merge CI run will be the first time these specs run under HEL-1287's 4-shard backend layout.
- The evaluator's suggestion still stands: use `TokenHashing.sha256Hex` in NodePayloadWiringSpec instead of a hand-rolled SHA-256.
- The shared session scratchpad already contained other agents' artifacts. My gate log was written to `scratchpad/testfull.log`, and if another agent had a file by that name, mine overwrote it. My mutation logs are `scratchpad/sk1276-mut.log` and `scratchpad/sk1276-mut2.log`.
