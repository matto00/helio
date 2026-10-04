# Files modified (HEL-1233)

Backend
- `backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardRepository.scala` — `panelIdsInternal` (unpaged, system ctx) and layout-only compare-and-set `updateLayoutIfUnchanged`
- `backend/src/main/scala/com/helio/services/dashboards/DashboardLayoutRepair.scala` — new: pure repair decision logic (stored-bad filter, validity/uniqueness/subset/no-drop checks)
- `backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala` — `repairLayout` (404/403/400/409, audit `dashboard.layout.repair`); import now stores repaired geometry
- `backend/src/main/scala/com/helio/services/dashboards/DashboardServiceValidation.scala` — `validateImportedLayoutGeometry` replaced by `repairImportedLayoutGeometry` (self-reflow)
- `backend/src/main/scala/com/helio/services/dashboards/README.md` — lists the new file
- `backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala` — `POST /api/dashboards/:id/layout/repair`
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardLayoutRepairRoutesSpec.scala` — new route specs (run on the RLS-enforced app pool)
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardLayoutRepairSeamSpec.scala` — new: server half of the seam
- `backend/src/test/scala/com/helio/infrastructure/persistence/dashboards/DashboardLayoutRepairRlsSpec.scala` — new: RLS pieces (a)(b)(c), rename-survives, 409
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardLayoutValidationSpec.scala` — import-overlap rejection flipped to "stored repaired" + out-of-bounds + unknown-ref still 400
- `backend/src/test/scala/com/helio/api/http/ExistenceNotLeakedRoutesSpec.scala` — new Row for the repair route; Forbidden-producer pin DashboardService 4 -> 5

Frontend
- `frontend/src/features/dashboards/types/dashboard.ts` — `ownerId?` (optional in the type only: ~70 hand-built test fixtures)
- `frontend/src/features/dashboards/state/repairPatch.ts` — new: `buildRepairPatch`, `hasStoredBadBreakpoint`
- `frontend/src/features/dashboards/services/dashboardService.ts` — `repairDashboardLayout`
- `frontend/src/features/dashboards/state/dashboardsSlice.ts` — `repairDashboardLayout` thunk, class-4 fulfilled (only over the expected layout)
- `frontend/src/features/panels/hooks/useStoredLayoutRepair.ts` — new hook
- `frontend/src/features/panels/ui/grid/PanelGrid.tsx` — mounts the hook at every width; header names the HEL-301 exception
- `frontend/src/features/panels/hooks/useLayoutSave.ts` — classification contract header gains the repair write
- `frontend/src/features/layout/README.md`, `frontend/src/features/dashboards/README.md`, `CLAUDE.md` — docs
- `frontend/src/features/audit/ui/actionLabels.ts` — `dashboard.layout.repair` label
- `frontend/src/test/renderWithStore.tsx` — `ownerId?` on the dashboards preload type
- `frontend/src/features/dashboards/state/repairPatch.seam.test.ts` — new: client half of the seam
- `frontend/src/features/panels/ui/grid/PanelGrid.storedLayoutRepair.test.tsx` — new: hook behaviour at desktop and phone width
- `frontend/src/features/panels/ui/grid/PanelGrid.test.tsx` — phone-width contract comment names the repair exception

Shared
- `shared-test-fixtures/layout-repair-seam.json` — new seam fixture (5 cases)

## Red/green records (C1)
- Seam (client): mutate `repairPatch.ts` `patch[bp] = resolved[bp]` -> `patch[bp] = layout[bp]`: `repairPatch.seam.test.ts` 5 failed / 5 total (e.g. overlapping xs: expected y 2, received y 0); restored: 5 passed.
- Client hook: delete the owner clause (`|| ownerId !== currentUserId`): 2 failed (non-owner; phone non-owner); delete the once-guard (`attemptedRef.has`): 2 failed ("rejected repair ... retries": expected 1 call, received 2; local-edit test); restored: 10 passed.
- RLS (b): `panelIdsInternal` withSystemContext -> withUserContext(nil uuid): `(b)` fails "Set() had size 0 instead of expected size 3"; route specs 400 (live panels invisible).
- RLS (c): `updateLayoutIfUnchanged` withUserContext -> withSystemContext: `(c)` fails "true was not equal to false" (stranger write succeeded).
- RLS (a): `findById` owner branch `case Some(caller) if caller.id.value == ownerId` -> `case Some(_)`: `(a)` fails (stranger got Some(Dashboard...) "was not empty").
- Service ownership: delete the `d.ownerId != user.id` -> 403 case in `repairLayout`: grantee spec fails "400 Bad Request was not equal to 403 Forbidden".
All restored; diffs against backups empty.
