# HEL-1266: Analyze reports costVerdict.canRun = true even when a step has a validationError

## Description

origin_kind: followup
origin_ticket: HEL-1147

Reported by the HEL-1147 lane and not verified by the driver.

`GET /api/pipelines/:id/analyze` (and analyze-proposal) report a step's `validationError`, but `costVerdict.canRun`
stays `true`. A caller such as the UI Run button, an agent or MCP `analyze_pipeline` that trusts `canRun` will submit
a run that is certain to fail.

## Acceptance Criteria

- `canRun` is false whenever any step has a `validationError`, and the reason is included.
- Find every consumer of `canRun` (frontend, helio-mcp, AssistantService/agent tools) and confirm none relies on the
  old behaviour. Keep the schemas in sync.
- Red before the fix, green after.

## Driver additions (dispatch brief, binding for this run)

- Reproduce the claim live first (worktree's own backend port, before any fix).
- Enumerate every consumer of `canRun` and `costVerdict`: the frontend Run button and cost UI, helio-mcp
  `analyze_pipeline` / `analyze_pipeline_proposal`, AssistantService and agent tools, and apply-proposal gating.
  Confirm none relies on the old behaviour; update any that should now surface the reason.
- Schemas in sync. A seam test covers the response shape the frontend reads.
- New route specs extend `com.helio.testkit.HelioRouteTest` (HEL-1228).
- No migration expected. Do not touch PipelineRunService's run-success/snapshot region (HEL-1271 lane).
- Red before the fix, green after, plus a mutation. UI change => live check in light and dark.

## Premise validation findings (Setup step 2, minor-staleness)

- Confirmed at code level: `canRun` is a pure owner-or-editor permission bit (HEL-1096 D1); step validationErrors never
  feed it.
- The proposal-mode analyze response (`POST /api/pipelines/analyze-proposal`) carries NO `costVerdict`, so the AC is
  vacuous there; scope is the non-concise `GET /api/pipelines/:id/analyze`.
- The always-visible "Run pipeline" button does not read `canRun`; only the HEL-1096 denial block's "Run to update"
  button does.
- helio-mcp's `CostVerdictResponse` type omits `canRun` entirely (type drift).
