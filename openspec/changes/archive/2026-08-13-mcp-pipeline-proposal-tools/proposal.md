## Why

The MCP already exposes the dashboard proposal pattern (`propose_dashboard` → `apply_proposal`) but
only live, non-atomic pipeline write tools (`create_pipeline`/`add_pipeline_step`/`run_pipeline`). Now
that the backend's pipeline-proposal schema (HEL-379), dry-analyze (HEL-381), and atomic apply (HEL-383)
endpoints are all merged, an external agent has no way to draft, review, and atomically commit a
pipeline the same reviewable way it already can a dashboard.

## What Changes

- New MCP tool `propose_pipeline`: assembles a `PipelineProposal` wire body from typed input and
  returns `{ proposal, warnings, applyReady }` without writing — mirrors `propose_dashboard`'s
  guarded/validated shape, with a read-only existence check when `sourceId` is given.
- New MCP tool `analyze_pipeline_proposal`: calls `POST /api/pipelines/analyze-proposal` (HEL-381) and
  returns the projected per-step output schema — dry, no writes.
- New MCP tool `apply_pipeline_proposal`: calls `POST /api/pipelines/apply-proposal` (HEL-383) and
  returns the created source (if any)/pipeline/output-type ids + run summary; guardrail errors (SQL
  non-SELECT, inline-source name/config presence, fetch failure) surfaced verbatim via the existing
  `guarded`/`HelioApiError` handling — no new error-translation logic.
- `helioApi.ts`: three new thin pass-through client methods.
- `types.ts`: new `PipelineProposal`/`PipelineProposalSource`/`PipelineAnalyzeProposalResponse`/
  `PipelineProposalApplyResponse` interfaces mirroring the backend wire shapes exactly.

## Capabilities

### New Capabilities

- `mcp-pipeline-proposal-tools`: `propose_pipeline`/`analyze_pipeline_proposal`/
  `apply_pipeline_proposal` MCP tools, their zod schemas, and the client/type plumbing that backs them.

### Modified Capabilities

(none — the backend endpoints and `PipelineProposal` schema/protocol are consumed unchanged)

## Impact

- New: `helio-mcp/src/tools/pipelineProposal.ts` (tool registration), `helio-mcp/src/tools/
  pipelineProposalValidation.ts` (pure warnings helper, split out for the same TS2589
  deep-type-instantiation reason `proposalValidation.ts`/`metricSchemas.ts` already document).
- Modified: `helio-mcp/src/helioApi.ts` (three new methods), `helio-mcp/src/types.ts` (new
  interfaces), `helio-mcp/src/index.ts` (tool registration wiring).
- No backend changes — HEL-379/381/383 already merged and unchanged by this ticket.
- Additive only: no existing MCP tool signature changes.

## Non-goals

- The backend endpoints themselves (already shipped in HEL-379/381/383).
- In-app (frontend) pipeline authoring (out of this epic's scope per the ticket).
- Combining a pipeline proposal with a dashboard proposal in one call (separate ticket).
- Expanding what the backend's `apply-proposal` supports (e.g. inline `csv` sources remain rejected at
  apply time per HEL-383 design.md D3 — this ticket's tools pass that constraint through verbatim,
  never work around it).
