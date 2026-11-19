## Why

Insight Outputs (HEL-921) can be configured (L1), grounded and validated (L3) and stored/read (L2), but nothing ever
renders one. This leaf adds the triggers that call the model, with the owner's cost guards, so an insight actually
appears after a run, daily, or on demand.

## What Changes

- New `InsightRenderService` with `renderForRun`, `renderDaily`, `refresh` (manual) and `latestFor(outputId)`.
- After a real run's `succeeded` publish, `on_run` insights of that pipeline render asynchronously; the run never waits
  on, or fails because of, a render. Dry runs and draft previews never render.
- Guards, in order: unchanged input digest skip, at most one model call per Output per hour, owner-keyed weighted quota
  (free tier `skipped_quota`, no model call), 8k-in / 400-out token caps, cost recorded not enforced.
- New optional `model` key on insight config, validated against `ClaudeModelCatalog` (absent = server `CLAUDE_MODEL`).
- `AiPipelineQuotaGate` gains a weight; renders are charged the catalog weight of their model.
- `daily` renders on the existing `PipelineSchedulerService` tick at 06:00 UTC, interval-gated; no new timer.
- `POST /api/outputs/:id/insight/refresh` (owner/editor; viewer 403) with its own rate-limit instance.
- Authenticated insight reads hide model, tokens and cost from viewer grantees (R3).
- In-process `InsightRendered` event (no subscriber yet; the HEL-919 seam).

## Capabilities

### New Capabilities
- `insight-render-triggers`: when and how an insight renders, its guards, billing, manual refresh and the delivery seam.

### Modified Capabilities
- `insight-output-kind`: the config contract gains the optional `model` key.
- `insight-render-store`: the authenticated read shape depends on the caller's pipeline role.

## Non-goals

- Any frontend (L5), ask-your-data (L6/L7), MCP (L8), or actual HEL-919 delivery.
- Enforcing dollars; a new timer; a failure-reason column (see design.md).
- Live renders on Sonnet or Opus.

## Impact

- Backend: `services/insights`, `PipelineRunSucceededWrites`, `PipelineSchedulerService`, `AiPipelineQuotaGate`,
  `ClaudeInsightClient`, `InsightConfig`, `OutputRoutes`, `ApiRoutes`.
- Schemas: insight responses (role-dependent fields), new refresh response.
- Docs: `CLAUDE.md` endpoint list and env table (`INSIGHT_REFRESH_RATE_LIMIT_PER_WINDOW`).
- No migration.

## Fold-ins (owner answer 2026-11-18, debts from HEL-1744/1745/1746)

- Render on pin; refresh body `{"trigger":"pin"}`.
- Frontend: model selector in the Output editor, refresh button on the insight panel, role-correct quota wording.
- Authenticated insight read gains `canRefresh`.
- e2e: the real trigger path replaces the psql seed where a model is not needed.
- Modified capabilities added: `insight-panel`, `insight-authoring`, `ask-ui`.
