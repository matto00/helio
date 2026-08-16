## Why

An agent that builds and refreshes pipelines has no way to add assertions when authoring, nor to read
assertion outcomes when reasoning about whether a dashboard's data is trustworthy. This is the last
ticket in the HEL-419 epic — it surfaces 419-A's `assert` step and 419-B's per-run results through
helio-mcp, closing the loop for agent-driven workflows the same way HEL-576 closed it for the in-app UI.

## What Changes

- `add_pipeline_step`'s description gains the `assert` op's documented shape (`config: {rules:
  [{kind, field?, params, severity}]}`, six v1 kinds), matching every other op's existing
  documentation-only convention.
- A new, strict, exported Zod schema for assert rules validates `config` specifically when `type ===
  "assert"`, inside the tool's handler — invalid rule shapes are rejected before any network call. This
  does not restructure `add_pipeline_step`'s registered `inputSchema` (which must stay a flat, per-op-
  agnostic raw shape for the MCP SDK's own JSON-schema generation — see design.md), so it is additive
  validation layered on top of the existing generic `config: z.record(z.unknown())`, not a replacement.
- `WorkspaceContext.pipelines[]` gains `lastRunAssertions` — a compact, always-present summary (passed/
  warnFailed/errorFailed counts + failing messages), sourced from `GET /api/pipelines/:id/run-history`'s
  first (most recent) entry's `assertions` field (HEL-576).
- `get_workspace_context`'s tool description gains an explanation of `lastRunAssertions` as the
  trustworthiness signal for a pipeline's most recent run (the description does not currently explain
  `lastRunStatus` either — this ticket adds the first such explanation, not a second one alongside an
  existing one).
- New types in `helio-mcp/src/types.ts` (`AssertionSummaryResponse`/`AssertionFailureDetailResponse`),
  a new `HelioApi.getPipelineRunHistory(pipelineId)` method.

## Capabilities

### New Capabilities

- `mcp-assert-step-authoring`: the `assert` op's shape documented + Zod-validated in `add_pipeline_step`.
- `mcp-assertion-results-grounding`: `lastRunAssertions` in `get_workspace_context`.

### Modified Capabilities

(none — additive fields/tool-description changes only; no existing MCP tool's documented contract is
contradicted)

## Impact

- `helio-mcp/src/tools/write.ts` (new assert-config Zod schema + handler-level validation, description
  update), `helio-mcp/src/tools/read.ts` (`get_workspace_context` description), `helio-mcp/src/context.ts`
  (`pipelines[]` extended, new per-pipeline run-history fetch in the existing fan-out),
  `helio-mcp/src/helioApi.ts` (new `getPipelineRunHistory` method), `helio-mcp/src/types.ts` (new types).
- No backend changes — every field/endpoint this ticket reads from already exists (HEL-454/509/570/576).
- No frontend changes.

## Non-goals

- Backend evaluation/persistence (419-B), blocking policy (419-C), in-app UI (419-A editor / 419-D) — all
  already shipped, out of scope here.
- Restructuring `add_pipeline_step`'s `inputSchema` into a per-op discriminated union covering all 22 op
  kinds — considered and rejected (design.md) as disproportionate scope for one op.
- Extending `boundPipelineStepSchema`/`pipelineProposal.ts`'s proposal-based step schema with the same
  assert validation — considered, and named explicitly as a design.md open note, but the ticket's own
  Scope section names only `add_pipeline_step`.
