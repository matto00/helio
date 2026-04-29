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
- **THEN** it SHALL list PATCH /api/panels/:id for title updates, appearance updates, and data binding updates

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
The audit SHALL note that layout changes (drag/resize) are debounced at 250 ms in `PanelGrid.tsx`,
resulting in a single PATCH call per drag-stop or resize-stop interaction, not one call per
`onLayoutChange` event.

#### Scenario: Debounce behaviour is recorded
- **WHEN** a developer reads the layout-change row in the audit
- **THEN** it SHALL state that the call fires once per drag/resize stop, not once per pixel moved

## Write Path Reference

### Write Path Table

| # | Endpoint | Method | Trigger | Payload Fields | Calls per Interaction |
|---|----------|--------|---------|----------------|-----------------------|
| 1 | `PATCH /api/dashboards/:id` | PATCH | Panel drag or resize stop | `{ layout: DashboardLayout }` | 1 per stop (debounced 250 ms) |
| 2 | `PATCH /api/dashboards/:id` | PATCH | Dashboard appearance save | `{ appearance: { background, gridBackground } }` | 1 per save |
| 3 | `PATCH /api/dashboards/:id` | PATCH | Dashboard rename commit | `{ name }` | 1 per rename |
| 4 | `POST /api/dashboards` | POST | Dashboard create | `{ name }` | 1 per create |
| 5 | `POST /api/dashboards/:id/duplicate` | POST | Dashboard duplicate | _(no body)_ | 1 per duplicate |
| 6 | `POST /api/dashboards/import` | POST | Dashboard import from file | `DashboardSnapshot` | 1 per import |
| 7 | `PATCH /api/panels/:id` | PATCH | Panel title rename commit | `{ title }` | 1 per rename |
| 8 | `PATCH /api/panels/:id` | PATCH | Panel appearance save | `{ appearance: PanelAppearance }` | 1 per save |
| 9 | `PATCH /api/panels/:id` | PATCH | Panel data binding save | `{ typeId, fieldMapping, refreshInterval }` | 1 per save |
| 10 | `POST /api/panels` | POST | Add panel | `{ dashboardId, title, type? }` | 1 POST + 1 GET (refetch) |
| 11 | `POST /api/panels/:id/duplicate` | POST | Panel duplicate | _(no body)_ | 1 POST + 1 GET (refetch) |

### Payload Shape Details

**1. Layout update** — `PATCH /api/dashboards/:id`

Sends the full 4-breakpoint layout covering all N panels in the dashboard (4N items total).
Debounced 250 ms in `PanelGrid.tsx`; fires once per drag/resize-stop. An in-flight
deduplication guard (`inFlightLayoutRef`) suppresses a duplicate concurrent call.

```json
{
  "layout": {
    "lg": [{ "panelId": "...", "x": 0, "y": 0, "w": 6, "h": 5 }],
    "md": [...], "sm": [...], "xs": [...]
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

**7. Panel title rename** — `PATCH /api/panels/:id`

Fires on Enter or blur. Cancelled by Escape (`titleCancelledRef` in `PanelGrid.tsx`).

```json
{ "title": "Revenue KPI" }
```

**8. Panel appearance** — `PATCH /api/panels/:id`

`chart` field included only for panel type `chart`. Full appearance object always sent.

```json
{
  "appearance": {
    "background": "#0f3460", "color": "#e94560", "transparency": 0.1,
    "chart": {
      "seriesColors": ["#5470c6", "..."],
      "legend": { "show": true, "position": "top" },
      "tooltip": { "enabled": true },
      "axisLabels": { "x": { "show": true, "label": "X Axis" }, "y": { "show": true, "label": "Y Axis" } },
      "chartType": "line"
    }
  }
}
```

**9. Panel data binding** — `PATCH /api/panels/:id`

`typeId` and `fieldMapping` can be `null` (clears binding). `refreshInterval` can be `null`.

```json
{ "typeId": "dt-abc123", "fieldMapping": { "value": "revenue", "label": "month" }, "refreshInterval": 300 }
```

**10 & 11. Panel create / duplicate** — `POST /api/panels` and `POST /api/panels/:id/duplicate`

Both dispatch `markDashboardPanelsStale` then `fetchPanels` after success — each create/duplicate
interaction results in 2 HTTP calls: the POST plus a `GET /api/dashboards/:id/panels` refetch.

### Session Call-Volume Estimate

**Moderate session** (5 panels, typical edits):

| Interaction | Count | Write Calls |
|-------------|-------|-------------|
| Panel repositions (drag) | 5 | 5 × PATCH dashboard layout |
| Panel resizes | 3 | 3 × PATCH dashboard layout |
| Panel renames | 2 | 2 × PATCH panel |
| Panel appearance saves | 2 | 2 × PATCH panel |
| Panel data binding saves | 2 | 2 × PATCH panel |
| Dashboard appearance save | 1 | 1 × PATCH dashboard |
| Dashboard rename | 1 | 1 × PATCH dashboard |
| Add panel | 1 | 1 POST + 1 GET |
| **Total** | | **~19 write calls** |

**Heavy session** (frequent repositioning):

~20 layout PATCHes + 10 panel PATCHes + 3 dashboard PATCHes + 6 calls from add/duplicate = **~39 write calls**

**Key observation**: layout PATCHes dominate in heavy sessions. Each carries the full
4-breakpoint layout for all panels (payload size grows linearly with panel count). A batch
endpoint could coalesce multiple layout updates and mixed-type mutations into a single round-trip.

### Source Locations

| File | Role |
|------|------|
| `frontend/src/services/dashboardService.ts` | Dashboard HTTP calls |
| `frontend/src/services/panelService.ts` | Panel HTTP calls |
| `frontend/src/features/dashboards/dashboardsSlice.ts` | Dashboard thunks and triggers |
| `frontend/src/features/panels/panelsSlice.ts` | Panel thunks and triggers |
| `frontend/src/components/PanelGrid.tsx` | Layout drag/resize; 250 ms debounce; panel rename |
| `frontend/src/components/PanelDetailModal.tsx` | Panel appearance and data binding saves |
| `frontend/src/components/DashboardAppearanceEditor.tsx` | Dashboard appearance save |
| `frontend/src/components/DashboardList.tsx` | Dashboard create, rename, duplicate, import |
