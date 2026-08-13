# HEL-385: MCP propose_pipeline / analyze / apply tools

## Description

The MCP already exposes dashboard proposal tools (`helio-mcp/src/tools/proposal.ts`: `propose_dashboard` assembles + read-only-validates, `apply_proposal` posts to the backend apply path) and live pipeline write tools (`helio-mcp/src/tools/write.ts`: `create_pipeline`, `add_pipeline_step`, `run_pipeline`). It does NOT expose the reviewable, atomic pipeline-proposal artifact — an external agent can only build a pipeline via live, non-atomic write calls.

This ticket adds MCP tools that let an external agent draft, dry-analyze, and apply a `PipelineProposal` against the new backend endpoints (HEL-342 schema / analyze / apply tickets), mirroring the `propose_dashboard` → `apply_proposal` pattern.

Touches: `helio-mcp/src/tools/proposal.ts` (or a new `tools/pipeline-proposal.ts`), `helio-mcp/src/helioApi.ts` (new client methods), `helio-mcp/src/types.ts`, and tool registration in `helio-mcp/src/index.ts`.

## Scope

* MCP TS: `propose_pipeline` — assemble a `PipelineProposal` (existing sourceId OR inline source spec + ordered steps + output type name) and return `{ proposal, warnings, applyReady }` WITHOUT writing, mirroring `propose_dashboard`'s guarded/validated shape. Zod schema for the proposal (step `type`/`config` per the op set).
* MCP TS: `analyze_pipeline_proposal` — call `POST /api/pipelines/analyze-proposal` to return the projected output schema (dry).
* MCP TS: `apply_pipeline_proposal` — call `POST /api/pipelines/apply-proposal`, returning the created source/pipeline/output-type ids + run summary. Guardrail errors (SQL non-SELECT, fetch failure) surfaced verbatim via the existing `guarded`/`HelioApiError` handling.
* `helioApi.ts`: add the three client methods; keep them thin pass-throughs like the existing ones.
* Tool descriptions encode the canonical `Source → Pipeline → DataType → Panel` path + the read-only SQL rule, consistent with the existing tool prose.
* Tests: MCP unit tests for the zod schemas + that each tool calls the right endpoint and surfaces errors.

## Acceptance criteria

- [ ] `propose_pipeline` returns a validated proposal + warnings and writes nothing.
- [ ] `analyze_pipeline_proposal` returns the projected output schema for the proposal (no writes).
- [ ] `apply_pipeline_proposal` applies atomically via the backend endpoint and returns created ids + run summary; guardrail errors surfaced verbatim.
- [ ] Tools registered in `index.ts`; `helioApi.ts` methods added; descriptions consistent with existing tool prose.
- [ ] MCP build + unit tests green.
- [ ] Backward-compat: purely additive tools; existing MCP tools unchanged.

## Out of scope

* The backend endpoints themselves (HEL-342 schema/analyze/apply tickets).
* In-app (frontend) pipeline authoring (HEL-341 is dashboard-focused; pipeline-authoring UI is not in this epic's scope).

## Dependencies

* Depends on the HEL-342 pipeline-proposal schema, analyze-before-apply, and atomic-apply tickets. Related to HEL-365 (panel-capability introspection) for downstream panel binding.
