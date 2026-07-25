## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (discover + instantiate a shape via MCP → pipeline + output DataType): confirmed live —
  `list_pipeline_shapes` returns all 5 catalog entries; `create_pipeline_from_shape` with valid
  `top-n` params produced pipeline `252255b4-0d47-413b-9b74-ac6be9230b28` with `sort`,`limit`
  steps, in order.
- AC2 (tool descriptions document every shape id + params): `read.ts` (`list_pipeline_shapes`) and
  `write.ts` (`create_pipeline_from_shape`) descriptions enumerate `passthrough`/`single-row`/
  `top-n`/`time-series`/`pivot-matrix` with accurate params — cross-checked field-by-field against
  each shape's `paramsSchema` in `backend/src/main/scala/com/helio/domain/shapes/*.scala`
  (`SingleRowShape`, `TopNShape`, `TimeSeriesShape`, `PivotMatrixShape`, `PassthroughShape`); no
  drift found.
- AC3 (reuses the same backend service the UI uses): confirmed — `createPipelineFromShape` calls
  `POST /api/pipeline-shapes/:id/expand` (HEL-402's endpoint, the only HTTP caller of
  `PipelineShape.expand`), then composes `createPipeline` + `addPipelineStep`. No backend files
  changed (`git diff main...HEAD --name-only` touches only `helio-mcp/**` and
  `openspec/changes/smart-shape-mcp-surface/**`) — single source of truth is structurally
  guaranteed, not just claimed.
- AC4 (tests): `npm run build`/`typecheck` clean (independently re-run). `verify.ts` extended with
  4 new sections, independently re-run against a live dev backend (see Phase 3 below) — exit 0,
  `VERIFY OK`. No new backend endpoint, so "backend test for the instantiation endpoint if one is
  added" is correctly inapplicable (design.md Non-Goals / skeptic-design-1.md item 5 confirm this).
- AC5 (backward compatible): diff confirms only additive tool registrations, additive
  `WorkspaceContext.pipelineShapes` field, and an additive text update to
  `get_workspace_context`'s description. No existing `inputSchema` or return shape touched.
- Tasks.md: all 12 items marked `[x]`; each traces to a diff hunk (types → `types.ts`; API
  wrappers → `helioApi.ts`; tools → `read.ts`/`write.ts`; workspace context → `context.ts`; tests →
  `verify.ts`). No task claims implementation it doesn't have.
- No scope creep: `propose_dashboard`/`apply_proposal` (`proposal.ts`) untouched, matching design.md
  Decision 4 — verified via `git diff main...HEAD --name-only` (no `proposal.ts` entry).
- No regressions: `list_connectors`/`create_pipeline`/`add_pipeline_step`/other existing tools'
  `inputSchema` and descriptions are byte-identical in the diff except the one documented
  `get_workspace_context` description edit.
- No schema/API-contract changes needed or made (pure MCP-client change consuming an existing,
  already-shipped backend contract) — `check:schemas` passes.
- Planning artifacts (proposal/design/tasks/spec) match the final implementation; skeptic's design
  gate (`skeptic-design-1.md`) already CONFIRMed the plan against real code, and the executor's
  verify-harness assertions use substring/contains checks per the skeptic's non-blocking note
  (avoiding a too-strict exact-match flake risk) — confirmed in `scripts/verify.ts`'s
  `.includes(...)` checks.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Type safety**: New TS types (`ShapeParamDescriptorResponse`, `RowCountContractResponse`,
  `OutputFieldContractResponse`, `OutputContractResponse`, `PipelineShapeCatalogEntryResponse`,
  `ShapeStepExpansionResponse`) verified field-for-field against
  `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala` — exact mirror,
  including the discriminated-union shape for `RowCountContract` and the request body shape
  (`{params}` matches `ExpandPipelineShapeRequest(params: JsObject)`). No `any` anywhere in the
  diff; free-form params correctly typed `Record<string, unknown>` / `z.record(z.unknown())`.
- **DRY**: `createPipelineFromShape` composes existing `expandPipelineShape`/`createPipeline`/
  `addPipelineStep` calls client-side — no reimplemented validation/expansion logic, per design.md
  Decision 2 and the ticket's "reuse, don't duplicate" requirement.
- **Readable/Modular**: New tools mirror `list_connectors`/`create_pipeline`/`add_pipeline_step`'s
  existing structure exactly (`guarded()`, `HelioApi` method placement, section grouping) — no new
  patterns introduced.
- **Error handling**: `createPipelineFromShape` correctly validates via `expand` before any write;
  errors propagate through the existing `HelioApiError`/`guarded`/`describeError` path, verified
  live to surface the backend's verbatim 422/404 message (see Phase 3).
- **No dead code**: no unused imports, no leftover TODO/FIXME in the diff.
- **No over-engineering**: two small single-purpose tools instead of overloading
  `create_pipeline`'s schema — matches design.md Decision 1's reasoning; not gold-plated.
- **CONTRIBUTING.md mechanical checks** (imports/qualifiers rule is Scala-specific via
  `check:scala-quality`; no backend files touched, so N/A here): independently re-ran
  `npm run check:scala-quality` — clean (0 inline-FQN violations; only pre-existing, unrelated
  Scala test-file size warnings, informational only per CONTRIBUTING's Pre-Commit Policy section).
  `npm run lint` (root, `--max-warnings=0`) and `npx eslint helio-mcp/src helio-mcp/scripts
  --max-warnings=0` both clean. `npm run format:check` / `npx prettier --check` both clean.
- **DESIGN.md**: N/A — no `frontend/**` files changed.
- **Tests meaningful**: `verify.ts`'s new sections exercise all three spec scenarios against a real
  server (not mocked) and assert on actual response content (step kinds, verbatim error text,
  pipeline-count deltas to prove no orphan pipeline) — these would catch a real regression in the
  expand→create→add-step composition or in error propagation.

### Phase 3: Live-Harness Verification (fresh evidence; no frontend/UI files changed, so the
canonical Phase-3-trigger list is N/A, but the ticket is explicitly a live-backend integration —
re-ran per the task brief) — PASS
Issues: none.

- Started dev servers via `scripts/concertino/start-servers.sh` (reused already-healthy
  backend/frontend on 8480/5573); `scripts/concertino/assert-phase.sh servers` → `PASS servers`.
- Independently re-built `helio-mcp` (`npm run build`) and re-ran `npm run verify` against the live
  backend with a freshly-minted PAT (own login + `POST /api/tokens`, not reusing the executor's
  token) — exit 0, `VERIFY OK`.
- Confirmed all three spec scenarios with fresh evidence:
  - `list_pipeline_shapes` returns all 5 ids (`passthrough`/`pivot-matrix`/`single-row`/
    `time-series`/`top-n`).
  - Valid `top-n` params → pipeline `252255b4-0d47-413b-9b74-ac6be9230b28` created with `sort`,
    `limit` steps in order.
  - Invalid params (missing `n`) → `isError=true`, message
    `HelioApiError (status 422) ... 422 Unprocessable Content: top-n shape: missing required field
    'n' (expected a positive integer)` — verbatim shape message present.
  - Unknown shape id → `isError=true`, message
    `HelioApiError (status 404) ... 404 Not Found: Unknown pipeline shape: 'not-a-real-shape'.
    Valid values: passthrough, pivot-matrix, single-row, time-series, top-n`.
  - Pipeline count before/after the two failing calls unchanged (17→18, the single delta being the
    one successful `top-n` pipeline) — confirms no orphan pipeline on either failure path.
  - Both `get_workspace_context` (tool) and the `helio://workspace/context` resource read include a
    5-entry `pipelineShapes` array.
- No console/process errors during the run; process exited 0.

### Overall: PASS

### Non-blocking Suggestions
- `helio-mcp/src/helioApi.ts` (586 lines) and `helio-mcp/src/tools/write.ts` (555 lines) were
  already over CONTRIBUTING.md's ~400-line "propose a split in the PR description" soft-budget
  trigger before this change (528 and 510 lines respectively on `main`) and grew further. This is
  explicitly informational per CONTRIBUTING's Pre-Commit Policy section ("File-size warnings ...
  are informational only") and pre-existing, not introduced by this ticket — but worth a note for a
  future ticket to split `write.ts`'s per-op description strings out of the tool-registration
  function, since that's most of its growth.
