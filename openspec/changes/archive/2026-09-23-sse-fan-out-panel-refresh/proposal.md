## Why

HEL-1093 shipped the write → debounce → auto-run trigger, but a panel that just wrote data has no
way to know when the downstream pipeline it fed finishes running. Today the only way to see a
freshly-written value reflected in a chart is a manual refresh or a full page reload — the
write-back loop (design spec §4, "Write → run → refresh") is incomplete without the last leg.

## What Changes

- Add a frontend hook that fans a single `usePipelineRunEvents` SSE subscription per relevant
  `pipelineId` out to every dashboard panel bound (via `Output.pipelineId`) to that pipeline, rather
  than one SSE connection per panel — the backend's `PipelineRunRegistry` holds exactly one
  subscriber per pipeline, so multiple naive per-panel connections to the same pipeline would starve
  each other.
- On a `succeeded` event for a watched pipeline, trigger `usePanelData`'s existing `refresh()` for
  every currently-mounted panel bound to that pipeline's Outputs — no dashboard-wide refetch.
- Wire the subscription lifecycle to the dashboard grid (mount while the dashboard is visible;
  reconnect after each terminal event so a later write is still caught), alongside the existing
  `usePanelPolling` call site in `PanelCardBody`.
- No backend change: reuses the existing `GET /api/pipelines/:id/run-events` endpoint and its
  existing sharing-aware access check unmodified.

## Non-goals

- No new SSE endpoint or backend broadcast/multiplexing fix for the pre-existing
  single-subscriber-per-pipeline registry limit outside this ticket's own consolidation (e.g. a
  pipeline-detail-page viewer and a dashboard viewer of the same pipeline concurrently is a known,
  separate limitation — not fixed here).
- No change to `usePipelineRunEvents` itself, `PipelineRunStreamRoutes`, or `PipelineRunRegistry`.
- No optimistic-update UI for the writing panel itself (design spec §4's "Optimistic state" bullet —
  separate ticket).

## Capabilities

### New Capabilities
- `panel-run-refresh`: dashboard panels bound to a pipeline's Output automatically refetch their
  data when that pipeline's run completes successfully, via a shared, fanned-out subscription to the
  existing pipeline run-status SSE channel.

### Modified Capabilities
(none — `pipeline-run-sse` is consumed as-is, unmodified)

## Impact

- Frontend only: a new hook (or hooks) under `frontend/src/features/panels/hooks/`, wired into
  `PanelCardBody`/`PanelCard.tsx` alongside `usePanelPolling`.
- No backend, schema, or migration changes.
- No new API surface.
