## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Verified against ticket.md ACs and specs/*/spec.md:
- One `POST /api/panels/bound` call creates-or-reuses source, creates+runs pipeline, creates the
  panel, binds it, returns all four ids with rows already present — confirmed in
  `BoundPanelService.scala` execution chain (`resolveSource` -> `createPipeline` -> `addSteps` ->
  `runPipeline` -> `createPanel`) and exercised by `BoundPanelRoutesSpec`'s happy-path test
  (asserts `dataTypeRowRepo.listRows` has rows immediately, no separate run call).
- V41 pipeline-only binding: `injectBinding` (BoundPanelService.scala:272-276) always overwrites
  `panel.config.dataTypeId` with the freshly created pipeline output id before calling
  `panelService.buildForCreate`, so a caller-supplied `dataTypeId` can never reach
  `rejectCompanionBinding` — confirmed true in code (not just claimed), and the
  "ignore a caller-supplied panel.config.dataTypeId" regression test proves it. tasks.md is
  transparent about this being a by-construction proof rather than a runtime-rejection test — an
  honest, documented interpretation, not a silent reinterpretation of the AC.
- 4xx/5xx naming the failed stage, no dangling bound-to-null panel: `stageError` tags every
  failure branch with `[source|pipeline|steps|run|panel]`; cleanup runs from every failure branch
  from "pipeline" onward per design.md D5.
- `appearance` (including `chart.chartType`) applied at creation with no separate call —
  `createPanel` passes `request.panel.appearance` straight into `CreatePanelRequest.appearance`,
  resolved by the existing `buildForCreate` appearance-resolve path (same as `POST /api/panels`).
- ScalaTest coverage: happy path, reuse-existing-source, V41-by-construction, unsatisfiable-binding
  + non-bindable-type rejections, steps-stage failure (inline + reused source variants), run-stage
  failure, cross-tenant 404, zero-row success — 10 cases in `BoundPanelRoutesSpec`, matches
  files-modified.md's own count.
- MCP `create_bound_panel` tool added, documented, wraps the endpoint with no client-side
  composition (`helio-mcp/src/helioApi.ts#createBoundPanel` makes exactly one `POST`).
- All 20 tasks.md items checked and match what was actually implemented; deviations (task 4.2's
  "openspec path" interpretation, task 6.7's live e2e harness instead of a nonexistent Jest write-
  tool suite) are documented inline with justification, not silently absorbed.
- No regressions: `PanelCapabilityServiceSpec` (pre-existing, testing the extracted
  `PanelBindingSpec.evaluate` behavior-preservation) passes unmodified — 6/6 green. Full backend
  suite (2091 tests) and full frontend suite (1423 tests) green — see Phase 2 gate results.
- Schemas (`schemas/bound-panel-{request,response}.schema.json`) match the wire types exactly;
  `check-schema-drift.mjs` confirms sync.
- Scope discipline: grepped the full diff for batch/tagging/auto-pack/panel-id-key content (HEL-
  370/366/367/368) — none found. Change is confined to the compound op + MCP tool + contracts.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Canonical code-quality compliance**: `npm run check:scala-quality` reports 0 hard failures (the
  no-inline-FQN mechanical rule is clean across all new files — independently grepped
  `BoundPanelService.scala`/`BoundPanelRoutes.scala`/`BoundPanelProtocol.scala` for inline
  `com.helio.`/`org.apache.pekko.`/`spray.json.` qualifiers outside imports — zero hits). File-size
  soft-budget warnings (`BoundPanelService.scala` at 374 lines) are informational per
  `CONTRIBUTING.md:123` ("File-size warnings ... are informational only") and below the 400-line
  "propose a split" trigger (`CONTRIBUTING.md:24`) — not a violation.
- **DRY**: `PanelBindingSpec.evaluate` extraction (task 1.2) is a genuine single-implementation
  consolidation — `PanelCapabilityService.capabilityFor` now delegates to it
  (PanelCapabilityService.scala:101) instead of duplicating the required-slot/eligible-column
  logic. Confirmed behavior-preserving: `PanelCapabilityServiceSpec` passes unmodified (6/6).
- **Readable / Modular**: `BoundPanelService`'s execution chain is a straightforward five-stage
  Future pipeline (`resolveSource -> createPipeline -> addSteps -> runPipeline -> createPanel`),
  each stage a small function with one failure branch calling `cleanup` + `stageError`. Route is a
  thin shell (`BoundPanelRoutes.scala`, 38 lines) with zero business logic.
- **Type safety**: no untyped escape hatches; `JsValue`/`JsObject` usage is confined to the existing
  opaque-config convention this codebase already uses everywhere (`panel.config`,
  `step.config`) — consistent with prior art, not new laxity.
- **Error handling**: `unexpected[A]` converts any raw `Future` failure into a generic 500 (HEL-311
  discipline — never echoes a raw exception); `stageError` prefixes every curated `Left` with its
  stage without altering the underlying status code. Cleanup failures are logged and swallowed
  (never rethrown over the original error) per design.md D5's explicit requirement.
- **Tests meaningful**: `BoundPanelRoutesSpec`'s 10 cases assert on real DB state after each
  scenario (row counts via `dataSourceRepo.findAll`/`pipelineRepo.listSummaries`/
  `dataTypeRowRepo.listRows`), not just HTTP status codes — would catch a real cleanup regression.
- **No dead code**: no unused imports, no leftover TODO/FIXME in the new files.
- **No over-engineering**: no premature abstraction; `Gate` case class is a minimal carrier for
  validated state, not a speculative framework.
- **Verification gates independently re-run** (not trusting the executor's self-report):
  - `node scripts/check-schema-drift.mjs` — clean (23 protocol files checked).
  - `npm run check:openspec` — reports the change "complete (20/20) but not archived", exactly the
    expected pre-archive state called out by the orchestrator brief, not a defect.
  - `npm run check:scala-quality` — clean (0 hard failures, 65 pre-existing soft file-size warnings
    across the whole codebase, informational only).
  - `npm run format:check` — clean.
  - `npm run lint` — clean (zero-warnings policy).
  - `sbt test` (full backend suite) — **2091/2091 passed**, 0 failed.
  - `npm test` (root Jest + frontend Jest) — **1423/1423 frontend tests passed** (no root-level
    tests; `--passWithNoTests`).
  - `helio-mcp`: `npx tsc --noEmit` — clean, no type errors.

**Non-blocking finding worth surfacing** (see Non-blocking Suggestions): `PipelineRepository.create`
(pre-existing, unmodified by this ticket) performs the output-DataType insert and the pipeline-row
insert as two sequential, non-transactional Slick actions. `BoundPanelService.createPipeline`'s
failure branch assumes a `pipelineService.create` failure means "nothing else exists yet"
(`cleanup(outputDataTypeIdOpt = None, ...)`), which is only true if that pre-existing method is
atomic — it verifiably is not. This is a narrow, pre-existing gap (not introduced by this ticket's
logic) that could theoretically leave an orphaned output DataType on the rare failure between those
two writes; not covered by a test and not required by any AC.

### Phase 3: UI Review — N/A
This is a backend-only change (new endpoint + MCP tool). Confirmed via `git diff main...HEAD --stat
-- frontend/` — zero frontend files touched. `helio-mcp/` changes (new tool registration + client
method + types) were reviewed as part of Phase 2 code review, not as a UI surface — there is no
`frontend/**` change, and `ApiRoutes.scala`/`schemas/**`/`openspec/specs/**` changes are additive-
only (new route/schema, no existing contract altered), so there is no rendered UI to exercise.

### Overall: PASS

### Non-blocking Suggestions
- `BoundPanelService.createPipeline`'s "pipeline" stage failure branch passes
  `outputDataTypeIdOpt = None` to `cleanup`, assuming `PipelineRepository.create`'s DataType-insert-
  then-pipeline-row-insert sequence is atomic. It verifiably is not (two separate, non-transactional
  Slick actions — `PipelineRepository.scala:216-230`, pre-existing/unmodified). A failure isolated
  to the second insert (rare — DB hiccup, not FK-driven since the source was already validated)
  would leave an orphaned output DataType this call's cleanup won't catch. Consider either wrapping
  `PipelineRepository.create`'s two inserts in one transaction (pre-existing service, out of this
  ticket's stated scope) or filing a fast-follow ticket — not blocking for HEL-364 since no AC
  requires it and the failure window is narrow.
- `BoundPanelService.scala` is 374 lines, under the 400-line "propose a split" threshold today but
  worth watching if this file grows further (e.g. if a future ticket adds more stages).
