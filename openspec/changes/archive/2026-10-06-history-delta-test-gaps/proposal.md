## Why

HEL-1275 (L5) shipped the metric delta/sparkline with three test gaps. The public dashboard page's choice of the
public, summary-only history route has no page-level test. The e2e "editor -> back, no reload" step never checks that
there was no reload. The e2e layout wait can pass on reads taken before the grid reflows. The fourth gap from the
ticket (old-baseline identity) moved into HEL-1326 D4 by owner ruling and is out of scope here.

## What Changes

- A new RTL test pins `PublicDashboardViewerPage` -> `PanelContent` -> metric history to the public history route.
- `e2e/hel1275-metric-delta-sparkline.spec.ts`: the editor -> dashboard step asserts no full document load.
- The same spec: after a viewport resize, the wait first sees the card width change, then waits for the box to settle.
- Tests only. No product code, API, schema or migration change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change is test-only and sets `skip_specs: true`.

## Impact

- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.history.test.tsx` (new).
- `e2e/hel1275-metric-delta-sparkline.spec.ts` (edited).

## Non-goals

- Item 1, the server-side old-baseline identity check (HEL-1326 D4). No `OutputHistoryService` or history-schema edits.
- `PublicDashboardRoutes` / its resolvers (HEL-1291 split; HEL-1337 running), and the L7 (HEL-1277) scrubber files.
- `ci.yml`, `playwright.config.ts`, `.gitignore`.
