## Standing Constraints

- [C1] In `useLayoutSave`, the previous-store-version ref used for the class-3 adoption check is written INSIDE the layout effect (like `prevLayoutRef`), never in an every-render effect declared before it; otherwise adoption never fires (design-gate skeptic round 1, note 2).

## 1. Backend

- [x] 1.1 `PanelLayoutPlacement.insertAndAppend`: re-read `layout_version` in the same transaction after the layout UPDATE and return it with the placed items; verify with a repository-level spec against the real DB
- [x] 1.2 Plumb the version through `insertPlaced`, `duplicate`, `insertBatchPlaced`, `PanelLifecycleWrites`, `PanelBatchWrites` and `PanelService` to the routes (no `0L` default on the carrier); verify `sbt compile` and existing callers unchanged in behaviour
- [x] 1.3 `PanelResponse.layoutVersion: Option[Long]` (jsonFormat12) set only by `PanelRoutes.placedResponse`; `CreatePanelsBatchResponse.layoutVersion: Option[Long]`; verify GET/list/patch panel JSON has no `layoutVersion` key
- [x] 1.4 Update `schemas/panels/panel.schema.json` and `schemas/panels/create-panels-batch-response.schema.json`; verify the schema-drift check passes

## 2. Frontend

- [x] 2.1 Panel types: optional `layoutVersion` on the create/duplicate response type; verify `npm run typecheck`
- [x] 2.2 `adoptPlacedLayouts` passes `placedLayoutVersion`; `setDashboardLayoutLocally` adopts it only when it equals store version + 1 and the new layout appends at least one item in every breakpoint (skeptic note 5); verify with a reducer unit test (adopt at +1, ignore at +2, ignore when absent)
- [x] 2.3 `useLayoutSave` class-3 branch advances `persistedVersionRef` only when the store version moved to exactly `persistedVersionRef + 1` in that render; update the header comment; verify with the tests in 3.x

## 3. Tests

- [x] 3.1 Backend: create, duplicate and batch responses carry N+1 for a dashboard at N, equal to a subsequent dashboard read; batch carries one top-level value; empty-batch omits it
- [x] 3.2 Backend: a layout write landing before the create yields N+2 on the create response
- [x] 3.3 Frontend (AC 3): create then drag then flush saves with exactly one PATCH, a 200, `expectedLayoutVersion` N+1 and no 409
- [x] 3.4 Frontend (AC 4, I1 regression): concurrent writer races the create (response N+2); the next save sends N, gets a 409, rebases and keeps the other writer's item; also duplicate path adopts at +1
- [x] 3.5 Frontend: a create response at p+1 arrives while a layout PATCH sent at p is in flight; the PATCH gets a 409, rebases and retries, and no item is lost (skeptic note 3)
- [x] 3.6 Existing `DesktopPanelGrid.layoutConflict`, `inflightResponse`, `dashboardsSlice.layoutConflict` and backend layout concurrency specs stay green
