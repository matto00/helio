## 1. Backend

- [x] 1.1 Add `id: Option[String]` to `DashboardSnapshotPanelEntry` (`backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala`); populate `Some(panel.id.value)` in `fromDomain`; bump `jsonFormat5` to `jsonFormat6`.
- [x] 1.2 Verify (read, do not change unless a real defect is found) `DashboardSnapshotRepository` and `DashboardServiceValidation` still key exclusively off `snapshotId` and are unaffected by the new field.
- [x] 1.3 Do not bump `DashboardSnapshotPayload.CurrentVersion` (design.md D3) — confirm the import version-check test still expects `2`.

## 2. helio-mcp

- [x] 2.1 Add `id?: string` to `SnapshotPanelEntry` in `helio-mcp/src/types.ts`.
- [x] 2.2 Update the `get_dashboard` tool description in `helio-mcp/src/tools/read.ts` to state each panel carries a stable `id`.

## 3. Frontend

- [x] 3.1 Add `id?: string` to `DashboardSnapshotPanelEntry` in `frontend/src/features/dashboards/types/dashboard.ts`.

## 4. Docs / Spec sync

- [x] 4.1 Confirm `openspec/changes/reconcile-panel-id-export/specs/dashboard-export-import/spec.md` delta (already drafted in planning) matches the implemented behavior; adjust only if implementation diverged.

## 5. Tests

- [x] 5.1 Backend: export response includes both `id` and `snapshotId` for a panel, and `id == snapshotId == panel.id.value`.
- [x] 5.2 Backend: import of a snapshot payload with panel entries that omit `id` (simulating a pre-existing exported file) still succeeds and produces the same result as one that includes `id`.
- [x] 5.3 Backend: import remap behavior (layout references, fresh `PanelId` assignment) is unchanged — existing import tests still pass.
- [x] 5.4 Frontend: existing dashboard export/import tests (if any reference the snapshot type) still pass with the new optional field; add/adjust type-level coverage only if needed — no new FE behavior to test.
