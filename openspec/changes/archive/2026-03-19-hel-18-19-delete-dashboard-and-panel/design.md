## Context

The FK constraint `panels.dashboard_id REFERENCES dashboards(id)` has no `ON DELETE CASCADE` clause in V1__init.sql. This means deleting a dashboard will fail with a FK violation unless panels are deleted first or the constraint is updated. Two options: (1) add `ON DELETE CASCADE` via a migration, (2) delete panels explicitly in the repository before deleting the dashboard. Option 1 is cleaner and consistent with the schema intent.

## Goals / Non-Goals

**Goals:**
- Backend DELETE endpoints returning 204 on success, 404 if not found
- Frontend delete controls with a lightweight inline confirmation (no modal)
- Redux state stays consistent — deleted items removed from slices, layout entries pruned

**Non-Goals:**
- Soft delete / trash / undo-delete (no recovery path in this ticket)
- Bulk delete
- Confirmation modal (inline confirmation is sufficient at this stage)

## Decisions

**Add ON DELETE CASCADE via migration (V2)**
Rather than manually ordering deletes in application code, delegate cascade to the DB. This is the correct place for referential integrity and keeps the repository simple.

**Inline confirmation, not a modal**
Dashboard delete: the delete button changes to a "Confirm?" button on first click, reverting if the user clicks away. Panel delete: same pattern via the appearance editor or a small overlay on the panel card. Avoids building a modal system for two buttons.

**Panel delete also updates dashboard layout**
When a panel is deleted, its layout entries (lg/md/sm/xs) must be removed from the dashboard. This is done client-side in the `deletePanel` thunk — after the DELETE succeeds, dispatch `updateDashboardLayout` with the panel's ID filtered out. No extra backend round-trip needed since layout is owned by the dashboard.

**Return 204 No Content on successful delete**
Standard REST convention. No body needed.

## Risks / Trade-offs

- [Layout drift] If the layout update after panel delete fails or is skipped, the dashboard layout references a non-existent panel ID. Mitigation: do both in the thunk; if layout update fails, the panel is still gone and the orphaned layout entry is harmless (it will be ignored on next render).
