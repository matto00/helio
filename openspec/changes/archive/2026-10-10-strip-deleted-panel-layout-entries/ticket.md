# HEL-1456: Deleting a panel leaves its layout entries in every breakpoint

## Description

`PanelService.delete` (`backend/.../services/panels/PanelService.scala:360-374`) deletes only the panel row.
`dashboards.layout` keeps the panel's `{panelId,x,y,w,h}` entries in lg, md, sm and xs. The frontend
`deletePanel` thunk (`frontend/src/features/panels/state/panelThunks.ts:156-168`) doesn't remove them either.

(Line refs are pre-split: delete is now `PanelService.scala:168` -> `PanelLifecycleWrites.deleteRow` ->
`PanelRepository.delete`. See `.concertino/runs/HEL-1456/evidence/premise-validation.md`.)

## Effects

* New panels are placed below the ghost entry, because the start row is computed from all stored items
  (`CreatePlacement.scala:59`).
* AutoLayout keeps ghosts as "kept" items and pushes newly packed panels below them (`AutoLayoutService.scala:102-104`).
* `LayoutPolicy` validation counts ghosts, so placing a panel over a ghost's cells can be rejected as an overlap.
* The HEL-1233/1260 repair (`DashboardLayoutRepair.scala:6-20`) only drops stale entries when a breakpoint is already
  invalid or incomplete. A breakpoint whose only problem is ghost entries is never cleaned.

## Repro

1. Create panel A, then panel B below it.
2. Delete B.
3. `GET /api/dashboards/:id`: B's entries are still in every breakpoint. (No authenticated GET-by-id exists; read
   the layout via `GET /api/dashboards` or `GET /api/dashboards/:id/export`.)
4. Create panel C: its y is below B's old bottom on every breakpoint.

## Acceptance criteria

* Deleting a panel removes its entries from every breakpoint, in the same transaction as the row delete and with the
  same locking as `PanelLayoutPlacement`.
* The bulk delete `deleteByOutputIdInternal` (`PanelRepository.scala:205`) does the same.
* A one-off repair strips existing ghost entries.
* Tests: creating a panel after a delete leaves no gap; auto-layout after a delete adds no offset.

Verified against origin/main e4289e6c.

## Driver additions (orchestrator brief)

* Validate against every delete path: UI, `DELETE /api/panels/:id`, MCP `delete_panel`, patch-set apply and undo,
  teardown — plus (premise validation) the DB-cascade paths: Output delete via pipeline step / pipeline / root /
  data-source delete (`panels.output_id ON DELETE CASCADE`, V94).
* Every new test fails first against unfixed code; a client/server seam test plus a live dev-DB row check.
* New embedded-PG specs use `VerifiedEmbeddedPostgres.start`; `[hel1468-guard]` appears in sbt runs.
* Do not widen the layout last-write-wins race (HEL-1457, out of scope); state how the fix interacts with it.
