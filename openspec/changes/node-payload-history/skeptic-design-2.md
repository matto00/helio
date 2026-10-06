## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD d9473814f16df0c54ef76117c00ce9c071297b2b. The change dir is untracked, so I read the artifacts from disk: ticket.md, proposal.md, design.md, tasks.md, specs/node-payload-history/spec.md and specs/output-history-api/spec.md.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/opt-in-payload-history/HEL-1276`.
- **Owner rulings.** `.concertino/runs/HEL-1276/events.jsonl` line 5 is `escalation.answered` with `sub_answers ["1mib-skip","output-config"]` and `answer_source: human`. These are settled. C1 and C2 in tasks.md match them.
- **Round-1 change requests are resolved.**
  - CR1: D-7 and task 5.2 add `id` and `hasPayload` to the authenticated `OutputHistoryPointResponse` only. Today it is `(capturedAt, runId, triggerSource, rowCount, summary)` (OutputHistoryProtocol.scala:12). The MODIFIED `output-history-api` delta adds the "Point ids resolve on the payload route" scenario, and task 6.6 asserts it.
  - CR2: task 5.3 adds the new payload response schema and `config.historyPayloads` in all three request schemas. I checked those three `config` objects. None sets `additionalProperties: false`, so the change documents the flag without breaking existing writes. The new response schema needs a `title` that matches a case class, because `scripts/check-schema-drift.mjs` (lines 136-146) maps schemas to case classes by title. `npm run check:schemas` will enforce that.
  - CR3: task 6.7 and the two new public scenarios are now concrete: no `id`/`hasPayload`/`payloadId`/`rows` key on public points, and anonymous and token requests to `/history/<realPointId>/rows` return 404.
- **V116 is free.**
  - `origin/main` tops out at `V115__output_snapshot_history.sql`.
  - None of the open PRs (779, 774, 773, the dependabot bumps, 266) touches a migration path.
  - The sibling worktrees (HEL-1275, 1287, 1288) carry no migration.
- **D9 seam.**
  - `NodeSnapshotRepository.overwriteRowsWith(..., andThen: DBIO[Unit])` (lines 113-120) runs `overwriteRowsAction.andThen(andThen)` in one `withSystemContext`.
  - `DbContext.withSystemContext` is `privilegedDb.run(action.transactionally)` (DbContext.scala:63-64).
  - `payloadAction.flatMap(pid => insertAction(...))` is a `DBIO[Unit]`, so it composes without editing either HEL-1282-guarded file.
  - `scripts/check-node-root-encoding.mjs` lines 49-51 scan only `OutputRepository`, `NodeSnapshotRepository` and `BinaryRefRepository`, so the new repository file is out of scope. D-3 still requires the explicit `node_step_id IS NULL AND root_id = ?` predicate.
- **D5 run filter.**
  - Only line 1290 calls `onUnblockedRunSuccess`, after the blocked and write-back-failure branches (PipelineRunService.scala:1278-1291).
  - Dry runs exit at line 1185 through `onDryRunSuccess`.
  - The other per-node writer near lines 671-797 calls plain `overwriteRows` and never records history.
  - The payload path is nested inside the summary path, so D5 is inherited.
- **Opt-in validation coverage.**
  - `OutputService.validateConfig` (line 459-460) is reached from create (120), update (231) and `PatchSetPreviewProjection` (136).
  - `PipelineService.validateOutputFieldMapping` (684) covers single-call create and proposal grounding.
  - Chaining at those two sites covers every validating write path.
  - `mergeConfig` (OutputService.scala:465-473) is a top-level key merge, so a UI edit that omits `historyPayloads` does not clear an API-set opt-in.
- **RLS, FK and prod Flyway.**
  - V115 is ENABLE+FORCE, has four `helio_can_access_pipeline` policies and an explicit GRANT to `helio_privileged`. D-1 mirrors it.
  - `pipelines.id` is TEXT (V22), which matches the planned FK type.
  - The `ALTER TABLE output_snapshot_history ADD COLUMN payload_id ... REFERENCES node_payload_history ON DELETE SET NULL` runs as `helio`. That role owns both tables in prod, and the new all-NULL column validates trivially.
  - RI checks and actions run as the table owner and bypass RLS. So a privileged-pool payload delete can SET NULL rows in FORCE-RLS `output_snapshot_history`, and `helio_privileged` needs no REFERENCES grant.
  - Registration sites exist: `RlsPolicyGuardSpec.scala:87-88`, `RlsPrivilegedDmlSpec.scala:143/276`, and `FlywayNonSuperuserMigrationSpec.scala:342` (the FORCE list). `OutputHistoryRlsSpec.scala` is the two-role precedent for task 6.5.
  - Task 6.5 requires the red (dropping the policy lets the stranger see the row).
- **Tier caps vs L2.**
  - `thinAndPurge` (OutputHistoryRepository.scala:92-145) resolves tier through `pipelines.owner_id -> users.tier` and fails closed for unnamed tiers. D-5 mirrors that and adds its own advisory key.
  - The unreferenced-payload purge runs after thinning, and the Planner Notes warn that L7 must not assume N consecutive runs.
  - Nothing defines 'previous' (HEL-1285 untouched).
- **D8 public isolation.**
  - The public history route is `pathPrefix(Segment / "history") { pathEndOrSingleSlash ... }` (PublicDashboardRoutes ~412-413), so `/history/<id>/rows` cannot match and falls through.
  - `PublicOutputHistoryPoint(capturedAt, rowCount, summary)` (OutputHistoryProtocol.scala:28, 55) is a separate allow-list type, and D-7 leaves it unchanged.
- **Authenticated route.**
  - The existing `path("history")` (OutputRoutes.scala:89) needs path-end, so `path("history" / JavaUUID / "rows")` does not collide with it.
  - Authorization via `findById` plus a point lookup by `id AND output_id` makes a foreign point 404.
- **Contract mirror.** `helio-mcp/src/types.ts:256-276` mirrors the history response, but TS structural typing means the new fields are additive and nothing breaks. See the non-blocking notes.

### Verdict: REFUTE

### Change Requests

1. **No task wires the new repository and config into the production composition root. As planned, every listed test can pass while production never writes or purges a payload.**

   **What production wiring looks like today:**
   - `Main.scala:152` constructs `OutputHistoryRepository`.
   - `Main.scala:272` passes it to `ApiRoutes`.
   - `ApiRoutes.scala:253-254` derives it from `dbContext` when it is absent and hands it to `PipelineRunService`. That class takes it as `outputHistoryRepo: OutputHistoryRepository = null` (PipelineRunService.scala:83) and null-checks it at runtime.
   - `Main.scala:282-283` builds `new OutputHistoryRetentionService(outputHistoryRepo, OutputHistoryRetentionConfig.fromEnv(), SystemClock)`. Its constructor (OutputHistoryRetentionService.scala:18-22) takes only that one repository.

   **What the plan leaves open:**
   - D-3 adds a `NodePayloadHistoryRepository` and a `PayloadHistoryConfig` to the run write path.
   - D-5 makes `OutputHistoryRetentionService` call a payload purge.
   - D-6 adds `OutputHistoryService.payloadRows`.
   - Neither proposal "Impact", design nor tasks names `Main.scala` or `ApiRoutes.scala`.

   **Why the listed tests miss it:**
   - The house pattern is a defaulted `= null` constructor parameter.
   - Tasks 6.1, 6.2, 6.4 and 4.1 construct services directly, so they go green even if `Main` never passes the repo, the config or the retention dependency.
   - The result would be a feature that is dead in prod (no payload written, no retention purge, and payloads that outlive a tier downgrade forever if writes are wired but purge is not).
   - This repo has already shipped this exact defect once: HEL-466, commented at Main.scala:157-159 as "HEL-455 left this unconstructed, so /api/alerts and the evaluation engine were both unreachable in production".

   **Required revision:**
   - Add a task, and list `Main.scala` and `ApiRoutes.scala` in proposal Impact. The task should:
     - construct `NodePayloadHistoryRepository` and `PayloadHistoryConfig.fromEnv()` once in `Main`,
     - thread them into `ApiRoutes`, then into `PipelineRunService` and `OutputHistoryService`, deriving from `dbContext` when absent as `outputHistoryRepoOpt` does,
     - pass them to `OutputHistoryRetentionService` at Main.scala:283.
   - Give it an acceptance signal that fails if the wiring is missing, either of:
     - (a) the retention service takes the payload dependency as a **non-defaulted** parameter, so `Main` cannot compile without it, and the run-path dependency is likewise non-optional or derived inside `ApiRoutes`, or
     - (b) a test drives a real run through an `ApiRoutes` built the way `Main` builds it (dbContext only, no hand-injected payload repo) and observes a stored payload. A retention test likewise builds the service the way `Main` does.

### Non-blocking notes

- **Write-path trim vs the retention purge.** The trim DELETE on `node_payload_history` runs inside the run transaction. That transaction can contend with the payload purge (different advisory key, not serialized against run writes) and with `thinAndPurge`, through the SET NULL cascade onto `output_snapshot_history`.
  - It is only a deadlock risk when the trim deletes two or more rows, for example after a tier cap is lowered.
  - A deadlock victim on the run side fails the node, and therefore the run (D9).
  - Consider deleting in a deterministic order (`ORDER BY id`), or leaving multi-row excess to the purge.
  - Either way, have task 6.4 or the PR body state the outcome.
- **Free-tier cost.** For a free-tier opted-in node, D-3 builds and measures the array before `writeAction` discovers the tier cap is 0. That costs up to about 1 MiB of serialization per run for nothing, and can log a spurious over-cap WARN. Doing the tier lookup first, or suppressing the WARN when the tier cap is 0, would avoid both.
- **Test teardown.** The new FK chain (`node_payload_history` -> `pipelines`, `output_snapshot_history` -> `node_payload_history`) can break test fixtures that TRUNCATE a referenced table without CASCADE. Expect to update table lists in test teardown helpers.
- **MCP type mirror.** `helio-mcp/src/types.ts` `OutputHistoryPoint` claims to mirror `output-history-response.schema.json`. Adding `id` and `hasPayload` there keeps the mirror honest. There is no compile impact either way.
- **Measurement test.** The Risks section promises a storage measurement test "like L1's cost spec", but no task carries it. Either add it to task 6.2 or drop the claim.
- **Parallel lane.** HEL-1275 (PR 779) consumes the history response in the frontend (`frontend/src/features/panels/history/*`). The new required `id`/`hasPayload` fields are additive for TS consumers. Re-check after rebase if 779 merges first.
- **Gate-defect check (CON-160).** Not applicable: no evidence directories or mtime-ordering claims were involved.
