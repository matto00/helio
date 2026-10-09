## Why

Crossing the 768px grid-container boundary (desktop grid <-> phone stack, ~1056px viewport with the sidebar) unmounts
and remounts every panel card. Each remount refetches rows (`usePanelData` ignores rows already in Redux) and Output
metadata (`useOutputMeta` has no cache at all), ~40-64 requests per crossing for 8 panels in dev. Three crossings
inside a minute exhaust the 120/60s `/api` limit and panels show "Rate limit exceeded" (measured live, see
`probe-premise.md`). Theme toggles and lg/md/sm resizes do NOT remount or refetch (refuted/confirmed live).

## What Changes

- Rows: a panel card that mounts while Redux already holds a successfully-fetched rows window for the exact query the
  card settles on (card on screen within the last 30s, run baseline known) serves that window instead of refetching;
  an identical in-flight request is reused; exactly one fetcher owns each mount.
- Pipeline run fan-out keeps its last-seen run id across reconnects, so a run that finished while no card was
  subscribed triggers a refresh on reconnect.
- Output metadata: `GET /api/outputs/:id` results are shared across all consumers through one in-memory cache with
  in-flight request merging, retained while the card is on screen or for 30s after it leaves.
- Invalidation: an Output write (update/delete), a pipeline write, or a successful pipeline run invalidates both the
  cached metadata and the cached rows for the affected Outputs, so the next mount fetches fresh data.
- Cold-load double row fetch investigated; fixed if same root cause, else listed as a follow-up.

## Non-goals

- No change to the backend rate limiter or its configuration.
- No restructuring of the desktop/phone shell to keep cards mounted across the swap.
- Not absorbing HEL-1418 (live-resize e2e waits, DesktopPanelGrid.tsx split).
- No change to manual refresh, polling, or SSE-driven refresh: they still always fetch.

## Capabilities

### New Capabilities

- `panel-data-remount-reuse`: panel cards reuse recently fetched rows and Output metadata across a remount, with
  in-flight request merging and write/run-driven invalidation.

### Modified Capabilities

## Impact

Frontend only: `usePanelData.ts`, `usePanelSortFilter.ts`, `PanelCard`/`MobilePanelStack` card components,
`PanelCardBody.tsx`, `useOutputMeta.ts`, `outputService.ts` (write paths invalidate), pipeline write/run
paths, `panelsSlice.ts` (pagination freshness), `pipelineRunFanout.ts` (run-succeeded invalidation), plus tests
(jest red-first + Playwright request-count burst spec). No API, schema, or backend change.
