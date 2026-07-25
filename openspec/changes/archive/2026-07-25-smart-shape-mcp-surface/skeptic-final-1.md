## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Diff scope**: `git diff main...HEAD --stat` / `--name-only` — only `helio-mcp/{README.md,scripts/verify.ts,src/{context.ts,helioApi.ts,tools/{read.ts,write.ts},types.ts}}` and this change's `openspec/**` artifacts. Confirmed `git diff main...HEAD -- helio-mcp/src/tools/proposal.ts` is empty (propose_dashboard/apply_proposal genuinely untouched). No `backend/**` file appears in the diff.

- **Wire-shape fidelity**: read `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala` and `backend/src/main/scala/com/helio/api/routes/PipelineShapeRoutes.scala` directly and diffed field-by-field against the new `helio-mcp/src/types.ts` types (`ShapeParamDescriptorResponse`, `RowCountContractResponse`, `OutputFieldContractResponse`, `OutputContractResponse`, `PipelineShapeCatalogEntryResponse`, `ShapeStepExpansionResponse`). Exact match, including the `{kind: "exactly-one"|"at-most-param"|"unbounded"}` discriminated union and the `POST .../expand` request body `{params}` matching `ExpandPipelineShapeRequest(params: JsObject)`.

- **Validate-before-write ordering**: read `helio-mcp/src/helioApi.ts`'s `createPipelineFromShape` — `await this.expandPipelineShape(...)` runs and is fully resolved (throws on failure) before `this.createPipeline(...)` is ever called. An unknown-shapeId or invalid-params call cannot create an orphan pipeline; this matches design.md Decision 2 verbatim.

- **Tool-description accuracy**: read all five shape source files (`SingleRowShape.scala`, `TopNShape.scala`, `TimeSeriesShape.scala`, `PivotMatrixShape.scala`, `PassthroughShape.scala`) and diffed their `paramsSchema` against the params documented in `create_pipeline_from_shape`'s description (`write.ts`) and `list_pipeline_shapes`'s description (`read.ts`). All 5 shape ids, all required/optional params, and all enum value sets (`mode`, `direction`, `agg`, `granularity`) match exactly.

- **Backward compatibility**: `git diff main...HEAD -- helio-mcp/src/tools/write.ts helio-mcp/src/tools/read.ts | grep '^-'` shows only 3 removed lines, all from `get_workspace_context`'s description text being replaced (documented, additive change); `write.ts` has zero removed lines — purely additive.

- **buildWorkspaceContext fan-out**: read `helio-mcp/src/context.ts` — `api.listPipelineShapes()` was added as a 5th entry inside the existing `Promise.all([...])` alongside sources/types/dashboards/pipelines. One flat call, not per-pipeline; the per-pipeline fan-out (`analyze`) is a separate, pre-existing `Promise.all` immediately after. Matches design.md Decision 5 and the ticket's `4+N → 5+N` budget claim.

- **Gates re-run fresh, all green**:
  - `cd helio-mcp && npm run build` — exit 0, no output beyond the tsc invocation.
  - `npm run typecheck` — exit 0.
  - `npx eslint src scripts --max-warnings=0` — exit 0, no output.
  - `npx prettier --check src scripts README.md` — "All matched files use Prettier code style!"
  - Root `npm run lint` (`eslint . --max-warnings=0`) — exit 0, no output.
  - Root `npm run format:check` — clean.
  - Root `npm run check:schemas` — "schemas in sync with JsonProtocols (19 checked across 23 protocol files); panel-type enums in sync (7 surfaces checked)".

- **Live end-to-end verification with my own fresh evidence** (not reused from executor/evaluator): started servers via `scripts/concertino/start-servers.sh` (both already healthy, reused), `assert-phase.sh servers` → `PASS servers`. Logged in as `matt@helio.dev`, minted a brand-new PAT via `POST /api/tokens` (id `ff11dc29-...`, distinct from any prior token), and ran `npm run verify` in `helio-mcp/` against `http://localhost:8480` with that PAT:
  - Exit code 0, terminal output ends in `VERIFY OK`.
  - `list_pipeline_shapes` returned all 5 registered ids with correct `paramsSchema`/`outputContract` content.
  - Valid `top-n` params (`measure: revenue, direction: desc, n: 2`) produced a pipeline with `sort`,`limit` steps in that order.
  - Invalid params (missing `n`) → `isError=true`, message `HelioApiError (status 422) ... top-n shape: missing required field 'n' (expected a positive integer)` — the shape's own message, verbatim, with a `422` status prefix (acceptable per the ticket's own error-propagation framing).
  - Unknown shape id → `isError=true`, message `HelioApiError (status 404) ... Unknown pipeline shape: 'not-a-real-shape'. Valid values: passthrough, pivot-matrix, single-row, time-series, top-n` — verbatim.
  - Pipeline count before/after the two failing calls: 19 → 20 (only the one successful `top-n` pipeline added) — confirms no orphan pipeline on either failure path, reproduced independently of the evaluator's own run (which reported 17→18 on their run — expected to differ since each verify run adds one pipeline to shared dev-DB state; the delta of exactly 1, not 3, is what matters and it held).
  - Both `get_workspace_context` tool and the `helio://workspace/context` resource read returned a 5-entry `pipelineShapes` array.

- **Tests-AC scope check**: confirmed via `find helio-mcp -iname '*.test.ts' -o -iname '*.spec.ts'` (no hits) and `helio-mcp/package.json`'s `scripts` block (no `jest`/`vitest`/`test` script) that there genuinely is no automated unit-test harness for `helio-mcp` — `scripts/verify.ts` really is the project's existing test-harness convention, not a corner cut for this ticket. Read the `verify.ts` diff directly: the new assertions are real (shape-id-set equality, expanded-step-kind equality, `isError`+message-substring checks, and a pipeline-count-delta check) — not tautological, and would catch a regression in the expand-before-write ordering or in error-message propagation.

- **No UI changes** — `git diff --stat` confirms zero `frontend/**` files touched, so DESIGN.md / visual-judgment review (section 4) does not apply to this change.

### Acceptance criteria trace
1. Discover + instantiate → output DataType bindable by a panel: `list_pipeline_shapes` + `create_pipeline_from_shape` live-verified above; `createPipeline` (reused, unmodified) already produces the panel-bindable output DataType per its existing contract. MET.
2. Tool descriptions document every shape id + params: verified field-for-field against backend `paramsSchema`s. MET.
3. Reuses the same backend service the UI uses: `expandPipelineShape`/`createPipelineFromShape` call the HEL-402 `/api/pipeline-shapes/:id/expand` endpoint exclusively — no backend files touched, so single-source-of-truth is structurally guaranteed. MET.
4. Tests: `verify.ts` extended with real, non-tautological assertions, independently re-run against a live backend with fresh evidence. No unit-test framework exists for `helio-mcp` (confirmed, not assumed) so no backend test applies (no new backend endpoint). MET.
5. Backward compatible: `write.ts` diff is purely additive; `read.ts`'s only removal is the superseded `get_workspace_context` description text. MET.

### Verdict: CONFIRM

### Non-blocking notes
- Matches the evaluator's own non-blocking note: `helioApi.ts` (586 lines) and `write.ts` (555 lines) are past CONTRIBUTING.md's informational ~400-line soft-budget, pre-existing growth this ticket adds to. Worth flagging for a future split ticket, not blocking here.
