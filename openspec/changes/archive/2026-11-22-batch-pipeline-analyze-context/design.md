## Context

See proposal.md - Why. Current state, verified at Setup (`.concertino/runs/HEL-1625/evidence/premise-validation.md`):

- `helio-mcp/src/context.ts:613` calls `api.analyzePipeline(summary.id)` (FULL shape, never `?concise=true`) per
  pipeline and reads only `steps[].position/type/outputSchema[].name/validationError` and
  `warnings[].stepId/code/message`. Workspace `concise` only changes the MCP projection.
- `GET /api/pipelines` and `/api/pipelines/context-details` are owner-only (`PipelineRepository.listSummaries`,
  `ownerId === caller`). So every pipeline the MCP analyzes is caller-owned and `PipelineAnalyzeReads.analyze`
  always takes its owner branch here (`callerIsOwner`, `ownerRootSchemas = None`, no neutral text).
- `PipelineAnalyzeReads.analyze` issues ~10+ reads per pipeline; steps/warnings depend only on: all steps
  (`listByPipelineInternal`), roots (`listRootDataSourceIdsInternal`), `rootIdsOf`, each root source as the caller
  owns it (`findByIdOwned`), secondary source schemas (`resolveSecondarySourceSchemas` via `findByIdInternal`), and
  upsert-target problems (`UpsertTargetAnalysis.problems` -> `UpsertTargetCheck.checkExisting` -> `findByIdOwned`).
- Batch helpers already exist: `PipelineStepRepository.listByPipelineInternalBatch` / `rootIdsOfBatch`,
  `PipelineRepository.listRootDataSourceIdsInternalBatch`. A JDBC `CountingDataSource` test helper exists
  (`OutputHistoryQueryCountSpec`).

## Goals / Non-Goals

**Goals:** one owner-scoped read returning each pipeline's analyze `steps` + `warnings`, provably identical to the
per-pipeline route, with a P-independent statement count; MCP uses it with a per-pipeline fallback.

**Non-Goals:** cost verdict, drift, `sourceSchemas`, `callerRole` in the batch; any change to `/analyze`; shared
pipelines in the workspace context.

## Decisions

**D1. A sibling route `GET /api/pipelines/context-analyze`, not new fields on `context-details`.** Failure isolation:
an analysis fault must not cost the steps/assertions half, and the ticket's 404 fallback maps 1:1 onto a separate
route. Cost: one more request (bound 8 + 2 + Op + D + A). Alternative (extend context-details items) saves one
request but couples two failure domains and needs a third "item present but analyze field missing" fallback.
Mounted before `PipelineRoutes` in `ApiRoutes`, next to `PipelineContextDetailsRoutes` (same segment-capture reason).

**D2. Response `{items: [{pipelineId, steps, warnings}]}`** where `steps` is `Vector[AnalyzeStepResponse]` and
`warnings` the same warning response type `PipelineAnalyzeResponse.warnings` uses, serialized by the SAME spray
formats, so per-field equality is by construction of the types. Item order = `listSummaries` order.

**D3. One shared projection, two resolver sources (identity by construction).** Extract from `analyze` a function
that, given a pipeline's steps, roots, `rootIdOfStep`, and four inputs: `rootSourceAsCaller` (`analyze` passes
`dataSourceRepo.findByIdOwned(_, user)`), `upsertTargetAsOwner` (`analyze` passes `findByIdOwned(_,
AuthenticatedUser(pipeline.ownerId))`, exactly today's `UpsertTargetCheck.checkExisting` scope), `secondarySource`
(`analyze` passes `findByIdInternal`) and the owner-view root schemas option, returns `(rootSchemas, analyzedEnabledSteps, warnings)`: it contains the existing
`nodeInputs` build, `analyzeNodes`, `UpsertTargetAnalysis.overlay`, `AnalyzeSchemaWarnings.compute`,
`nonOwnerValidity` and the enabled-step filter, unchanged. `analyze` calls it with live-repo resolvers (behaviour
unchanged; existing `PipelineAnalyzeRoutesSpec`/`StepConfigInvalidRoutesSpec`/grantee specs stay green untouched).
The batch calls it with map-backed resolvers built from prefetched rows; it may back BOTH owned resolvers with the one
`findByIdsOwned(_, caller)` map only because D5 guarantees caller == owner. Maps key on the raw (untrimmed) id the
single read would have looked up. Roots-as-caller vs upsert-as-owner are never merged inside the shared projection,
so an editor/viewer `/analyze` on an owner-owned upsert target keeps reporting no `validationError` (guard 4.3b). `UpsertTargetAnalysis.problems` and
`resolveSecondarySourceSchemas` already take/route through a resolver or repo; `problems` gains a resolver overload
(`DataSourceId => Future[Option[DataSource]]`) that the repo variant delegates to, so classification text
(`UpsertTargetCheck.classify`) is shared.

**D4. Bounded reads for the batch (P-independent).** `listSummaries` (as context-details), then for the id set:
`listByPipelineInternalBatch`, `rootIdsOfBatch`, `listRootDataSourceIdsInternalBatch`, then two new
`DataSourceRepository` batch reads: `findByIdsOwned(ids, user)` (user context + `ownerId === caller`, the exact
filter of `findByIdOwned`, covering root sources AND upsert targets) and `findByIdsInternal(ids)` (system context,
the exact filter of `findByIdInternal`, for secondaries). Ids are collected from all pipelines' steps/roots first.
Expected ~8-10 statements total regardless of P; the spec test pins equality at 10 vs 200, and measurements.md
records the actual count, wall time and body bytes at 200 pipelines on the lane DB.

**D5. Caller is the owner, asserted.** The batch passes `ownerRootSchemas = None` because every listed pipeline is
caller-owned; the implementation filters/asserts `ownerId == caller` per summary so a future widening of
`listSummaries` to shared pipelines cannot silently skip grantee shaping (a non-owned pipeline is skipped, logged,
and the MCP falls back per pipeline, which shapes correctly).

**D6. Per-pipeline fault isolation.** Each pipeline's projection runs in its own `Try`/recover; a failure omits that
item with one WARN naming the pipeline id (never step config). The MCP's existing per-pipeline path then reproduces
today's `stepsError` byte-for-byte (the HEL-1619 golden has an analyze-failure pipeline, `ANALYZE_FAILS_INDEX`). A
whole-request DB failure is `ServiceResponse`'s normal error mapping.

*Scope of the isolation (as built).* It covers failures inside a pipeline's projection or source resolution (for
example a malformed non-UUID source id). A stored step row whose config cannot be decoded is NOT isolated: every
step row is decoded in the shared batch step read (`listByPipelineInternalBatch`), so one such row fails the whole
read with a non-2xx status, exactly as `GET /api/pipelines/context-details` already fails on the same row (it uses
the same read; isolating it here alone would not restore the request budget). The MCP then falls back to
per-pipeline analyze with one stderr line, the broken pipeline's own `/analyze` fails as before, and the payload is
identical. Pinned by `PipelineContextAnalyzeUndecodableRowSpec` (a guard of the built behaviour).

**D7. MCP client.** `HelioApi.getPipelineContextAnalyze()`; `fetchContextAnalyze` mirrors `fetchContextDetails`
(self-catching promise started before the fail-fast `Promise.all`, 404 silent, other failure / no `items` array /
absent pipelines -> one stderr line naming `context-analyze`). Expected stderr per fixture mode: serve -> exactly
one "omitted 1 of N" line (the fake batch omits `ANALYZE_FAILS_INDEX`, mirroring D6); 404 -> none; 500 / malformed
-> one line; missing-one -> one "omitted 2 of N" line. The step/warning mapping now lives in one function fed
either by the batch item or by `analyzePipeline`'s body, so both paths produce the same object. Only pipelines absent
from the batch call `analyzePipeline`.

**D8. Seam and golden (HEL-1619 pattern).** New schema `schemas/pipelines/pipeline-context-analyze-response.schema.json`
as built: its own `Step` and `Warning` definitions with the same required keys and `additionalProperties: false` as
`AnalyzeStep`/`AnalyzeWarning`, and `SchemaField` reused from `pipeline-analyze-response.schema.json` by `$ref`.
Values are loosened (a warning `code` is any non-empty string; `validationError` may be `null`) because the committed
goldens fix the MCP fake's values (`code: "w"`, `validationError: null`) and goldens are never regenerated (C15);
keys cannot drift. Recorded as a deviation in measurements.md. Backend route
spec validates the real body; MCP `contextAnalyzeSeam.test.ts` validates the fixture's fake body; the fixture builds
its fake batch items FROM its own fake `/analyze` bodies so they cannot drift. Goldens are NOT regenerated: every
mode (serve, 404, 500, missing-one, malformed) must equal the committed goldens. The live probe
(`helio-mcp/scripts/contextDetailsLiveProbe.ts`) gains the new route and is run against the lane backend with 200
seeded pipelines: zero per-pipeline analyze requests, payload equal to the forced-fallback run.

**D9. Fixture parameterized by P.** `createFixture` takes `pipelineCount` (default 55, so goldens are unchanged) and
an option to hold placements fixed; the constant-in-P test compares 55 vs 200 with equal Op/D/A, and a 200-pipeline
natural fixture asserts < 120 (and > 120 for the analyze-404 fallback, the pre-change shape).

## Risks / Trade-offs

- [Refactor changes `/analyze` output] -> extraction is move-only; existing analyze specs (owner + grantee, HEL-1661/
  1799) run unmodified; batch-vs-route parity test on a rich fixture is the identity proof, red-first by mutation
  (e.g. batch resolver using `findByIdsInternal` for roots must turn the parity test red).
- [Batch by-id reads differ in scope from single reads] -> each batch method's filter copied from its single
  counterpart; RLS spec on a non-BYPASSRLS pool with owner/editor/viewer.
- [Live-backend failure modes not shared] -> per-pipeline `/analyze` can also fail in cost gathering, `findGrantRole`,
  drift baseline or `primaryOwnerViewF`, which the batch never runs; on a live backend the batch can return steps
  where the old path returned `stepsError`. Accepted (better data); "byte-identical on every path" is proven on the
  fixture, where analyze failure is modelled as the batch omitting that pipeline (D6).
- [Statement count depends on presence, not P] -> empty-id-set short-circuits make the count depend on whether any
  secondary/upsert target exists; the 10-vs-200 fixtures are same-shaped and both contain each kind.
- [Root-level step position ties] -> sibling order on ties comes from SQL row order (pre-existing nondeterminism);
  the parity fixture uses unique positions so the deep-equality is deterministic.
- [Response size at 200 pipelines] -> measured; it equals the sum of the per-pipeline bodies' steps/warnings, which
  the MCP already downloaded.
- [Old backend between HEL-1619 and this] -> 404 -> today's path; covered by the golden in 404 mode.

## Migration Plan

Additive route; no migration. helio-mcp ships from source only: the hosted MCP keeps the per-pipeline path until
`deploy-mcp.sh` is run (noted in the PR; not run here).

## Planner Notes

- Self-approved: sibling route (D1), steps+warnings subset (D2), no grantee widening. Driver claim "batch must
  reproduce grantee shaping" corrected: unreachable on the owner-only list; pinned by excluding granted pipelines and
  by D5's assertion.
- Evidence path in the ticket is stale; the in-repo HEL-1619 measurements are in the archive (see ticket.md).
