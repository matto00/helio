# HEL-1619: helio-mcp: bound get_workspace_context request volume so one call can't exhaust the 120/60s rate limit

## Description

origin_kind: followup
origin_ticket: HEL-1617

Found while fixing HEL-1617 (PR matto00/helio#1047). That fix stops a 429 from crashing helio-mcp. It does not reduce how many requests one `get_workspace_context` call sends, and that volume is what trips the rate limit in the first place.

### Request count per call (`helio-mcp/src/context.ts` `buildWorkspaceContext`, `contextControls.ts`)

* **8 fixed:** 4 core (`listDataSources`, `listDashboards`, `listPipelines`, `listPipelineShapes`), 2 agent-context (`getAgentPreferences`, `listAgentMemory`), 1 `listConnectorInstances`, and at least 1 `listAllOutputs` page.
* **3 per pipeline:** `analyzePipeline`, `getPipelineRunHistory`, `getPipeline`. (Premise validation: `getPipeline` is itself 2 GETs, so the real figure is 4 per pipeline.)
* **1 per Output:** `listOutputPanels`.
* **1 per distinct dashboard snapshot:** `getDashboardSnapshot`, for the panel-controls lookup.
* Every fan-out is an unbounded `Promise.all`, so there is no concurrency cap.

A 55-pipeline workspace sends at least 8 + 165 = 173 requests before counting any Outputs or snapshots (measured: 339 on a 55-pipeline / 110-Output fixture). That is above the default `RATE_LIMIT_REQUESTS_PER_WINDOW` of 120 per 60s window.

### Design options (need their own design pass)

1. **Bounded concurrency:** a small pool for the per-pipeline and per-Output fan-outs. Spreads requests over time but does not reduce how many are sent.
2. **Slimmer default:** make per-pipeline detail and/or placements opt-in, or lazy in concise mode.
3. **Fewer round-trips:** cache or reuse the controls lookup and per-dashboard snapshots, or use the backend's single `GET /api/workspace/context` aggregate where it already provides the same fields.

## Acceptance Criteria

* A test shows that a 55-pipeline fixture workspace's `get_workspace_context` call stays within the 120/60s budget, or within a stated, measured bound.
* No field in the default payload is dropped without a documented opt-in to get it back.
