## Context

See proposal.md (Why). Measured on main db91c840e (evidence `.concertino/runs/HEL-1619/evidence/`): 339 requests,
peak 220 in flight, on 55 pipelines x 2 Outputs (19 placed, 1 dashboard). Per pipeline today:
`analyze`, `run-history`, and `getPipeline` = `GET /api/pipelines/:id` + `GET /api/pipelines/:id/steps`
(helioApi.ts:310-316; context.ts:592 reads only `steps`). Per Output: `GET /api/outputs/:id/panels`.
Owner ruling (escalation `HEL-1619-1792162665086-c148d1`, answered `B-identical-plus-backend-batch`): trims +
one additive backend read + bounded pool, byte-identical MCP payload, 404 fallback, no existing response changes.

## Goals / Non-Goals

**Goals:** ≤120 requests at 55 pipelines (target ~84 = 8 + 1 + 55 + 19 + 1); bounded in-flight; payload identical.
**Non-Goals:** batching `analyze`; any payload or existing-route change; cross-call pacing.

## Decisions

D1. Route `GET /api/pipelines/context-details` in a NEW route class
`PipelineContextDetailsRoutes(pipelineService, pipelineRunService, user)`, concatenated in ApiRoutes BEFORE
`new PipelineRoutes(...)` (ApiRoutes.scala:946), because `PipelineRoutes`' unconstrained `path(PipelineIdSegment)`
GET would otherwise swallow `context-details` (same reason as `analyze-proposal`, PipelineRoutes.scala:41-44).
Chosen over widening `PipelineRoutes`' or `PipelineService`'s constructors: no existing constructor or fixture
changes. Ownership split: `PipelineService.contextStepsForOwner(user)` (listSummaries + batched steps + the
`/steps` mapper) and `PipelineRunService.latestAssertionsFor(ids)` (batched latest run + assertions, implemented
in `PipelineRunQueries` reusing the private `summarizeAssertions` directly — no visibility change, never a copy).
When `pipelineRunRepo` is null (fixtures), `latestAssertionsFor` returns an empty map, so every item omits
`latestRunAssertions` — matching `history` returning empty in the same wiring. The route stitches the two.
Alternative `GET /api/workspace/context` aggregate rejected: not field-compatible (no `lastRunAssertions`,
placements, `pipelineShapes`) and it fetches sample rows/column stats per Output, which is far heavier.

D2. Scope = `pipelineService.listSummaries(user, None)` (the exact set `GET /api/pipelines` returns: OWNER-scoped,
`ownerId === user`, PipelineRepository.scala:653-660 — grantee-shared pipelines are NOT listed there, so they are
not in this read either; the MCP only iterates `listPipelines`, so nothing is lost). Only those ids are then passed to ACL-bypassing `*InternalBatch` reads, mirroring the run-history
pattern (PipelineRunQueries.scala:90-115: access confirmed first, then system-context reads keyed by confirmed ids).
No id from the request is trusted; the endpoint takes no parameters.

D3. `steps` built by the SAME code path/serializer that `GET /api/pipelines/:id/steps` uses (PipelineStepRoutes),
fed by `listByPipelineInternalBatch` + `rootIdsOfBatch` (PipelineService.scala:171-179) or whatever the steps route
uses to fill `rootId` — the executor must trace the steps route and reuse its mapper, not re-derive fields.
Parity is asserted by a test that deep-equals both reads on a branched, multi-root pipeline.

D4. `latestRunAssertions`: for each pipeline, the run first in `listByPipelineInternal`'s order
(`startedAt desc`, any status, dry included — PipelineRunRepository.scala:543-549), summarized with the existing
`summarizeAssertions`. Implemented as one batched query (latest run per pipeline id) + one batched assertion fetch
for those run ids — not N per-pipeline queries. Omitted (spray-json `Option = None`) when the pipeline has no runs. Every
listed pipeline gets an item even with zero steps (`steps: []`) — a missing item would push the MCP into fallback.
Orderings that fall back to row order today (same-position sibling steps, assertion `failures[]`, equal `startedAt`)
must use the identical query ordering as the per-pipeline reads; parity tests cover a multi-root pipeline and a run
with >=2 failures (`listAssertionsByRunInternal` has no ORDER BY, so the batched assertion read must apply the
same — or a strictly stronger, history-compatible — ordering; the 4.2 parity test is the guard). In the schema,
`latestRunAssertions` must NOT be listed as required. `latestAssertionsFor(ids)` lives in `PipelineRunQueries`
(so `summarizeAssertions` needs no visibility change) and is documented "caller must have confirmed access to ids".

D5. Response `PipelineContextDetailsResponse(items: Vector[PipelineContextDetailsItem])`, schema
`schemas/pipelines/pipeline-context-details-response.schema.json`. No step schema exists under
`schemas/pipelines/`, so the step shape is inlined; the assertion summary `$ref`s the existing definition in
`pipeline-run-record.schema.json` if that file exposes one, else is inlined. The envelope, item and step objects
set `additionalProperties: false` so a renamed key fails validation (D10). No migration expected; if one turns out to be needed (e.g. an
index), take the next free Flyway version after V135 and confirm no open branch/PR holds it.

D6. MCP: new `HelioApi.getPipelineContextDetails()`; REUSE the existing `HelioApi.listPipelineSteps(id)`
(helioApi.ts:853-856) for the fallback.
`buildWorkspaceContext` starts the batched read concurrently with the four core lists, NOT inside the fail-fast
`Promise.all`, self-`catch`ed (HEL-1617 orphaned-rejection lesson). On any failure → per-pipeline fallback for every
pipeline; a pipeline absent from `items` → per-pipeline fallback for that pipeline. Per-pipeline fallback =
today's semantics, but `laneTree` uses `listPipelineSteps` instead of `getPipeline` (drops the redundant summary
GET; `getPipeline` itself is unchanged for its other callers). Mapping from batch: `laneTree` from `steps` exactly
as context.ts:592-607; `lastRunAssertions = item.latestRunAssertions ?? ZERO_ASSERTION_SUMMARY` — identical to
`history[0]?.assertions ?? ZERO` (context.ts:582).

D7. Placements skip: `GET /api/outputs` items carry `panelCount` (OutputRoutes.scala:218-221) from
`PanelRepository.countByOutputIdsInternal` (same `panels.output_id = id`, system-context predicate as
`findByOutputIdInternal`, which `GET /api/outputs/:id/panels` uses — PanelRepository.scala:189-209), so
`panelCount === 0` ⇔ the panels read returns `[]` for the same snapshot. Skip only on `=== 0`; absent → call.
Add `panelCount?: number` to `OutputResponse` in types.ts if missing.

D8. Bounded pool: a small local `mapWithConcurrency(items, limit, fn)` preserving input order (no new dependency),
default limit 6, shared by ONE limiter instance per `buildWorkspaceContext` call across the per-pipeline
(analyze + fallback) and per-Output (placements, snapshot) fan-outs, so the cap is per call not per fan-out.
Requests outside the limiter: the 8 fixed calls + batched read (≤ 9 concurrent at start). Documented cap = 6 + the
initial fixed group; the test asserts peak ≤ 6 after the fixed group, or the executor documents the exact measured
bound. Note: `controlsFor` awaits a deduped snapshot promise inside a placements task — guard against
pool-deadlock (a task holding a slot while waiting for a task queued behind it). Either run snapshot loads outside
the limiter's slot accounting or acquire per HTTP request, not per task. Must be tested.

D9. Byte-identical proof: commit a golden JSON produced by the PRE-change `buildWorkspaceContext` on the 55-pipeline
fixture (full and concise; `generatedAt` stripped) — generated from main's code before editing, with the command
recorded. Tests then assert the new code reproduces it on (a) batch path, (b) 404-fallback path, (c) batch path with
one pipeline missing. The fixture must exercise: branched/multi-root steps, a pipeline with assertions failing, one
never run, one whose analyze fails (stepsError), Outputs with/without panels, panel controls.

D10. Seam contract (the silent-fallback risk): because D6 falls back silently, a key-name/envelope mismatch
between the MCP's expectation and the backend's body would keep every MCP test green while production falls back
for every pipeline (~284 requests). Two guards, both required: (a) the MCP test's fake `context-details` body is
validated against the committed schema (ajv via `ajv/dist/2020`, loading `pipeline-run-record.schema.json` for the
cross-file `$ref`; declare ajv as a helio-mcp devDependency if only transitive — the root ajv 6.x cannot do 2020-12) AND the backend spec validates the real route response against the same schema; (b) a live seam
probe: real helio-mcp `HelioHttpClient`/`buildWorkspaceContext` against the worktree backend (port 9958) with a
seeded multi-pipeline user, recording per-route request counts and showing zero `/steps` and zero `/run-history`
requests, persisted as evidence. Each guard must be shown red once with one key name mutated (mutation transcript
in evidence). Also: the MCP emits a one-line stderr warning when it falls back for a reason other than 404, so a
production mismatch is visible.

## Risks / Trade-offs

- [Analyze remains O(P)] → beyond ~100 pipelines one call exceeds 120 again; stated in README and as a follow-up.
- [Old server] → 404 fallback costs today's volume minus the summary GET; no worse than now.
- [Race: panel bound between `/api/outputs` and skip] → same snapshot-staleness class as today's parallel reads.
- [Pool raises latency] → cap 6 at ~tens of ms per request keeps a 84-request call well under a second locally.
- [RLS parity gap] → RLS test via `TwoUserRlsApiFixture` (non-BYPASSRLS `helio_app_test` pool), not only superuser.
- [dist not rebuilt on merge] → helio-news keeps the old volume until `helio-mcp/dist` is rebuilt; flagged in report.

## Planner Notes

- Self-approved: route name `context-details`; pool default 6; no env var for the pool size.
- Premise correction: per-pipeline cost is 4, not 3 (getPipeline is two GETs).
