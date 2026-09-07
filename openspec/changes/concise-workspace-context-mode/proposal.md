## Why

Both MCP tools named by HEL-865 become unusable at the scale where they matter most. A realistic-fidelity
25-source / 43-pipeline workspace measures **465,036 bytes** against `get_workspace_context`'s 200,000-byte
budget (2.3x over) — and today nothing is done about it: `applyBudget` measures the overflow, hardcodes
`applied: false` (`context.ts:241`, `:290`), and returns the full payload anyway. The overflow is detected and
then ignored.

Separately, HEL-914 shipped `analyze_pipeline`'s concise mode **only at the REST layer**. The MCP tool declares
`inputSchema: { pipelineId }` and sends no query params, so the capability is unreachable from the agent
surface this ticket is about. `grep -rin concise helio-mcp/` returns zero hits.

## What Changes

- Wire the existing backend `?concise=true` through the `analyze_pipeline` MCP tool: an opt-in `concise`
  parameter forwarded as a query param, mirroring how `runPipeline` already passes `{ dry: "true" }`.
- Add an opt-in concise mode to `get_workspace_context`, which currently accepts no parameters at all.
- Make omission **detectable**: `truncation.applied` becomes genuinely `true` for the first time, and what was
  omitted is enumerated per affected entity, following the always-present-never-`undefined` convention
  HEL-861/HEL-890 established (`helioApi.ts:104-137`).
- State size behaviour in both tools' descriptions, so an agent can predict which mode it needs.
- Replace the existing 25/43 test fixture's per-entity fidelity, which is too thin to reproduce the problem
  (10 columns/source, 1 step/pipeline, and an empty `laneTree` for all 43 pipelines because its fake API lacks
  `getPipeline` and `context.ts:501-522` swallows the failure).

Not breaking: verbose stays the default, matching HEL-914's precedent for the analyze half. Every field the
full response already carried keeps its previous value; it additively gains one key,
`truncation.omittedDetailKinds: []`, because that field must always be present rather than `undefined`. No
existing field changes.

## Capabilities

### New Capabilities
- `mcp-concise-response-modes`: opt-in bounded representations for `get_workspace_context` and
  `analyze_pipeline`, with a stated omission rule and caller-detectable truncation.

### Modified Capabilities
None. `workspace-context-assembly` governs the backend `GET /api/workspace/context`, which the MCP tool never
calls — it fans out client-side across ~8 REST endpoints (`context.ts:16-24`).

## Non-goals

- **HEL-979 is not addressed.** That ticket bounds *work performed* by `WorkspaceContextService.assemble` on the
  backend route. This change bounds *response size* on the MCP client-side path. Different code paths; this PR
  must not be read as having fixed it.
- No general cross-tool response-size guard. Noted as a follow-up.
- No change to the backend concise-analyze implementation, which already exists and is tested.

## Impact

`helio-mcp/src/context.ts`, `helio-mcp/src/tools/read.ts`, `helio-mcp/src/helioApi.ts`, and their tests. **No
`schemas/` change**: that directory is route-scoped and the MCP snapshot is assembled client-side with no route
of its own (tasks 5.1-5.3). No migration: this change adds no persisted state (main is at V102).
