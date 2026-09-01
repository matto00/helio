# Execution progress — HEL-907

Largest ticket in the batch (34 tasks, near-total rewrite of
`helio-mcp/src/tools/**` + both sides of the proposal/patch-set contract).

## Done

- **1.5** (cycle 1) — HEL-766 fix in `PatchSetApplyRollback.scala`. Verified.
- **5.5 (partial)** (cycle 1) — `parentStepId` half of the patch-set undo
  regression test.
- **2.1** (cycle 2) — verified already correctly implemented by earlier
  tickets (cascade delete via FK, no code change needed).
- **5.8** (cycle 2) — added the missing regression test proving 2.1.
- **1.1 (pipeline-proposal half)** (cycle 3) — `schemas/pipelines/pipeline-proposal.schema.json`
  and the backend `PipelineProposal`/`PipelineProposalApplyResponse` case
  classes retargeted onto Outputs (steps/outputs reuse P1.3's single-call
  transactional shapes verbatim: `clientId`/`parentStepId` on steps,
  `nodeStepClientId` on outputs). The **dashboard-proposal half of 1.1 was
  already done** by earlier tickets (P1.1/P1.3) — verified this cycle:
  `ProposalPanel.dataTypeId` already grounds against `OutputRepository` via
  `ProposalPanelSupport.validateDataTypeBinding`, not a legacy DataType
  lookup. No change needed there.
- **1.3 (pipeline-proposal service half)** (cycle 3) — `PipelineProposalService`
  rewritten to delegate pipeline+steps+outputs creation to
  `PipelineService.create`'s existing single-call transactional path (P1.3)
  instead of a manual per-step loop + one hardcoded Output insert.
  `CombinedProposalService`'s `$pipelineOutput` sentinel resolution reworked
  for zero/one/many Outputs (exactly one required to resolve the sentinel,
  else a 422 naming the real count — a deliberate, documented, conservative
  choice: no `"$pipelineOutput:<name>"`-style addressing added this cycle).
  **The dashboard-proposal-service half of 1.3 was already done** (no
  changes needed to `DashboardProposalService` itself).
- **3.10** (cycle 3) — `helio-mcp/src/tools/combinedProposal.ts` updated for
  the new shapes (paired with 1.1/1.3 per design.md Decision 4). Also
  updated `pipelineProposal.ts`/`pipelineProposalHandlers.ts` and
  `helio-mcp/src/types.ts`'s `PipelineProposal`-family interfaces — not
  explicitly named by task 3.10's own text, but these construct/consume the
  exact same `PipelineProposal` wire contract that 1.1 retargeted; leaving
  them on the old shape would have made `propose_pipeline`/
  `apply_pipeline_proposal` fail every real call (missing required
  `clientId`) the moment this cycle's backend change landed. `proposal.ts`
  (the dashboard-only proposal tool) needed no change, matching the
  dashboard-proposal-side "already done" finding above.
- **Adjacent bug fix, discovered while wiring 1.3** — `PipelineService.
  createTransactional` (P1.3/HEL-906's `POST /api/pipelines` single-call
  path) never carried the join/union/lookup cross-owner ACL pre-flight the
  older per-step `addStep` write path has always had. Any caller of
  `POST /api/pipelines` with a non-empty `steps[]` — not just this ticket's
  proposal-apply path — could reference another user's DataSource as a
  join/union/lookup right-source with zero ownership check. Fixed via a new
  `validateStepCrossOwnerRefs` pre-check, run before the transaction starts.
  Caught by a PRE-EXISTING regression test (`PipelineApplyProposalRollbackSpec`
  "roll back an inline static source... when a later addStep fails") that
  started failing the moment `PipelineProposalService` was switched onto the
  transactional path — not a new test authored to prove this fix, the
  existing test simply started exercising a code path it hadn't reached
  before.

## Done (cycle 4)

- **1.2** — `schemas/patch-sets/*` retargeted: `output` added as a full
  `EditTarget.kind` (schema + `Edit.outputPatch` + full apply-path wiring —
  resolvers, forward-apply, rollback, DI construction in `ApiRoutes.scala`),
  update+delete ops (no create, mirrors `pipelineStep`'s own precedent).
  "node"/"placement" from the spec's "nodes, Outputs, and placements"
  wording were already the pre-existing `pipelineStep`/`panel` kinds under
  their original names — verified this cycle, no rename needed. Preview
  (`PatchSetPreviewService`) and undo (`PatchSetUndoService`) do NOT yet
  support the `output` kind — deferred, documented in files-modified.md,
  not silently dropped: an `output` edit hits an honest rejection in either
  path (never a crash or silent no-op), and wiring them is the same shape
  of work as this cycle's apply-path wiring, just not done yet.
- **Adjacent finding, NOT fixed this cycle** — `PatchSetUndoInverse.
  pipelineStepCreateRequestFromResponse` (the separate UNDO-path inverse
  builder, not the same file cycle 1 fixed) still can't thread
  `parentStepId` on step recreate, because `PipelineStepResponse`'s wire
  shape has no `parentStepId` field at all (unlike `PatchSetApplyRollback`,
  which reads a live domain object, not wire JSON). This needs a
  `PipelineStepResponse` wire-shape change across 12+ subtypes — sized as
  its own follow-up, documented in files-modified.md.

## Done (cycle 5)

- **1.4** — per-node Output `fieldMapping` grounding, in the single-call
  transactional create path (`PipelineService.buildOutputsAction`, used by
  both `POST /api/pipelines` directly and `PipelineProposalService`'s
  delegation to it). New `OutputBindingSpec.validateFieldMappingColumnsExist`
  domain function. `OutputService.create`/`update`'s OWN grounding
  (standalone `add_output`/`update_output`, not yet built) deliberately NOT
  touched — see files-modified.md for why (a real, pre-existing, documented
  per-write-cost design tradeoff this cycle had no mandate to overturn).
- **1.6** — HEL-670 re-verified and genuinely fixed, not just re-verified.
  Found the real defect (dangerous "separate follow-up edit" guidance in
  `RefinementEditShape` telling the LLM to reference a not-yet-existing
  create edit's id from a sibling edit — structurally impossible, a real
  mistargeting risk) AND a second, larger, independently-discovered defect
  (the ENTIRE panel-kind worked-example set was for panel `type` values
  removed by HEL-904 months ago — every one would be rejected by the real
  backend today; this file's own test suite never caught it because it
  never covered those examples). Both fixed. Regression tests at both the
  protocol-decode level and the full `PatchSetApplyService.apply` level.

## Done (cycle 6)

- **Section 3, output-tools slice** (part of task 3.5, plus task 3.7's
  rename/task 3.9's one directly-coupled removal): new
  `helio-mcp/src/tools/outputs.ts` + `outputsHandlers.ts` module (10 new
  tools), new `helioApi.ts` methods, new `types.ts` interfaces, `index.ts`
  wiring. Removed `get_panel_capabilities` (was calling a route HEL-904
  deleted — a currently-broken tool, now fixed by replacement rather than
  left broken alongside its Outputs-model successor). See files-modified.md
  for the exhaustive list and what's deliberately still deferred to a later
  section-3 slice.

## Done (cycle 6, continued)

- **create_pipeline + add_pipeline_step rewrite** (tasks 3.2/3.3): new
  `tools/pipelines.ts`/`pipelinesHandlers.ts` module; `add_pipeline_step`
  gains `parentStepId` (extended in its existing home, `assertSchemas.ts`,
  not duplicated). `create_pipeline_from_shape` (task 3.4) is NOT rewritten
  yet — kept minimally compiling by dropping the now-meaningless
  `outputDataTypeName` param; it creates a pipeline + expanded steps with
  ZERO Outputs until its own task-3.4 pass. This is a real, temporary,
  DOCUMENTED behavior regression (see files-modified.md), not a silent one.

## Done (cycle 7)

- **`add_outputs_from_shape`** (task 3.4): closes the zero-Outputs gap
  `create_pipeline_from_shape` was left with in cycle 6. New tool expands a
  shape onto an EXISTING pipeline node (not a new pipeline), then creates
  one Output on the shape's terminal step. `outputKind` defaults to
  `"table"` when omitted -- no shape API exposes an intended Output kind,
  so this is a documented default judgment call, easily revisited, not a
  data-loss-risk decision warranting escalation.

## Done (cycle 7, continued)

- **`place_outputs`/`create_content_panel`** (task 3.6): replace
  `create_panel`/`create_panels`/`bind_panel`/`create_bound_panel`.
  A THIRD currently-broken tool found and removed: `create_bound_panel`'s
  backend route (`POST /api/panels/bound`) no longer exists at all
  (retired during the Outputs remodel) — every call has 404'd since then,
  undetected because no test covered it. `update_panel`'s docstring/schema
  also brought back in line with reality (was describing 9 bound-panel
  kinds `PanelType.fromString` hasn't accepted since HEL-904; now describes
  the real 5).

## Not started

- **1.7, 1.8** — per-node `fieldMapping` grounding via
  `PipelineAnalyzeService.analyzeNodes` (note: `PipelineService.
  validateOutputFieldMapping`, the existing hook used by both
  `POST /api/pipelines`'s transactional output-create AND now this
  ticket's proposal-apply path via delegation, currently only validates
  structural per-kind field presence via `OutputBindingSpec` — NOT against
  the actual projected schema at the Output's node; that's what 1.4 still
  needs to add), HEL-670 re-verification, `WorkspaceContextService` split
  (923 lines, untouched), HEL-829/848 review-UI loose ends. NOT STARTED.
- **2.2** — `docs/agent-native.md` tool rename table. NOT STARTED (no tools
  have actually been renamed yet — that's section 3's job; premature to
  write this table before section 3 lands).
- **3.1-3.9, 3.11-3.13** — the bulk of the MCP tool rewrite (`write.ts`/
  `helioApi.ts`/`context.ts` decomposition, `create_pipeline`/
  `add_pipeline_step`/`create_pipeline_from_shape` rewrites, new Output
  tools, `place_outputs`/`create_content_panel`, `get_output_capabilities`,
  `get_workspace_context` slimming, tool removals, `metricSchemas.ts`
  deletion, same-tab invalidation re-keying, HEL-934 absorption). NOT
  STARTED. This remains the single largest remaining piece.
- **4.1-4.2** — frontend review-page rewrite. NOT STARTED.
- **5.1-5.4, 5.6-5.7, 5.9-5.11** — MCP E2E, workspace-context fixture cap
  test, exact-tool-name-set test, proposal grounding test (needs 1.4 first),
  helio-mcp typecheck/jest evidence (RUN this cycle for what exists today —
  see gate results — but the AC itself needs the decomposed modules from
  section 3 to be meaningful), schema-drift evidence (green this cycle),
  teardown-by-tag test (done, cycle 2), HEL-670 regression test. Partially
  covered by cycle-3's own new/updated tests for 1.1/1.3/3.10, but the
  dedicated ACs (5.1/5.2/5.3/5.4/5.11) are NOT STARTED.

## Next cycle's starting point

Section 3 continues to be the largest remaining piece. `create_pipeline`/
`add_pipeline_step`/`add_outputs_from_shape`/`place_outputs`/
`create_content_panel` (3.2/3.3/3.4/3.6) are DONE. Good next slices, each
independently coherent:
- `get_workspace_context` rewrite (task 3.8) — drop types/metrics, list
  pipelines with their Outputs (kind, schema, placements) and sources with
  `inferredSchema`; this is also the ticket's own AC for the
  25-source/43-pipeline result-cap fixture test (task 5.2). **Sized this
  cycle, not started**: `context.ts` is 1301 lines with a 2051-line test
  file (`context.test.ts`) — the largest, most heavily-tested single file
  in `helio-mcp/src/`, an order of magnitude bigger than any slice landed
  so far this section. Budget a full cycle (or more) for this one alone;
  don't try to land it alongside another slice in the same cycle the way
  3.2+3.3, or 3.4+3.6, were paired.
- The removal sweep (task 3.9's remainder): `list_data_types`/
  `update_data_type`/`delete_data_type`/`get_data_type_rows`/`list_metrics`/
  `get_metric`/`create_metric`/`update_metric`/`delete_metric`/`bind_panel`/
  `create_bound_panel`, plus `metricSchemas.ts` deletion — mechanical, but
  touches `read.ts`/`write.ts` broadly; do this alongside whichever of the
  above slices actually retires each tool's last live caller, not as an
  isolated pass (a tool removed before its replacement exists breaks any
  in-flight caller).
- `write.ts`/`helioApi.ts`/`context.ts` decomposition (task 3.1) is
  happening AS A BYPRODUCT of each slice above landing in its own
  resource-scoped file (this cycle's `outputs.ts`/`outputsHandlers.ts` is
  the first instance) — not a separate pass; confirm the scoped helio-mcp
  jest command still imports every module without OOM after each slice
  (HEL-647), not just once at the end.

Section 1's remaining pieces (1.7 `WorkspaceContextService` split, 1.8
review-UI loose ends, `output`-in-`PatchSetPreviewService`/
`PatchSetUndoService` wiring, `PatchSetUndoInverse` `parentStepId` gap) are
all still open and independent of section 3 — fine to interleave whenever a
section-3 slice reaches a natural stopping point.

## Gate results (cycle 7)

- `cd helio-mcp && npx tsc -p tsconfig.typecheck.json` — clean, zero errors
  (run fresh after both slices: add_outputs_from_shape, then
  place_outputs/create_content_panel).
- `npx eslint <touched files> --max-warnings=0` — clean, both slices.
- `npx prettier --check`/`--write` — clean, both slices.
- The verified scoped helio-mcp jest command — add_outputs_from_shape
  slice: 16/16 suites, 277/277 tests (up from 271); place_outputs slice:
  **17/17 suites (up from 16), 284/284 tests (up from 277)**. No OOM at
  either checkpoint.
- Backend untouched this cycle.
- UI gate — N/A for this ticket (backend/MCP only), stated explicitly.

## Gate results (cycle 6)

- `cd helio-mcp && npx tsc -p tsconfig.typecheck.json` — clean, zero errors
  (run fresh after BOTH slices: output-tools, then create_pipeline/
  add_pipeline_step).
- `npx eslint <touched files> --max-warnings=0` — clean, both slices.
- `npx prettier --check`/`--write` — clean after one `--write` pass, both
  slices.
- The verified scoped helio-mcp jest command — output-tools slice: 15/15
  suites (up from 14), 264/264 tests (up from 250); create_pipeline slice:
  **16/16 suites (up from 15), 271/271 tests (up from 264)**. No OOM at
  either checkpoint.
- Backend untouched this cycle — `git status` confirms only `helio-mcp/`
  files changed across both slices; backend gates not re-run (nothing to
  regress).
- UI gate — N/A for this ticket (backend/MCP only), stated explicitly.

## Gate results (cycle 5)

- `cd backend && sbt -batch compile` / `Test/compile` — clean.
- `cd backend && sbt -batch 'set Test/parallelExecution := false' 'testOnly com.helio.services.pipelines.PipelineCreateTransactionalSpec com.helio.domain.panels.OutputBindingSpecSpec com.helio.services.patchsets.RefinementEditShapeSpec com.helio.services.patchsets.PatchSetApplyServiceSpec'` —
  8/8, 10/10, 18/18, 28/28 all green (72 total across the four targeted specs).
- Full backend suite (sequential): **3517/3517 passed**, 235 suites, 0
  failed (up from 3502 — this cycle's 15 new tests).
- `node scripts/check-schema-drift.mjs` — green throughout, never committed
  red.
- UI gate — N/A for this ticket (backend/MCP only), stated explicitly.

## Gate results (cycle 4)

- `cd backend && sbt -batch compile` / `Test/compile` — clean.
- `cd backend && sbt -batch 'set Test/parallelExecution := false' 'testOnly <8 patch-set specs>'` —
  83/83 pre-existing green, then 27/27 (23+27, some overlap) after adding
  new `output`-kind coverage — see files-modified.md for the exact new
  tests.
- Full backend suite (sequential): **3502/3502 passed**, 235 suites, 0
  failed (up from 3494 — this cycle's 8 new tests: 3 protocol round-trip +
  5 service-level integration).
- `node scripts/check-schema-drift.mjs` — green throughout, never committed
  red.
- UI gate — N/A for this ticket (backend/MCP only), stated explicitly.

## Gate results (cycle 3)

- `cd backend && sbt -batch compile` and `Test/compile` — clean.
- `cd backend && sbt -batch 'set Test/parallelExecution := false' 'testOnly <18 proposal/assistant/ACL specs>'` —
  **229/229 passed** (the full set of specs touched or downstream of this
  cycle's diff).
- Full backend suite (sequential): **3494/3494 passed**, 235 suites, 0
  failed — run twice this cycle (once mid-cycle after the PipelineProposalService
  rewrite, once again after the MCP-side changes), both green.
- `node scripts/check-schema-drift.mjs` — green
  (`schemas in sync with JsonProtocols (73 checked across 48 protocol
  files)`, `panel-type enums in sync... (7 surfaces checked)`).
- `cd helio-mcp && npx tsc -p tsconfig.typecheck.json` — clean, zero errors.
- The verified scoped helio-mcp jest command (task 5.9) —
  **14/14 suites, 250/250 tests passed**, no OOM (proves HEL-647 still
  holds; suite/test count identical to the pre-existing baseline since no
  new files were added this cycle, only existing ones edited).
- UI gate — N/A for this ticket (backend/MCP only), stated explicitly.
- No commit was made with `check-schema-drift.mjs` red at any point in this
  cycle (verified before each intermediate checkpoint).

## Cycle 8 — get_workspace_context rewrite (task 3.8) + 25/43 fixture (task 5.2) + tasks.md reconciliation

Sole focus: task 3.8 per the peer's explicit cycle-8 directive, plus the peer's
addendum to reconcile `tasks.md` against real commit history before yielding.

Done:
- `context.ts`'s `WorkspaceContext`/`buildWorkspaceContext` retargeted onto
  design.md Decision 6: `dataTypes`/`metrics`/`joinHints` dropped outright;
  `dataSources[].inferredSchema` added; `pipelines[].outputs[]`
  (id/name/kind/nodeStepId/schema/placements) added, replacing
  `outputDataTypeId`/`outputDataTypeName`, fetched via ONE paginated
  `listAllOutputs` call grouped client-side (not a per-pipeline fan-out).
  The entire sample-rows/column-stats/semantic-role/join-hints/tiered-budget
  machinery (~680 lines) deleted outright — confirmed unused elsewhere first,
  and explicitly designed-out by Decision 6's "well under cap without a
  separate truncation strategy" text. `applyBudget` simplified to
  measure-and-report (no more tiers to shed).
- `types.ts`: `InferredFieldResponse`/`InferredSchemaResponse` added;
  `DataSourceResponse.inferredSchema?` added.
- `context.test.ts` REPLACED wholesale (old file tested almost entirely
  now-deleted functions); new file includes the task-5.2 25-source/
  43-pipeline fixture, asserting `truncation.applied: false`,
  `structuralFloorExceedsBudget: false`, size under `DEFAULT_BUDGET_BYTES`.
- `read.ts`'s `get_workspace_context` docstring and `README.md`'s "Context
  serializer" section + pipeline-only-binding-rule paragraph rewritten to
  match.
- `tasks.md` reconciled against real commit history (the peer's addendum):
  every completed task ticked with its commit sha; every partial task left
  UNTICKED with what remains named inline, never tick-and-qualify. Notable
  partial findings surfaced by this audit: 1.1/1.3/3.10's dashboard-proposal
  half was never actually done (only the pipeline-proposal half, per
  `9c4263cc`'s own commit message) — this had been silently implied complete
  by the peer's own shorthand list in the addendum message; corrected here
  rather than taken at face value.

Not done this cycle (explicitly flagged, not silently skipped):
- HEL-865 (Linear ticket, AC: "update HEL-865 to say what remains") — no
  Linear-write tool is available in this session's tool set. Needs a human or
  an agent with Linear access.
- Task 1.7 (backend `WorkspaceContextService`/`WorkspaceContextProtocol.scala`
  structural-parity retarget) remains fully open — the backend's server-side
  port of this same shape (used by `GET /api/workspace/context`, a different
  call path than MCP's client-side fan-out) still carries the pre-HEL-907
  `dataTypes`/`outputDataTypeId`/`outputDataTypeName` shape. Flagged, not
  silently left inconsistent; deferred by the peer's own sequencing across
  multiple cycles now.
- Task 3.9 (tool-removal sweep) NOT started this cycle — task 3.8 filled the
  full cycle per the peer's explicit sizing call ("give this full cycle to
  task 3.8 on its own").

Gates (fresh, this cycle):
- `npx tsc --noEmit` (helio-mcp) — clean.
- `npx eslint . --max-warnings=0` (helio-mcp) — clean.
- `npx prettier --check .` (helio-mcp) — clean (after one `--write` pass on
  the two rewritten files).
- Scoped helio-mcp jest command — 17/17 suites, 190/190 tests, no OOM.
  **Test count dropped from 284 (cycle 7) to 190** — a large, EXPECTED drop:
  the deleted sample-rows/column-stats/semantic-role/join-hints/budget-tier
  test suites (the largest fraction of the old `context.test.ts`) tested
  functions that no longer exist per Decision 6's explicit design; all 16
  other suites are untouched and still green.
- Backend suite NOT re-run this cycle (backend untouched).
- `check-schema-drift.mjs` NOT re-run this cycle (no schema touched).

## Cycle 9 — tool-removal sweep (task 3.9) + exact-tool-name-set test (task 5.3)

Done:
- Removed the 9 remaining DataType/Metric-model MCP tools
  (`list_data_types`/`update_data_type`/`delete_data_type`/`get_data_type_rows`/
  `list_metrics`/`get_metric`/`create_metric`/`update_metric`/`delete_metric`)
  and `metricSchemas.ts`, per task 3.9. Removed their now-dead `HelioApi`
  methods and `types.ts` interfaces too (not just the tool registrations) —
  confirmed each was genuinely unused elsewhere first. Kept `listDataTypes`/
  `DataTypeResponse` (still live: `proposal.ts`'s dashboard-proposal
  grounding depends on them).
- Fixed several stale docstrings referencing the retired DataType model
  found along the way (`delete_data_source`/`delete_pipeline` in both
  `write.ts` and `helioApi.ts`, `list_pipelines`/`analyze_pipeline` in
  `read.ts`, the `workspace-context` resource description).
- Added task 5.3 (exact-tool-name-set test): split `createServer` out of
  `index.ts` into a new `server.ts` (root cause: `index.ts`'s top-level
  `import.meta.url` guard is uncompilable by ts-jest's CJS-ish target when
  imported from a test -- `TS1343`). New `server.test.ts` spins up a real
  in-process MCP client/server pair over the SDK's own `InMemoryTransport`
  and asserts all 15 tools removed across this whole ticket are absent, the
  replacement Output/pipeline/placement tools ARE present, and no tool name
  is registered twice.
- Cleaned up the `helio-mcp/README.md` tool-catalog table: removed rows for
  every retired tool; flagged (not fixed) the pre-existing gap that the
  newer Output/pipeline/placement tool families were never documented there
  (cycles 6-7's own gap, out of 3.9's stated scope).

Significant finding, not fixed this cycle (flagged for next-cycle sizing):
confirmed via `ApiRoutes.scala` that `DataTypeRoutes` was deleted OUTRIGHT by
HEL-904 -- `GET /api/types` no longer exists as a backend route at all. This
means `listDataTypes()`, still called live by `proposal.ts` for
`propose_dashboard`'s grounding, is calling a dead route right now --
`propose_dashboard` is very likely 404ing in production today, not merely
"pending retarget". This raises the priority of the still-open
dashboard-proposal half of tasks 1.1/1.3 from "next in line" to "actively
broken, highest priority".

Not done this cycle: tasks 1.1/1.3's dashboard-proposal half, 1.7, 1.8 --
no budget left after 3.9/5.3; also the README's Output/pipeline/placement
tool-catalog gap (flagged, not fixed, per above).

Gates (fresh, this cycle):
- `npx tsc --noEmit` (helio-mcp) -- clean.
- `npx eslint . --max-warnings=0` (helio-mcp) -- clean.
- `npx prettier --check .` (helio-mcp) -- clean (after one `--write` pass).
- `npm run build` (helio-mcp tsc project build) -- clean (verifies the
  index.ts/server.ts split compiles for real, not just under ts-jest).
- Scoped helio-mcp jest command -- 18/18 suites (up from 17), 178/178 tests
  (down from 190 at cycle start -- expected: removed dead-tool test
  coverage, added server.test.ts's 3 tests), no OOM.
- Backend suite NOT re-run this cycle (backend untouched).
- `check-schema-drift.mjs` NOT re-run this cycle (no schema touched).

## Cycle 10 — the dashboard-proposal half of tasks 1.1/1.3/3.10 (fixes the live propose_dashboard 404)

Investigated before writing anything, per this ticket's own established
discipline: re-read `dashboard-proposal.schema.json` and
`DashboardProposalService.scala`/`ProposalPanelSupport.scala` directly rather
than trusting cycle 8's `git log main..HEAD` conclusion. Finding: both were
ALREADY fully retargeted onto Outputs by HEL-904, merged to `main` before
this branch existed -- cycle 8 wrongly read "no commit on this branch" as
"not done" when it actually meant "nothing needed to change here". This is a
correction to my OWN earlier ledger entry (cycle 8's tasks.md write-up),
applying the same self-verification standard I used to correct the peer
orchestrator's shorthand in cycle 8.

The real gap: traced every remaining `listDataTypes()` call site and found
exactly one -- `proposal.ts`'s `propose_dashboard` grounding fetch.
`combinedProposal.ts` had no DataType dependency at all (already clean).
Confirmed via `ApiRoutes.scala`'s own comment that `GET /api/types` has had
NO route since HEL-904 -- `propose_dashboard` has been either 404ing or
silently degrading its grounding check ever since. This is the live bug
cycle 9 surfaced.

Done:
- `proposalValidation.ts`: `computeProposalWarnings` retargeted onto
  `Map<string, OutputResponse>`; the "source companion" warning case removed
  outright (no such concept for an Output).
- `proposal.ts`: grounding fetch swapped from `api.listDataTypes()` to a new
  local paginated `fetchAllOutputs` helper (mirrors `context.ts`'s helper of
  the same name); both tool descriptions rewritten to drop every reference
  to retired metric/chart/table/collection/timeline panel kinds and correct
  the stale "text/markdown Source-mode binding" claim (removed outright by
  HEL-904 task 4.1).
- `proposal.test.ts` rewritten onto Output fixtures.
- `tasks.md`: 1.1/1.3/3.10 corrected from "PARTIAL, dashboard half open" to
  "[x], verified already done via HEL-904 this cycle".

Not done this cycle: `write.ts`'s `replace_dashboard_contents` docstring
still says "V41 pipeline-only binding" (stale terminology, not a functional
bug -- it delegates to propose_dashboard/apply_proposal's descriptions for
the real rules) -- minor, flagged not fixed, out of this cycle's direct
scope. Tasks 1.7/1.8 still fully open. `docs/agent-native.md` (task 2.2)
still not updated.

Gates (fresh, this cycle):
- `npx tsc --noEmit` (helio-mcp) -- clean.
- `npx eslint . --max-warnings=0` (helio-mcp) -- clean.
- `npx prettier --check .` (helio-mcp) -- clean (after one `--write` pass).
- `node scripts/check-schema-drift.mjs` -- green (re-verified explicitly per
  Decision 4's hard constraint, even though no schema file was touched).
- Scoped helio-mcp jest command -- 18/18 suites, 177/177 tests (down 1 from
  178 -- removed source-companion test case, no new surface added), no OOM.
- Backend suite NOT re-run this cycle (no backend file touched).

## Cycle 11 — WorkspaceContextService split (task 1.7)

Highest-risk task in this ticket per design.md's own flag ("do not alter
asNumeric's single-exit-filter structure or BigDecimal.setScale rounding").
Treated with the corresponding caution: baseline-first, diff-after, A/B via
git stash rather than trusting a single post-split test run.

Approach: a two-way split via trait mixin (`WorkspaceContextComputations`
holds every PURE computation method, `WorkspaceContextService` holds the
composition/assembly logic and `extends` the trait) rather than a
finer-grained multi-trait split. Chose this specifically to minimize the
number of file boundaries `asNumeric` and its neighbors cross -- fewer
boundaries meant fewer chances to introduce a subtle diff while moving code.
The move itself was purely mechanical (line-range cut/paste via a Python
script working from exact `grep -n` boundaries, not manual retyping) to
avoid transcription risk.

One real subtlety found and fixed: Scala's plain `private` is invisible to a
subclass even via inheritance (unlike Java) -- `WorkspaceContextService`'s
surviving `toDataTypeEntry` method calls three trait members
(`contentFieldNames`/`overflowStructuredFieldNames`/`SampleColumnLimit`) that
had been `private` before the split; these three (and ONLY these three) were
bumped to `protected`. Everything else kept its exact prior visibility.

Verification: 8 existing WorkspaceContextService specs (136 tests) run via
`git stash` isolation BEFORE the split (baseline), then again AFTER
(`git stash pop`) -- identical 136/136 pass, and the full sorted test-name
listing diffed byte-identical between the two runs (not just counts). Then
the full backend suite (3517 tests, 235 suites) run once more post-split as
final confirmation -- all green.

Done:
- `WorkspaceContextComputations.scala` (new trait, ~500 lines of moved code).
- `WorkspaceContextService.scala` shrunk 923 -> 427 lines.
- `tasks.md` 1.7 ticked, with the file-size numbers and verification method
  named inline.

Not done / explicitly flagged: `WorkspaceContextService`/
`WorkspaceContextProtocol` still carry the pre-HEL-907 DataType-shaped
response (`dataTypes`/`outputDataTypeId`/`outputDataTypeName`) -- a
structural-parity gap against the MCP-side `context.ts` (retargeted onto
Outputs in cycle 8) that task 1.7, as literally worded ("split by
resource"), does not cover. Both files are still over the 250-line soft
budget (427/536) -- a real reduction from 923, treated as a safe stopping
point per the peer's explicit allowance rather than risking a finer split
for a non-blocking warning.

Gates (fresh, this cycle):
- `sbt compile` -- clean (two pre-existing-style "outer reference" warnings,
  same class already present elsewhere in this codebase, not new risk).
- `node scripts/check-scala-quality.mjs` -- non-blocking soft warnings only.
- Targeted WorkspaceContextService specs -- 136/136, identical before/after.
- Full backend suite -- 3517/3517, 235 suites, 0 failures.
- helio-mcp untouched this cycle -- scoped jest command not re-run (no TS
  file changed).

## Cycle 12 — docs/agent-native.md rewrite (task 2.2) + task 1.8/section 4 scope investigation

Task 2.2 done as a full rewrite, not a bolted-on rename table: every section
of `docs/agent-native.md` still describing the retired DataType model was
fixed (canonical-path diagram, binding rule, endpoint->tool map, new
tool-renames table, end-to-end-proof honesty flag). Found and flagged (not
fixed) that `scripts/agent/*.sh` and `helio-mcp/scripts/compose.ts` are also
stale, calling the same dead routes/retired tools.

Task 1.8 investigated, NOT started, after a major scope discovery: traced
`fetchDataTypes()` to `GET /api/types`, confirmed dead (HEL-904 deleted the
route outright, same as the cycle-9/10 MCP-side findings). A repo-wide grep
found 20 frontend files across dataTypes/panels/pipelines/metrics/sources/
dashboards features depending on this dead route or the DataType model
generally. Task 1.8's "close the two HEL-829/HEL-848 loose ends" framing
significantly undersells the real scope -- this is a full frontend migration
onto Outputs, not a two-item polish pass. Deliberately stopped here rather
than start a partial migration that would leave the frontend in a worse,
harder-to-reason-about half-migrated state; the exact finding and file list
are recorded in tasks.md for the next cycle's sizing.

Gates (this cycle): `npx prettier --check docs/agent-native.md` clean. No
code file touched -- no jest/tsc/eslint/sbt gate applicable to this cycle's
actual diff.

## Cycle 13 — review pages retargeted onto Outputs (tasks 1.8/4.1, narrowed scope per HEL-936)

Peer filed HEL-936 for the ~18-file broader frontend migration cycle 12
found, then rescoped task 1.8 down to exactly section 4 (tasks 4.1/4.2) as
the ticket's own text names it: `ProposalReviewPage` and the sibling
patch-set/pipeline-proposal/combined review pages.

Started with `ProposalReview`/`ProposalReviewPage` (the dashboard-proposal
review page) -- new `outputsService.ts` (paginated `fetchOutputs`, mirrors
`context.ts`'s own helper), retargeted `ReviewDataType` -> `ReviewOutput`,
dropped the "source companion" binding case (no such concept for an
Output), fixed the demo-fixture synthesis (was using the retired
metric/chart/table panel kinds with fieldMapping).

While inside, found the pipeline-proposal and combined review pages
(explicitly named by the ticket's own task 4.1 text) had the identical
staleness one level deeper: `types/pipelineProposal.ts`'s `PipelineProposal`
still had `outputDataTypeName: string` (the backend dropped this outright in
cycle 3) and steps were missing `clientId`/`parentStepId`;
`PipelineProposalApplyResponse` still had a single `outputDataTypeId`
instead of `outputs: ProposalOutputSummary[]`. Retargeted the full chain:
types, `PipelineProposalSummary.tsx` (single Data-type row -> real Output
list), `PipelineProposalReviewPage.tsx`'s demo fixture,
`CombinedProposalReview(Page).tsx` (label + demo fixture, which also had a
stray retired `"metric"`-kind panel), and every affected test file.
`PatchSetReview(Page).tsx` checked and needed no changes -- already
Output-based.

Deliberately did NOT expand into `pipelinesSlice.ts`'s `createPipeline`
thunk / `outputDataTypeId -> name` map (a different concern, HEL-936 scope
per the peer's own carve-out) even though it's in the same file as code I
touched -- stayed inside the proposal-apply thunk only.

Gates (fresh, this cycle):
- `npx tsc --noEmit` (frontend) -- clean.
- `npx eslint . --max-warnings=0` (frontend) -- clean.
- `npx prettier --check` -- clean on every touched file.
- Full frontend jest suite -- 275/275 suites, 2969/2969 tests (up from 2966
  at cycle start), no failures.
- Backend/helio-mcp untouched this cycle -- no sbt/scoped-jest gate
  applicable.

## Cycle 14 — task 4.2, HEL-934 helio-mcp share (3.12, a real bug), 3.1/3.13 verification, several 5.x closures

Worked through the remaining helio-mcp odds list. Biggest finding: task
3.12's "absorb HEL-934" was not a paperwork exercise -- `expandPipelineShape`
had a genuine live bug. The backend's `POST /api/pipeline-shapes/:id/expand`
wraps its response in `ExpandPipelineShapeResponse {steps, outputs?}`
(confirmed via `PipelineShapeRoutes.scala`/`PipelineShapeProtocol.scala`),
but `helioApi.ts` typed AND parsed the raw HTTP body as a bare
`ShapeStepExpansionResponse[]` array. `add_outputs_from_shape`'s handler
iterates the result directly (`for (const expansion of expansions)`) --
every real call with a non-empty shape would throw a runtime TypeError. The
existing test coverage for this handler (`pipelinesHandlers.test.ts`) never
caught it because it mocks `HelioApi` at a layer ABOVE the bug entirely.
Fixed by unwrapping `.steps` inside `expandPipelineShape` (external contract
unchanged, no caller edit needed) and added new `helioApi.test.ts` coverage
that exercises the real HTTP-layer parsing via an injected `fetchImpl`, not
a mocked API surface -- the only way this class of bug gets caught.

Also fixed `deletePipelineStep`, discovered while auditing the same file:
`DELETE /api/pipeline-steps/:id` answers `200 {removedTailStepCount}` (a
real splice-on-delete report -- deleting a mid-tree step cascades to every
descendant under the HEL-904 tree model), but the method discarded the
response body entirely. Now surfaced.

Task 4.2 turned out to need no functional change -- both
`replace_dashboard_contents` and `auto_layout_dashboard` were already
structurally correct (the former reuses the Output-based `panelSchema` from
cycle 10; the latter is pure geometry, no binding concept ever existed in
its schema). Only their docstrings were stale ("V41 pipeline-only binding",
"Create + bind panels first") -- fixed.

3.1 and 3.13 closed as VERIFIED (re-ran the OOM-free-import proof; ran a
repo-wide audit grep for un-normalized Option-field reads and found zero
violations) rather than left as one-off claims from earlier cycles. 5.6/5.7/
5.11 similarly re-confirmed with fresh evidence this cycle, not just
inherited from prior cycles' own claims.

3.11 investigated and deferred to HEL-936 -- its dispatch site
(`PipelineDetailPage.tsx`) is the same file HEL-936 already owns; re-keying
this one call site alone, without the rest of that page's fix, would not be
a coherent, independently-testable slice.

**For the peer to post on HEL-934** (no Linear write access this session):
"helio-mcp's share of this ticket is closed as of HEL-907 cycle 14 (commit
<fill in sha>). `expandPipelineShape` (helio-mcp/src/helioApi.ts) was
unwrapping the `{steps, outputs?}` shape-expand envelope incorrectly --
every real call would have thrown a runtime TypeError the first time a
shape expanded to any steps. Fixed, with new HTTP-layer test coverage
(helioApi.test.ts) that exercises the real response shape, not a mocked API
surface. `deletePipelineStep` now also surfaces the real
`removedTailStepCount` from `DELETE /api/pipeline-steps/:id`'s 200 body
instead of discarding it."

Gates (fresh, this cycle):
- `npx tsc --noEmit` (helio-mcp) -- clean.
- `npx eslint . --max-warnings=0` (helio-mcp) -- clean.
- `npx prettier --check .` (helio-mcp) -- clean.
- Scoped helio-mcp jest command -- 18/18 suites, 181/181 tests (up from
  177 -- the 4 new HTTP-layer tests), no OOM.
- No frontend/backend file touched this cycle -- no tsc/eslint(frontend)/sbt
  gate applicable; `check-schema-drift.mjs` re-verified green via this
  cycle's own commit hook (no schema file changed).

## Cycle 15 — MCP E2E Sleeper-rebuild script (task 5.1, partial) + ledger re-audit

Investigated the environment before writing anything: Postgres is running
and reachable, and a backend process IS already listening on :8080 --
but `ps aux` shows it was started from `/home/matt/Development/helio/backend`
(the MAIN checkout), not this worktree, sharing the same dev Postgres DB
this project's own memory notes flag as a documented collision hazard
(a prior real incident: one parallel worktree's stale migration poisoned
`flyway_schema_history` and broke a different ticket's dev-server gate).
Running a write-heavy E2E composition against that shared, ambiguously-owned
server was judged too risky to attempt blindly this cycle.

Built the real script instead: `helio-mcp/e2e/sleeper-rebuild.ts`, a
complete, typechecked (via a new `e2e/**/*.ts` entry in
`tsconfig.typecheck.json`'s `include`, so it's covered by the project's own
gate going forward) MCP-client harness rebuilding four representative
Sleeper-shaped dashboards (rosters/matchups/standings/transactions), each
through ONE `create_pipeline` call (inline source + `outputs[]`),
`run_pipeline`, a daily cron schedule set+read-back, and `place_outputs` --
tagged throughout for `teardown_resources`-based cleanup/re-run. The
script's own docstring is explicit that it does not re-fetch the real
Sleeper API (no external network assumed) -- it proves the actual
composition-pattern claim task 5.1 makes, with representative data shaped
like the real domain.

Deliberately did NOT execute it against the live shared backend this cycle,
per the peer's own "land what you can, continue next cycle" allowance --
provisioning (or confirming) an isolated dev backend built from THIS
worktree is the next step before a real run.

Also handled the peer's addendum: re-verified all 9 `@ <sha>` citations in
tasks.md resolve to real commits (`git log --oneline -1` each, cross-checked
against the commit's own subject). Found and fixed one real defect: task
4.1's entry had a corrupted trailing fragment left over from an incomplete
string replacement in cycle 13 (the tick itself was correct, `[x]`, but a
stale "-- NOT started this branch" fragment from the old text survived the
edit) -- fixed to end cleanly.

Done:
- `helio-mcp/e2e/sleeper-rebuild.ts` (new).
- `helio-mcp/tsconfig.typecheck.json` (`e2e/**/*.ts` added to `include`).
- `tasks.md` 5.1 marked PARTIAL with the exact reasoning; the corrupted 4.1
  line fixed.

Not done: actually running the script against a live backend (see above);
5.5 (full patch-set undo matrix) and 5.10 (fresh full backend suite) not
reached this cycle -- 5.1 took the full cycle.

Gates (fresh, this cycle):
- `npx tsc --noEmit -p tsconfig.typecheck.json` (helio-mcp) -- clean, now
  covering `e2e/`.
- `npx eslint e2e/sleeper-rebuild.ts --max-warnings=0` -- clean.
- `npx prettier --check` -- clean.
- Scoped helio-mcp jest command -- 18/18 suites, 181/181 tests (unchanged),
  no OOM.
- No frontend/backend file touched this cycle.

## Cycle 16 — MCP E2E run for real (task 5.1 closed), placement-undo regression (5.5), fresh full backend suite (5.10)

Verified the peer's port-isolation claim independently before acting on it
(read `workflow-state.md` directly: `DEV_PORT: 6339`/`BACKEND_PORT: 9246`,
cross-checked against `setup-worktree.sh`'s deterministic port-derivation
arithmetic) rather than trusting it at face value -- same discipline as
every other infrastructure claim this ticket has handled. Started this
worktree's own isolated backend via `start-servers.sh`, minted a throwaway
PAT (cookie-login + `POST /api/tokens`, needed the `X-Helio-Requested-With`
CSRF header -- the login response has no bearer `.token` field, only a
session cookie, so the CLAUDE.md curl example's `.token` extraction doesn't
apply to this endpoint), and ran `e2e/sleeper-rebuild.ts` for real.

**All four dashboards built successfully, twice (idempotency proof), then
cleaned up.** This is now real, verified evidence for task 5.1's acceptance
criterion -- not just a typechecked script.

Task 5.5 investigated before touching anything: confirmed there is no
`create` edit kind for `pipelineStep` (mirrors the existing `Output`
precedent -- no parent-id field to target one before it exists), so the
`pipelineStep` half of "add/remove/modify... through both directions" was
already fully covered by pre-existing tests (5.3a update, 5.3c
delete-undo-recreate with `enabled`/`parentStepId`). The real gap was
placement-field preservation -- the existing panel create/delete-undo test
only used a `divider`-kind panel, never `output`-kind, so
`OutputPanelConfig.outputId` had never been proven to survive undo. Added
that test; discovered along the way that `panels.output_id` is FK-constrained
at the DB level, so the test needed a genuinely seeded `Output` (new
`outputRepo`/`seedOutput` fixture wiring), not a synthetic id -- caught by
running it once and reading the real Postgres FK-violation error, not
assumed.

Task 5.10: full backend suite re-run fresh (several files changed since
cycle 11, including this cycle's own new test) -- 3517/3517, 235 suites, 0
failures.

Done:
- `helio-mcp/e2e/sleeper-rebuild.ts` run for real against this worktree's
  own isolated backend (twice, plus cleanup) -- task 5.1 now genuinely
  closed.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala`
  -- new `outputRepo`/`seedOutput` fixture wiring + 1 new placement-undo
  test.
- Full backend suite re-verified fresh -- 3517/3517, 235 suites.
- `tasks.md` 5.1/5.5/5.10 all ticked with the real evidence.

Gates (fresh, this cycle):
- `sbt compile` -- clean.
- `PatchSetUndoServiceSpec` standalone -- 11/11.
- Full backend suite -- 3517/3517, 235 suites, 0 failures.
- `npx prettier --check` on touched `.md` files -- clean.
- No frontend/helio-mcp file touched this cycle.

## Cycle 18 -- CR3 dashboard-tag teardown verified live end-to-end (not just compiled)

Ran the actual before/after proof the peer asked for, rather than asserting
the fix works from code inspection alone.

**Real defect found and fixed along the way**: this worktree's backend on
`:9246` was a stale process (`sbt run` PID started before cycle 17's commit)
-- `flyway_schema_history` topped out at V94, `dashboards` had no `tag`
column at all, so the first re-run against it silently created 4 dashboards
with **no tag persisted** (`GET /api/dashboards` showed the field entirely
absent, not `null` -- confirmed via direct Postgres inspection, not
guessed). This is exactly the kind of "compiles, but the running process
never picked it up" gap the peer's ask was designed to catch. Fixed by
restarting this worktree's backend via
`scripts/concertino/start-servers.sh "$(pwd)" 6339 9246 HEL-907`, confirmed
V95 applied (`flyway_schema_history` now tops at 95) and the `dashboards.tag`
column now exists, then cleaned up the 4 untagged stale-run dashboards
individually before re-measuring.

**Evidence (dashboards/pipelines tagged `e2e-sleeper-rebuild`, fresh
backend, DB queried directly via authenticated `GET` after each step):**

| Step | dashboards tagged | pipelines tagged |
|---|---|---|
| Before (post V95-restart, pre-fix-run cleanup) | 0 | 0 |
| Mid-run (after `sleeper-rebuild.ts`'s full build, before `--cleanup-only`) | 4 (all 4 confirmed carrying `tag: "e2e-sleeper-rebuild"` in the raw JSON, by id/name) | 4 |
| After (`sleeper-rebuild.ts --cleanup-only`) | 0 | 0 |

The mid-run row is the actual proof CR3 works: `create_dashboard`'s `tag`
param is now genuinely persisted end-to-end (not just accepted and
silently dropped), and `teardown_resources` genuinely reclaims it back to
0/0, not just "the script exited 0."

Throwaway PAT (`cycle18-e2e-verify`) minted for the run, revoked after
(`DELETE /api/tokens/:id` -> 204). Cookie jar / login/PAT temp JSON files
deleted afterward. `helio-mcp/dist-e2e/` (standalone compile output) removed
after use -- `git status` clean, nothing left uncommitted.

No code changes this cycle -- pure verification. 35/36 tasks remain done
(3.11 correctly deferred to HEL-936, unchanged).

## Cycle 20 -- evaluation-2.md's one finding: DashboardService.tag missing the curated-400 gate

evaluation-2.md confirmed CR3 (cycle 17) and its live-verification (cycle 18)
both genuinely closed -- dev DB independently verified clean, V95 confirmed
collision-free -- and raised exactly one new finding: `DashboardService`
never ran `request.tag` through `RequestValidation.validateTag` the way
every sibling tag-bearing service does, so an over-length tag on
`POST /api/dashboards` hit the DB CHECK constraint directly and surfaced as
a raw 500 instead of a curated 400.

**Fix**: gated at the route layer (`DashboardRoutes.scala`), matching the
file's own existing `offset < 0` pattern -- not by widening
`DashboardService.create`'s `Future[(Dashboard, Boolean)]` signature (no
`Either` convention at all; would ripple through every caller for one
field). New `ApiRoutesSpec.scala` test hits the REAL REST boundary directly
with a 201-char tag, asserting 400 -- the MCP client's zod schema already
caps `tag` at 200 chars and structurally cannot express the failing input,
which is exactly why nothing caught this earlier.

**Peer addendum**: audited every other new length-constrained field this
ticket added for the same unguarded-boundary shape. One candidate found
(`outputs.tag`, V94) but confirmed dead -- zero live write paths reach it
(every `insertInternal`/`insertInternalAction` call site defaults it to
`None`; nothing REST/MCP-exposed ever sets it). No second instance of the
bug class exists.

**Non-blocking notes picked up**: documented the `ifExists`+`tag`
interaction in `create-dashboard-request.schema.json`; removed
`TeardownOutcome.dashboardsDeleted`'s dead `= 0` default (confirmed exactly
one construction site, always explicit).

Gates (fresh): `sbt compile` clean; new test standalone, pass; full backend
suite re-run twice (after the route fix, then again after the dead-default
removal) -- both 3520/3520, 235 suites, 0 failures; `check-schema-drift.mjs`
green.

## Cycle 21 -- final-gate 4-way skeptic fan-out (round 1 of 2): 1 CONFIRM, 3 REFUTE

Full reports at `openspec/changes/mcp-outputs-proposals-rewrite/skeptic-final-{1-mcp-tools,2-proposal-contract,3-deletion-sweep,4-wire-contract}.md`.
All 5 blocking findings + both non-blocking notes addressed this cycle; see
tasks.md section 8 for the itemized list. Two things worth pulling out here:

**8.2's mutation-testing evidence (both regression tests, both directions):**

Undo-path test (`PatchSetUndoServiceSpec`, `HEL-766`), rewritten fixture
(3-step pipeline, branch off the non-trunk-last step):
- With the real fix (`PatchSetUndoInverse.pipelineStepCreateRequestFromResponse`
  reading `parentStepId`): green.
- With the fix reverted (`parentStepId = None` forced): **red** --
  `Some(PipelineStepId("a7fbbae3-...")) was not equal to Some(PipelineStepId("77cbb7d1-..."))`
  (PatchSetUndoServiceSpec.scala:440).
- Fix restored, re-verified green.

Rollback-path test (`PatchSetApplyServiceSpec`, new, exercises
`PatchSetApplyRollback.pipelineStepCreateRequestFromPrior` directly via a
mid-apply rollback):
- With the real code (already correct pre-cycle-21, confirmed not
  coincidentally): green.
- With `parentStepId = None` forced in `pipelineStepCreateRequestFromPrior`:
  **red** -- `Some(PipelineStepId("bfe2b8f6-...")) was not equal to
  Some(PipelineStepId("ad241491-..."))` (PatchSetApplyServiceSpec.scala:325).
- Fix restored, re-verified green.

**8.5's HEL-928 comment text** (executor has no Linear write access; peer to
post verbatim, same pattern as the HEL-934 closure comment):

> Second concrete instance of `check-schema-drift.mjs`'s `SKIP` set masking a
> real contract gap (HEL-907 evaluator-final-2, cycle 21): `DashboardResponse`
> gained a `tag` field (V95, cycle 17/20) but `schemas/dashboards/dashboard.schema.json`
> -- skipped by the automated checker because it's title `"Dashboard"`, a
> hand-composed response schema the checker can't diff 1:1 against a single
> case class -- still declared `additionalProperties: false` with no `tag`
> property, forbidding a field the backend now actually sends. Fixed
> (`tag` added to the schema, matching `DashboardResponse` exactly) in the
> same commit. Recorded here for whatever follow-up HEL-928 ends up scoping
> for the SKIP-set blind spot generally -- this is now two independent,
> real instances (not hypothetical) of the same masking failure mode.

Gates (fresh, this cycle): `helio-mcp` `tsc --noEmit`/`eslint --max-warnings=0`/
`prettier --check` all clean; scoped helio-mcp jest -- 18/18 suites, 182/182
tests; `sbt compile` clean; `PipelineCreateTransactionalSpec` standalone --
10/10; full backend suite -- 3523/3523 tests, 235 suites, 0 failures;
`check-schema-drift.mjs` green.

## Cycle 22 -- final-gate round 2 (targeted re-check): wire-contract CONFIRMs clean, 2 dimensions REFUTE on genuinely new findings

Full reports at `openspec/changes/mcp-outputs-proposals-rewrite/skeptic-final-{1-mcp-tools-round2,2-proposal-contract-round2}.md`.

Round 2 targeted only the 3 axes that refuted in round 1 (per the coordinator's
escalation policy, still round 1 of 2 overall since these are genuinely new,
narrow findings, not the same items surviving a second look). Wire-contract
(`dashboard.schema.json`) re-verified clean, no action. Proposal-contract's
`parentStepId` fix from cycle 21 was independently re-derived by the skeptic
-- their own fresh mutation run (revert both builders, re-run) produced
exactly the same two distinct failures cycle 21's own transcript recorded,
one per file/code path. That's now been proven three separate times
(cycle 21's own transcript, this cycle's independent skeptic re-run) --
genuinely solid.

**MCP tools (`run_pipeline`, sibling of round 1's class):** the round-1 fix
(create_rest/create_sql_data_source) was correct and confirmed again, but the
"sweep the class, not the instance" ask stopped one file short. `run_pipeline`
had the identical shape: `outputDataTypeId` promised in write.ts's "Returns"
enumeration, mapped in helioApi.ts from `PipelineSummaryResponse
.outputDataTypeId` -- a field `PipelineProtocol.scala`'s real `jsonFormat9`
never had. Arguably worse than round 1's instance: round 1 produced a
misleading `null`, this produced a silently MISSING key against an explicit
enumeration (`JSON.stringify` drops `undefined`). The skeptic reproduced it
by driving the real `HelioApi.runPipeline` against a fixture matching the
actual Scala shape -- confirmed the key is genuinely absent from every real
result. Root cause of the miss: `runPipelineTruncation.test.ts`'s own fixture
asserted the dead field, so nothing in the suite could have caught it --
fixed with a typed const so a future field drift on either side fails
typecheck.

**Proposal contract (doc precision, not a behavior gap):** the cycle-21
sentinel-guidance rewrite over-corrected -- it replaced one wrong claim with
a differently wrong, self-contradicting one, because it was written from a
plausible-sounding inference (`bindingCandidate` reads only the flat field,
so surely only the flat field is ever "blessed") rather than from
`CombinedProposalService.flatIsBlessed`/`configIsBlessed`'s actual code,
which is a genuinely permissive two-slot model. Read both methods directly
this cycle and rewrote the guidance to match exactly what they accept/reject,
distinguishing "produces a real binding" from "accepted but silently inert"
from "400s the whole call" -- three different outcomes the prior text
collapsed into two, one of them wrong.

**Lesson applied going forward**: this cycle's fixes read the actual service
code (`flatIsBlessed`/`configIsBlessed` line by line, `PipelineProtocol
.scala`'s real case class) before writing guidance text, rather than
extrapolating from a sibling fix's pattern -- the failure mode both round-2
findings share is prose written from inference instead of from the code it
claims to describe.

Gates (fresh, this cycle): `sbt compile`/`Test/compile` clean; helio-mcp
`tsc --noEmit`/`eslint --max-warnings=0`/`prettier --check` all clean; scoped
helio-mcp jest -- 18/18 suites, 181/181 tests; full backend suite --
3523/3523 tests, 235 suites, 0 failures; `check-schema-drift.mjs` green.

## Cycle 23 -- final-gate round 3: the flagship tool-surface test silently ran ZERO tests in CI

Full reports at `openspec/changes/mcp-outputs-proposals-rewrite/skeptic-final-{1-mcp-tools-round3,2-proposal-contract-round3}.md`.

Round 3 targeted the two axes still in play. Proposal-contract CONFIRMed
cleanly -- the skeptic independently re-derived and re-mutation-tested the
cycle-21 `parentStepId` fix (same two failures reproduced) and walked the
cycle-22 sentinel-guidance rewrite branch-by-branch against
`CombinedProposalService.flatIsBlessed`/`configIsBlessed`'s real code,
confirming it matches exactly. No action there.

MCP-tools REFUTEd -- but the assigned `outputDataTypeId` sweep itself is
confirmed genuinely exhausted (independent grep + wire-shape read, zero live
references remaining). The new finding, found DURING that sweep, was far more
serious: `server.test.ts` -- the exact-60-tool-name-set test that is this
ticket's own definitive proof of the entire tool-removal acceptance criterion
-- silently ran ZERO of its 4 tests under CI's actual root jest config
(`Test suite failed to run`, `Tests: 0 total`). Reproduced directly, at the
compiler level, before touching anything:

```
$ npx tsc --noEmit --target ES2022 --module commonjs --moduleResolution node \
    --strict --esModuleInterop --skipLibCheck helio-mcp/src/tools/read.ts
helio-mcp/src/tools/read.ts(36,3): error TS2589: Type instantiation is
  excessively deep and possibly infinite.
helio-mcp/src/tools/read.ts(65,3): error TS2589: Type instantiation is
  excessively deep and possibly infinite.

$ npx tsc --noEmit --target ES2022 --module nodenext --moduleResolution nodenext \
    --strict --esModuleInterop --skipLibCheck helio-mcp/src/tools/read.ts
(0 errors)
```

Also reproduced the actual jest-level symptom directly (not trusted from the
report): an inline ts-jest config pointed at root `tsconfig.json` produced
`FAIL helio-mcp/src/server.test.ts` / `Test suite failed to run` / `Tests: 0
total`, quoting the identical TS2589 at `read.ts:36`/`:65`.

**Root cause, investigated rather than guessed at**: traced module resolution
for both configs via `tsc --traceResolution`. Both `moduleResolution: node`
and `moduleResolution: nodenext` resolve `@modelcontextprotocol/sdk` and
`zod`'s type declarations to the IDENTICAL physical `.d.ts` files (confirmed
by diffing the resolved paths) -- so this is not a dual-package-hazard from
different type entrypoints. The depth blowup is therefore purely in how the
two resolution STRATEGIES themselves traverse the SDK's `zod-compat.d.ts`
conditional/compat types (the SDK's own zod-v3/v4 interop layer) once
`registerTool`'s generic inference reaches it -- classic Node10 resolution's
internal instantiation accounting blows the recursion budget there in a way
NodeNext's does not, even reading the same files.

**Fix, at the root, not a type-level workaround**: `jest.config.cjs` (the
config `npm test`/CI actually uses) now gives ts-jest an explicit `transform`
override forcing `module`/`moduleResolution` to `NodeNext`. This is the
faithful fix, not a band-aid: `helio-mcp` genuinely IS built (`tsc` via its
own `tsconfig.json`) and run (`node dist/index.js`, real ESM `package.json`)
under NodeNext -- the root config was type-checking it under a hybrid mode
nothing in production has ever exercised. Verified this override is safe and
complete by direct enumeration (not assumption): every test file the root
config actually collects, outside its documented exclusions, lives under
`helio-mcp/src/**` -- there is no other test tree this could silently
mis-compile.

**Proof, with CI-shaped commands, not the worktree-scoped one:**

```
$ npx jest --passWithNoTests --testPathPatterns "helio-mcp/src" \
    --testPathIgnorePatterns "/node_modules/" "/openspec/" "/.cursor/" \
    "/frontend/" "/e2e/" "/helio-mcp/dist/"
PASS helio-mcp/src/server.test.ts
  ...
Test Suites: 18 passed, 18 total
Tests:       181 passed, 181 total
```

(Only the worktree-specific exclusion line was lifted for this run -- this
worktree sits inside that excluded path by construction, so the literal
un-lifted command cannot be run and prove anything from here; this is the
closest a from-inside-the-worktree run can get to CI's real invocation, and
it uses the DEFAULT `npx jest` config resolution -- no `--config` override --
matching `npm test`'s literal script.) Re-ran 3x across the fix's
development, including once immediately after `prettier --write` reformatted
`jest.config.cjs` itself, to rule out the reformat silently corrupting the
config object. The worktree-scoped documented command (task 5.9) was also
re-run and stayed green (18/18, 181/181) -- both configs now genuinely agree,
which they never did before this fix.

Retired the "sole evidence" framing on task 5.9's own line per the peer's
ask -- it now states the worktree exclusion is an execution constraint only,
and documents this whole finding inline.

Non-blocking note picked up: `PipelineAnalyzeResponse` (types.ts) was missing
`sourceSchemaDrift` entirely -- added `SourceSchemaDriftResponse`/
`TypeChangedColumnResponse`, mirroring the real 6-field Scala case class.

Gates (fresh, this cycle): helio-mcp `tsc --noEmit`/`eslint
--max-warnings=0`/`prettier --check` all clean; scoped helio-mcp jest --
18/18 suites, 181/181 tests; CI-shaped root-config jest run -- 18/18 suites,
181/181 tests, `server.test.ts` 4/4 (was 0/4 before the fix); `check-schema-
drift.mjs` green. No backend file touched this cycle.
