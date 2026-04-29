# Write Path Audit

Baseline inventory of every PATCH/POST API call issued during a normal dashboard
editing session, derived from `frontend/src/services/dashboardService.ts`,
`frontend/src/services/panelService.ts`, the corresponding Redux slice thunks
(`dashboardsSlice.ts`, `panelsSlice.ts`), and the triggering UI components.

Scope: user interactions on the dashboard canvas and dashboard list. Data source
and data type CRUD (setup operations) are excluded.

---

## Write Path Table

| # | Endpoint | HTTP Method | Trigger | Payload Fields | Calls per Interaction |
|---|----------|-------------|---------|----------------|-----------------------|
| 1 | `PATCH /api/dashboards/:id` | PATCH | Panel drag or resize completes (on drag/resize stop) | `{ layout: DashboardLayout }` | 1 per drag/resize stop (debounced 250 ms) |
| 2 | `PATCH /api/dashboards/:id` | PATCH | Dashboard appearance save (DashboardAppearanceEditor form submit) | `{ appearance: { background, gridBackground } }` | 1 per save |
| 3 | `PATCH /api/dashboards/:id` | PATCH | Dashboard rename commit (Enter/blur in rename input) | `{ name }` | 1 per rename |
| 4 | `POST /api/dashboards` | POST | Dashboard create (create form submit) | `{ name }` | 1 per create |
| 5 | `POST /api/dashboards/:id/duplicate` | POST | Dashboard duplicate action (ActionsMenu → Duplicate) | _(no body)_ | 1 per duplicate |
| 6 | `POST /api/dashboards/import` | POST | Dashboard import from JSON file (file picker select) | `DashboardSnapshot` (full snapshot JSON) | 1 per import |
| 7 | `PATCH /api/panels/:id` | PATCH | Panel title rename commit (Enter/blur in panel title input) | `{ title }` | 1 per rename |
| 8 | `PATCH /api/panels/:id` | PATCH | Panel appearance save (PanelDetailModal → Appearance tab → Save) | `{ appearance: PanelAppearance }` | 1 per save |
| 9 | `PATCH /api/panels/:id` | PATCH | Panel data binding save (PanelDetailModal → Data tab → Save) | `{ typeId, fieldMapping, refreshInterval }` | 1 per save |
| 10 | `POST /api/panels` | POST | Add panel (AddPanel trigger in dashboard view) | `{ dashboardId, title, type? }` | 1 per add |
| 11 | `POST /api/panels/:id/duplicate` | POST | Panel duplicate action (ActionsMenu → Duplicate) | _(no body)_ | 1 per duplicate |

---

## Payload Shape Details

### 1. Layout update — `PATCH /api/dashboards/:id`

```json
{
  "layout": {
    "lg": [{ "panelId": "...", "x": 0, "y": 0, "w": 6, "h": 5 }],
    "md": [...],
    "sm": [...],
    "xs": [...]
  }
}
```

Full four-breakpoint layout is sent on every call. The layout covers all panels
in the dashboard. For a dashboard with N panels, the array has N items per
breakpoint — 4N layout items total.

**Debounce note**: `PanelGrid.tsx` clears and resets a 250 ms `setTimeout` on
every `onLayoutChange` event. The HTTP call fires once when the timer expires
after drag-stop or resize-stop. This means a single drag interaction issues
exactly one layout PATCH regardless of how many intermediate `onLayoutChange`
events fired. Additionally, an in-flight de-duplication guard (`inFlightLayoutRef`)
suppresses a second concurrent call if the layout hasn't changed since the
in-flight request.

### 2. Dashboard appearance update — `PATCH /api/dashboards/:id`

```json
{
  "appearance": {
    "background": "#1a1a2e",
    "gridBackground": "#16213e"
  }
}
```

Both fields are always sent together (form submits the full appearance object).

### 3. Dashboard rename — `PATCH /api/dashboards/:id`

```json
{ "name": "Operations" }
```

Fires on Enter keypress or input blur. Cancelled if the user presses Escape
(`cancelledRef` guard in `DashboardList.tsx`).

### 4. Dashboard create — `POST /api/dashboards`

```json
{ "name": "Operations" }
```

### 5. Dashboard duplicate — `POST /api/dashboards/:id/duplicate`

No request body. Response: `{ dashboard: Dashboard, panels: Panel[] }`.

### 6. Dashboard import — `POST /api/dashboards/import`

Full `DashboardSnapshot` JSON — includes dashboard metadata, layout, and all
panel entries. Typically hundreds to thousands of bytes depending on panel count.

### 7. Panel title rename — `PATCH /api/panels/:id`

```json
{ "title": "Revenue KPI" }
```

Fires on Enter keypress or input blur. Cancelled if Escape is pressed
(`titleCancelledRef` in `PanelGrid.tsx`).

### 8. Panel appearance update — `PATCH /api/panels/:id`

```json
{
  "appearance": {
    "background": "#0f3460",
    "color": "#e94560",
    "transparency": 0.1,
    "chart": {
      "seriesColors": ["#5470c6", ...],
      "legend": { "show": true, "position": "top" },
      "tooltip": { "enabled": true },
      "axisLabels": {
        "x": { "show": true, "label": "X Axis" },
        "y": { "show": true, "label": "Y Axis" }
      },
      "chartType": "line"
    }
  }
}
```

The `chart` field is included only for panel type `chart`; omitted for
`metric`, `text`, `table`. The full appearance object is always sent (no
partial patching within the appearance field).

### 9. Panel data binding update — `PATCH /api/panels/:id`

```json
{
  "typeId": "dt-abc123",
  "fieldMapping": { "value": "revenue", "label": "month" },
  "refreshInterval": 300
}
```

`typeId` and `fieldMapping` can be `null` (clears the binding). `refreshInterval`
can be `null` (manual refresh).

### 10. Panel create — `POST /api/panels`

```json
{ "dashboardId": "d-abc123", "title": "New Panel", "type": "metric" }
```

`type` is optional; defaults to a server-side default if omitted.

After creation, `createPanel` in `panelsSlice.ts` immediately dispatches
`markDashboardPanelsStale` followed by `fetchPanels` — so panel creation
triggers 2 HTTP calls: `POST /api/panels` + `GET /api/dashboards/:id/panels`.

### 11. Panel duplicate — `POST /api/panels/:id/duplicate`

No request body. After duplication, same stale+refetch pattern as create:
`POST /api/panels/:id/duplicate` + `GET /api/dashboards/:id/panels` = 2 calls.

---

## Session Call-Volume Estimate

A moderate editing session (editing 1 dashboard, working with 5 panels):

| Interaction | Count | API Calls |
|-------------|-------|-----------|
| Dashboard load (read) | 1 | 0 write calls |
| Panel repositions (drag) | 5 | 5 × `PATCH /api/dashboards/:id` |
| Panel resizes | 3 | 3 × `PATCH /api/dashboards/:id` |
| Panel renames | 2 | 2 × `PATCH /api/panels/:id` |
| Panel appearance saves | 2 | 2 × `PATCH /api/panels/:id` |
| Panel data binding saves | 2 | 2 × `PATCH /api/panels/:id` |
| Dashboard appearance save | 1 | 1 × `PATCH /api/dashboards/:id` |
| Dashboard rename | 1 | 1 × `PATCH /api/dashboards/:id` |
| Add panel | 1 | 1 × `POST /api/panels` + 1 × `GET /api/dashboards/:id/panels` |
| **Total write calls** | | **~19 PATCH/POST calls** |

In a heavier session (frequent layout adjustments, many panel edits):

| Interaction | Count | API Calls |
|-------------|-------|-----------|
| Panel repositions/resizes | 20 | 20 × `PATCH /api/dashboards/:id` |
| Panel title/appearance/binding edits | 10 | 10 × `PATCH /api/panels/:id` |
| Dashboard-level updates | 3 | 3 × `PATCH /api/dashboards/:id` |
| Panel adds/duplicates | 3 | 6 calls (POST + GET each) |
| **Total write calls** | | **~39 PATCH/POST calls** |

**Key observation for batch API design**: layout PATCHes dominate in sessions
with frequent repositioning. Each carries the full 4-breakpoint layout for all
panels (payload grows linearly with panel count). A batch endpoint could coalesce
multiple layout updates and mixed-type mutations into a single round-trip.

---

## Source Locations

| File | Role |
|------|------|
| `frontend/src/services/dashboardService.ts` | Dashboard HTTP service (all dashboard PATCH/POST calls) |
| `frontend/src/services/panelService.ts` | Panel HTTP service (all panel PATCH/POST calls) |
| `frontend/src/features/dashboards/dashboardsSlice.ts` | Redux thunks wrapping dashboard service; triggers |
| `frontend/src/features/panels/panelsSlice.ts` | Redux thunks wrapping panel service; triggers |
| `frontend/src/components/PanelGrid.tsx` | Layout drag/resize, panel rename; 250 ms debounce |
| `frontend/src/components/PanelDetailModal.tsx` | Panel appearance and data-binding saves |
| `frontend/src/components/DashboardAppearanceEditor.tsx` | Dashboard appearance save |
| `frontend/src/components/DashboardList.tsx` | Dashboard create, rename, duplicate, import |
