## Purpose

Baseline inventory of every PATCH/POST API call issued during a normal dashboard editing session.
Serves as the source of truth for call volume, payload shapes, and triggering interactions to
inform the batch write API design (HEL-135).

Scope: user interactions on the dashboard canvas and the dashboard list sidebar. Data source and
data type CRUD (setup operations) are excluded.

## Requirements

---

### Requirement: Write path audit document exists
The codebase SHALL contain a `write-path-audit` spec that enumerates every PATCH/POST call
issued during a normal dashboard editing session, including the endpoint, triggering user action,
request payload shape, and estimated call frequency per session.

#### Scenario: Audit covers all dashboard-level write paths
- **WHEN** a developer reviews the write-path-audit spec
- **THEN** it SHALL list PATCH /api/dashboards/:id for layout updates, appearance updates, and renames

#### Scenario: Audit covers all panel-level write paths
- **WHEN** a developer reviews the write-path-audit spec
- **THEN** it SHALL list POST /api/panels/updateBatch for staged panel title and appearance edits (flushed by the auto-save tick, Save now, or unmount), and PATCH /api/panels/:id for Output swaps (`config.outputId`)

#### Scenario: Audit covers creation and duplication paths
- **WHEN** a developer reviews the write-path-audit spec
- **THEN** it SHALL list POST /api/panels (create), POST /api/panels/:id/duplicate, and POST /api/dashboards/:id/duplicate

#### Scenario: Audit documents payload shapes
- **WHEN** a developer reads the audit for any write path
- **THEN** the spec SHALL describe the JSON request body fields sent in that call

#### Scenario: Audit documents call frequency
- **WHEN** a developer reads the audit
- **THEN** the spec SHALL include a per-interaction frequency estimate (e.g., 1 call per drag-stop, 1 call per rename commit) suitable for estimating batch API savings

### Requirement: Write path audit is accurate to the current implementation
The audit SHALL be derived from a direct reading of the service layer (`dashboardService.ts`,
`panelService.ts`), the Redux slice thunks, and the triggering components as they exist at the
time the ticket is worked.

#### Scenario: No undocumented write paths remain
- **WHEN** a developer cross-checks every `httpClient.patch` and `httpClient.post` call in the frontend services
- **THEN** every such call SHALL appear in the audit document

### Requirement: Write path audit documents the layout debounce
The audit SHALL note that layout changes (drag/resize) are not sent per `onLayoutChange` event: a completed
drag/resize is staged locally and persisted by the shared 30-second auto-save interval, Save now, or the desktop
grid's unmount flush, resulting in at most one layout PATCH per flush regardless of how many interactions were
staged since the last one.

#### Scenario: Debounce behaviour is recorded
- **WHEN** a developer reads the layout-change row in the audit
- **THEN** it SHALL state that the call fires at most once per flush (auto-save tick, Save now, or unmount), not once
  per pixel moved or per drag/resize stop

## Write Path Reference

### Write Path Table

| # | Endpoint | Method | Trigger | Payload Fields | Calls per Interaction |
|---|----------|--------|---------|----------------|-----------------------|
| 1 | `PATCH /api/dashboards/:id/update` | PATCH | Panel drag/resize/undo/redo, flushed by auto-save, Save now or grid unmount | `{ fields: ["layout"], dashboard: { layout: DashboardLayout } }` | at most 1 per flush (no debounce) |
| 2 | `PATCH /api/dashboards/:id` | PATCH | Dashboard appearance save | `{ appearance: { background, gridBackground } }` | 1 per save |
| 3 | `PATCH /api/dashboards/:id` | PATCH | Dashboard rename commit | `{ name }` | 1 per rename |
| 4 | `POST /api/dashboards` | POST | Dashboard create | `{ name }` | 1 per create |
| 5 | `POST /api/dashboards/:id/duplicate` | POST | Dashboard duplicate | _(no body)_ | 1 per duplicate |
| 6 | `POST /api/dashboards/import` | POST | Dashboard import from file | `DashboardSnapshot` | 1 per import |
| 7 | `POST /api/panels/updateBatch` | POST | Staged panel title rename commit and detail-modal appearance save, flushed by auto-save, Save now or grid unmount | `{ fields: string[], panels: [{ id, title?, appearance? }] }` | at most 1 per flush (edits to several panels share the call) |
| 8 | _(retired)_ | | Panel appearance saves no longer have their own call; they are staged and sent through row 7 | | |
| 9 | `PATCH /api/panels/:id` | PATCH | Output panel "Swap output" (`OutputPicker`) | `{ config: { outputId } }` | 1 PATCH + 1 GET (refetch) |
| 10 | `POST /api/panels` | POST | Add panel | `{ dashboardId, title, type? }` | 1 POST + 1 GET (refetch) |
| 11 | `POST /api/panels/:id/duplicate` | POST | Panel duplicate | _(no body)_ | 1 POST + 1 GET (refetch) |

### Payload Shape Details

**1. Layout update** — `PATCH /api/dashboards/:id/update`

Sends the full 4-breakpoint layout covering all N panels in the dashboard (4N items total).
Not debounced: a drag/resize stop or an undo/redo is staged locally and sent by the 30 s auto-save tick,
Save now, or the desktop grid's unmount flush (`features/panels/hooks/useLayoutSave.ts`,
`usePanelUpdatesFlush.ts`), at most once per flush. An in-flight
deduplication guard (`inFlightLayoutRef`) suppresses a duplicate concurrent call.

```json
{
  "fields": ["layout"],
  "dashboard": {
    "layout": {
      "lg": [{ "panelId": "...", "x": 0, "y": 0, "w": 6, "h": 5 }],
      "md": [...], "sm": [...], "xs": [...]
    }
  }
}
```

**2. Dashboard appearance** — `PATCH /api/dashboards/:id`

Both fields always sent together (full appearance object from the form).

```json
{ "appearance": { "background": "#1a1a2e", "gridBackground": "#16213e" } }
```

**3. Dashboard rename** — `PATCH /api/dashboards/:id`

Fires on Enter or blur. Cancelled by Escape (`cancelledRef` in `DashboardList.tsx`).

```json
{ "name": "Operations" }
```

**7 & 8. Panel title and appearance edits** — `POST /api/panels/updateBatch`

A title rename (Enter or blur; cancelled by Escape via `titleCancelledRef` in `usePanelTitleEditing.ts`) and the detail
modal's appearance save (`PanelDetailModal.tsx`) both call `accumulatePanelUpdate`, which stages the edit locally. The
staged set is sent by `usePanelUpdatesFlush.ts` (30 s auto-save tick, Save now, or grid unmount) as one
`buildBatchRequest` call, at most once per flush however many edits and panels were staged. The detail modal's
appearance payload is `{ background, color, transparency }` (no `chart` field).

```json
{
  "fields": ["title", "appearance"],
  "panels": [
    { "id": "...", "title": "Revenue KPI", "appearance": { "background": "#0f3460", "color": "#e94560", "transparency": 0.1 } }
  ]
}
```

**9. Panel output swap** — `PATCH /api/panels/:id`

Fires when the user picks a different Output in the detail modal's "Swap output" picker (`swapPanelOutput`); the panel
keeps its position and size (dispatched from `OutputPicker.tsx`). It then refetches the dashboard's panels (`GET /api/dashboards/:id/panels`).

```json
{ "config": { "outputId": "out-abc123" } }
```

**10 & 11. Panel create / duplicate** — `POST /api/panels` and `POST /api/panels/:id/duplicate`

Both dispatch `markDashboardPanelsStale` then `fetchPanels` after success — each create/duplicate
interaction results in 2 HTTP calls: the POST plus a `GET /api/dashboards/:id/panels` refetch.

### Session Call-Volume Estimate

**Moderate session** (5 panels, typical edits):

| Interaction | Count | Write Calls |
|-------------|-------|-------------|
| Panel repositions (drag) | 5 | staged, folded into the flushes (no per-drag call) |
| Panel resizes | 3 | staged, folded into the flushes (no per-resize call) |
| Panel renames + appearance saves | 4 | folded into the flushes (staged, no per-edit call) |
| Panel output swaps | 2 | 2 × PATCH panel + 2 GET |
| Auto-save flushes (assumed 3) | 3 | up to 3 × PATCH dashboard layout + up to 3 × POST panels/updateBatch |
| Dashboard appearance save | 1 | 1 × PATCH dashboard |
| Dashboard rename | 1 | 1 × PATCH dashboard |
| Add panel | 1 | 1 POST + 1 GET |
| **Total** | | **up to ~11 write calls** (3 layout + 3 batch + 2 swaps + 1 dashboard appearance + 1 rename + 1 add) |

**Heavy session** (frequent repositioning):

up to ~20 layout PATCHes (one per flush with pending layout) + up to ~10 panel updateBatch POSTs + 3 dashboard PATCHes + 6 calls from add/duplicate = **up to ~39 write calls**

**Key observation**: layout PATCHes dominate in heavy sessions. Each carries the full
4-breakpoint layout for all panels (payload size grows linearly with panel count). HEL-155
introduced `PATCH /api/dashboards/:id/update` and `POST /api/panels/updateBatch` to provide
clean resource-scoped write paths; layout is staged and fires at most once per flush (see row 1) via the dashboard
update endpoint.

### Source Locations

| File | Role |
|------|------|
| `frontend/src/features/dashboards/services/dashboardService.ts` | Dashboard HTTP calls |
| `frontend/src/features/panels/services/panelService.ts` | Panel HTTP calls |
| `frontend/src/features/dashboards/state/dashboardsSlice.ts` | Dashboard thunks and triggers |
| `frontend/src/features/panels/state/panelThunks.ts` | Panel thunks and triggers (re-exported by `panelsSlice.ts`) |
| `frontend/src/features/panels/hooks/useLayoutSave.ts` | Layout drag/resize/undo/redo staging and flush (no debounce) |
| `frontend/src/features/panels/hooks/usePanelUpdatesFlush.ts` | 30 s auto-save tick and Save now |
| `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` | Staged panel appearance (and title) edits |
| `frontend/src/features/panels/ui/grid/usePanelTitleEditing.ts` | Staged panel title edits |
| `frontend/src/features/panels/ui/OutputPicker.tsx` | Output swap (`swapPanelOutput`) |
| `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` | Dashboard appearance save |
| `frontend/src/features/dashboards/ui/DashboardList.tsx` | Dashboard create, rename, duplicate, import |
