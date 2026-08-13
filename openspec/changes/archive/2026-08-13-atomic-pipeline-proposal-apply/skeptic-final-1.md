## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit reviewed: f4fe8920 on branch feature/atomic-pipeline-proposal-apply/HEL-383. Cold
review — derived every conclusion below from the actual code, migrations, a fresh `sbt
test` run, and live curl exercises of the running dev backend, not from the executor's or
evaluator's narrative.

### What I verified (with evidence)

**Ticket ACs traced to code:**
1. "Atomically creates source(if inline)+pipeline+steps and runs it, returning output
   DataType id + run summary" — `PipelineProposalService.apply`/`createPipeline`
   (`backend/src/main/scala/com/helio/services/PipelineProposalService.scala:54-65,
   246-279`), route `PipelineProposalRoutes.scala:33-44`. Live-verified: `POST
   /api/pipelines/apply-proposal` with an inline `static` source →
   `201` with `source`/`pipeline`/`outputDataTypeId`/`run` all populated, 3 rows returned
   from the run, and the created pipeline/source/type persisted (confirmed via `GET
   /api/data-sources`, `GET /api/pipelines`, `GET /api/types/:id`).
2. "No partially-created resources on any-step failure" — reproduced live for TWO distinct
   failure shapes, not just the inline branch the automated suite covers:
   - Inline `rest_api` source, schema fetch succeeds, run fails (Spark rejects
     `rest_api`/`sql`) → `422`, and the just-created source/pipeline never appear in
     subsequent `GET /api/data-sources` / `GET /api/pipelines` listings.
   - **Existing** `sourceId` (a source I created standalone via `POST /api/sources`,
     *not* via apply-proposal) referenced in a proposal that fails at run → `422`, and I
     confirmed by id that the pre-existing source is **still present** afterward (i.e.
     rollback correctly no-ops on `resolved.createdByThisCall = false` and never deletes
     a source the caller already owned going in) — `PipelineProposalService.scala:315-320`
     (`rollbackSourceOnly`). This specific combination (existing-sourceId branch + mid-apply
     failure) is **not covered by the automated ScalaTest suite** — `4.8`'s RLS case fails
     at *resolution* time (before any creation), and the three rollback-spec cases all use
     an inline source. Flagging as a non-blocking test-coverage gap below; the live
     behavior itself is correct.
3. "Composes existing services only, no direct DB writes, RLS enforced" — read every line
   of `PipelineProposalService.scala`; the only repo-level calls are read-only
   (`dataSourceRepo.findByIdOwned`, `dataTypeRepo.findBySourceId`); every create/delete
   goes through `sourceService`/`dataSourceService`/`pipelineService`/`pipelineRunService`/
   `dataTypeService`. RLS: confirmed live (a `sourceId` I don't own → the same
   `NotFound` semantics as `resolveExistingSource`'s `findByIdOwned`).
4. "SQL non-SELECT rejected up front, nothing created; source-fetch failure returned as a
   structured error, not a 500" — live: `DROP TABLE users` → `400` with the exact
   `SqlConnector.checkQuery` message; unreachable REST URL (via the ScalaTest stub
   connector, not reachable from a live curl) already asserted in
   `PipelineApplyProposalRollbackSpec` → `502` with the connector's message verbatim
   (reran this spec myself, see below). Note: D4 deliberately returns `BadGateway` +
   `ErrorResponse(message)` rather than literally reusing the create-endpoint's
   `dataType: null`/`fetchError` envelope shape — this is a considered, explicitly
   documented divergence from the AC's literal wording (design.md D4), necessitated by
   atomicity (the source is deleted by the time the error is returned, so the create
   envelope's shape — which still contains the source — cannot apply). This exact question
   was scrutinized across 4 design-gate skeptic rounds; I re-verified its premises
   (`CreateSourceEnvelope.build`'s `Left` branch never calls `dataTypeRepo.insert`) directly
   against `CreateSourceEnvelope.scala:38-44` and confirm it still holds. Not a defect.
5. "Output DataType is pipeline-bindable (sourceId null)" — live: `GET /api/types/:id`
   for the freshly-created output type has no `sourceId` field in the response.
6. "`sbt test` green" — reproduced myself, see Gates below.
7. "Backward-compat: additive only" — `git diff main...HEAD --stat` touches only new files
   plus `ApiRoutes.scala` (11 lines, all additive: one import, one service construction,
   one route mount) and `PipelineProposalProtocol.scala` (adds a case class + format,
   widens the trait's mixins). No existing route/service signature changed.

**Design.md D5 (rollback ordering) — verified against the real FK definitions, not the
design doc's paraphrase of them:**
- `pipelines.output_data_type_id ... ON DELETE CASCADE` and
  `data_types.source_id ... ON DELETE SET NULL`
  (`backend/src/main/resources/db/migration/V22__pipelines.sql:5`,
  `V4__data_sources_and_types.sql:12`) — confirms the asymmetry design.md's Context
  section claims.
- `pipeline_steps.pipeline_id`/`pipeline_runs.pipeline_id ... ON DELETE CASCADE`
  (`V23__pipeline_steps.sql:3`, `V24__pipeline_runs.sql:3`) — confirms
  `pipelineService.delete` cascades steps+runs as claimed.
- `DataTypeService.delete`'s `checkSourceLink` (`DataTypeService.scala:127-171`) no-ops
  when `dt.sourceId = None` — read directly, confirms the companion-DataType delete only
  works once the source's `ON DELETE SET NULL` has already fired, which is exactly why
  `rollbackSourceOnly` (`PipelineProposalService.scala:315-320`) deletes the source THEN
  the captured companion id(s), never re-querying `findBySourceId` post-delete.
- `pipelines.source_data_source_id ... ON DELETE CASCADE` (`V22__pipelines.sql:4`) — an
  extra fact I checked beyond design.md's own citations: deleting a source would itself
  cascade-delete any pipeline still pointing at it as `source_data_source_id`. The
  explicit `pipelineService.delete(pipelineId, ...)` step in `rollbackAll` runs BEFORE the
  source delete, so this cascade is never relied upon (redundant-but-safe, not a hazard).
- Code match: `rollbackAll` → `pipelineService.delete` → `dataTypeService.delete(output)` →
  `rollbackSourceOnly` → `dataSourceService.delete` → `dataTypeService.delete(companion*)`
  (`PipelineProposalService.scala:299-320`) — exact match to D5's stated order.

**Design.md D2 (inline-source name/config pre-validation) — verified against code and
live:** `validateInlineSource` (`PipelineProposalService.scala:100-115`) checks kind
validity → `source.name.forall(_.trim.isEmpty)` → type-matched config presence → (sql
only) `SqlConnector.checkQuery`, in that exact order. Live-verified all four guardrails
independently: missing `name` → `400 "source.name is required for an inline source"`;
missing `config` (rest_api) → `400 "source.config is required for an inline source"`;
both `sourceId`+inline `type` set → `400` with D1's exact message; non-SELECT SQL → `400`
with the DDL/DML guardrail message.

### Gates run fresh (myself, in `WORKTREE_PATH`)

- `cd backend && sbt -batch "testOnly com.helio.api.PipelineApplyProposalSpec
  com.helio.api.PipelineApplyProposalRollbackSpec
  com.helio.api.protocols.PipelineProposalProtocolSpec"` →
  **25/25 passed** (9 + 4 + 12), 3 suites, 0 failed.
- `cd backend && sbt -batch test` (full suite) → **2489/2489 passed**, 147 suites, 0
  failed/canceled, 100s. Matches the evaluator's reported count exactly.
- `npm run check:scala-quality` → clean; only pre-existing soft-budget (250-line) line-count
  warnings, including `PipelineProposalService.scala` at 340 lines (informational, not a
  gate failure) — no inline-FQN violations in any new file.
- `npm run check:schemas` → clean, no drift (37 protocol/schema pairs).
- `npm run check:openspec` → only the expected pre-archive "complete but not archived"
  notice.
- `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` → `PASS servers`
  (backend :8722, frontend :5815 both healthy).

### Phase 4 (UI/design judgment) — N/A

Backend-only diff, no frontend files touched (`git diff --name-only main...HEAD` confirms),
no existing frontend/MCP caller of the new endpoint (`grep -rn "apply-proposal"
frontend/src helio-mcp/src` only finds the pre-existing `/api/dashboards/apply-proposal`).
Nothing to screenshot or judge against DESIGN.md.

### Verdict: CONFIRM

Every acceptance criterion traces to real, independently-verified code and live behavior.
The two decisions the task brief asked me to scrutinize (D5 rollback ordering, D2 inline
name/config validation) both hold up against the actual FK migrations and live requests,
not just the design doc's own claims. `sbt test` is green (reproduced). No regression, no
scope creep, no placeholder logic.

### Non-blocking notes

1. **Test-coverage gap** (not a functional defect — verified correct live): no automated
   test exercises "existing `sourceId` branch + a mid-apply failure after pipeline
   creation" (i.e., proving the pre-existing referenced source survives rollback). All
   three `PipelineApplyProposalRollbackSpec` cases use an inline source; the one
   `sourceId`-branch rollback case (4.8) fails at resolution, before any creation. Worth a
   follow-up test asserting `dataSourceCount()` unchanged AND the specific pre-existing
   source id still resolves, for a `sourceId`+run-failure combination.
2. **Route-mount-order robustness** (`ApiRoutes.scala:368`): `PipelineProposalRoutes` is
   mounted *after* `PipelineRoutes`, so `POST /api/pipelines/apply-proposal` only reaches
   it because `PipelineRoutes`'s `path(PipelineIdSegment)` branch defines no `post` handler
   and rejects-then-backtracks (verified live — it does work today). This is the same class
   of hazard `ApiRoutes.scala`'s own `BoundPanelRoutes` comment (~line 351) calls out and
   deliberately avoids by mounting *before* the segment-matching route instead of relying on
   backtracking. Not a functional bug today, but worth either an explicit comment (mirroring
   the `BoundPanelRoutes` one) or reordering ahead of `PipelineRoutes`, so a future `POST`
   handler added to `path(PipelineIdSegment)` doesn't silently swallow this route.
3. Both items already flagged by the evaluator and independently confirmed here:
   `JsonProtocols.scala:20`'s stale "Inter-trait dependencies" comment for
   `PipelineProposalProtocol`, and `PipelineProposalService.scala`'s 340 lines vs. the
   ~250-line soft budget.
