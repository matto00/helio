## Context

The codebase has an established pattern for multi-entity operations on dashboards: `DashboardRepository.duplicate` already fetches a dashboard and its panels in a single DB transaction and returns `Option[(Dashboard, Vector[Panel])]`. The `DuplicateDashboardResponse` case class + JSON format in `JsonProtocols` and the route handler in `DashboardRoutes` show the exact pattern to follow.

Export is a read-only projection of this same combined data into a portable snapshot format. Import is the inverse: deserialize a snapshot, assign fresh IDs, and insert. Both stay entirely within the existing repository and route layers — no new actor or service is required.

## Goals / Non-Goals

**Goals:**
- `GET /api/dashboards/:id/export` returns a JSON snapshot containing the dashboard name, appearance, layout (with panel references keyed by `snapshotPanelId`), and the full panel list
- `POST /api/dashboards/import` accepts that snapshot and creates a new dashboard + panels with fresh UUIDs, remapping panel ID references in the layout to the newly assigned IDs
- Invalid payloads (missing required fields, malformed layout references) are rejected with `400 Bad Request` and a descriptive message
- Export and Import actions are surfaced in the frontend (actions menu and create panel respectively)

**Non-Goals:**
- Versioning or schema evolution of the export format — `version` field is written but not validated beyond presence
- Streaming large exports — all dashboards fit in memory at this scale
- Import deduplication — importing the same file twice creates two independent dashboards

## Decisions

### 1. Snapshot format: self-contained, human-readable JSON

The snapshot envelope has three top-level fields:
```json
{
  "version": 1,
  "dashboard": { "name": "...", "appearance": { ... }, "layout": { ... } },
  "panels": [ { "snapshotId": "...", "title": "...", "type": "...", "appearance": { ... } } ]
}
```
The `layout` field uses the same `lg/md/sm/xs` structure as the existing `DashboardLayout`, but `panelId` values are the `snapshotId` strings from the `panels` array (arbitrary strings meaningful only within the snapshot). On import, these are remapped to fresh UUIDs.

`meta` (createdBy, createdAt, lastUpdated) is excluded from the snapshot — it is regenerated on import with `createdBy = "system"` and `now` timestamps, consistent with `duplicate`.

`typeId` and `fieldMapping` are included on each panel entry so data bindings round-trip correctly.

**Alternative**: Reuse `DuplicateDashboardResponse` as the export format. Rejected — that format includes server-assigned IDs and timestamps which would complicate remapping on import and are not human-meaningful in a portable snapshot.

### 2. Import ID remapping in `DashboardRepository`

The `importSnapshot` method on `DashboardRepository` receives a `DashboardSnapshot` domain object (case class, not a raw JSON blob). It:
1. Assigns a new `DashboardId` UUID to the dashboard
2. Assigns a new `PanelId` UUID to each panel entry, building a `snapshotId → newId` map
3. Rewrites the layout using the map
4. Inserts dashboard + panels in a single `transactionally` block

This mirrors `duplicate` exactly, keeping repository logic cohesive.

**Alternative**: Perform remapping in the route handler. Rejected — same rationale as in dashboard-duplication design: mixes infrastructure concerns into routing.

### 3. Export route: `GET /api/dashboards/:id/export`

A plain GET on a sub-path follows the existing `GET /api/dashboards/:id/panels` pattern. Returns `200 OK` with the `DashboardSnapshotResponse` body on success; `404 Not Found` if the dashboard doesn't exist.

### 4. Import route: `POST /api/dashboards/import`

A POST on `/api/dashboards/import` keeps it alongside the other dashboard collection operations. It returns `201 Created` with `DuplicateDashboardResponse` (dashboard + panels with server-assigned IDs) so the frontend can immediately populate Redux state — exactly as `duplicate` does.

Payload validation rejects:
- Missing `version` field
- Missing or empty `dashboard.name`
- Panel entries missing `snapshotId`, `title`, or `type`
- Layout items referencing a `panelId` not present in the panels array

### 5. Frontend — Export: browser download via `URL.createObjectURL`

`exportDashboard(dashboardId)` calls `GET /api/dashboards/:id/export`, receives the JSON, serializes it to a `Blob`, and triggers a browser download using a temporary anchor element. No new dependency. The file is named `<dashboard-name>.json`.

**Alternative**: Open in a new tab / copy to clipboard. Rejected — ticket specifies "export as a JSON file".

### 6. Frontend — Import: file input in the create panel

The existing create-mode form in `DashboardList.tsx` is shown when the `+` button is pressed. The import option is added as a secondary action: a file `<input type="file" accept=".json">` that, on file selection, reads the file with `FileReader`, sends it to `POST /api/dashboards/import`, and handles success/error inline — using the same `isSaving`/`createError` state pattern already present.

**Alternative**: A separate modal. Rejected — adds complexity; the inline pattern is already used for create and keeps the flow simple.

### 7. New case classes and JSON formats

New types added to `JsonProtocols.scala`:
- `DashboardSnapshotPanelEntry(snapshotId, title, type, appearance, typeId, fieldMapping)` — panel representation in the snapshot
- `DashboardSnapshotPayload(version, dashboard: DashboardSnapshotDashboardEntry, panels)` — the full snapshot envelope (used for both import request and export response)
- `DashboardSnapshotDashboardEntry(name, appearance, layout)` — dashboard fields in the snapshot

These are API-layer types; the domain receives a parsed `DashboardSnapshot` value object.

## Risks / Trade-offs

- **Layout references orphaned panels** → Import validates that every `panelId` in the layout exists in the panels array before inserting; returns `400` on mismatch.
- **Invalid `type` string on panel entry** → Import runs `PanelType.fromString` during validation; returns `400` on unknown type.
- **Large dashboard** → Acceptable; no streaming needed at current scale.
- **Version field** → Written as `1`, not validated beyond presence. If the format evolves, validation can be tightened then.

## Migration Plan

No DB schema changes. No Flyway migration needed. The new routes are additive.

## Planner Notes

**Self-approved decisions:**
- Snapshot format design (no external dependency, straightforward JSON)
- Reusing `DuplicateDashboardResponse` as the import success response — avoids a new type and gives the frontend everything it needs to update Redux state identically to `duplicate`
- File download via `URL.createObjectURL` — standard browser API, no new npm dependency
- Inline file input in the create panel (not a modal) — consistent with existing create UX pattern
- `version: 1` written but not validated beyond presence — deferred until format needs to evolve
- `createdBy` set to `"system"` on import — consistent with `create` and `duplicate`
