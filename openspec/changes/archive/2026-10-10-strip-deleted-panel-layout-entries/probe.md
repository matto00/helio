# HEL-1456 probe (task group 0) -- unfixed code, worktree dev server 9795, dev DB `helio` at V121

Throwaway user `hel1456probe@helio.test` (created via /api/auth/register; owner's account untouched). Layouts read
straight from `dashboards.layout` by exact dashboard id (no authenticated GET-by-id exists).

## 0.1 Single delete (`DELETE /api/panels/:id`, the route the UI thunk calls)
Dashboard 4ece49be-...: created A (24e128e7), A2 (b5a4ceb5), B (998b13fb) -> lg/md/sm/xs each hold 3 items (y 0/5/10).
`DELETE /api/panels/998b13fb...` -> 204. Stored layout afterwards: B's item STILL present in all four breakpoints
(lg, md, sm, xs). Created C (06b5f60f): placed at y=15 in lg/md/sm/xs -- a 5-row gap where B was. Ticket repro confirmed.

## 0.2 Cascade / bulk paths
- Output delete (`DELETE /api/outputs/:id` -> `deleteByOutputIdInternal`): output panel c4d4241c bound to the Output;
  after delete `panels` count for it = 0, its layout item remained in all four breakpoints (ghost).
- Pipeline delete (FK cascade pipelines -> outputs -> panels, no app code): panel 290df6c6 bound to the pipeline's
  Output; after `DELETE /api/pipelines/:id` (204) panel row gone, item present in 4 breakpoints (4 hits).
  Confirms the cascade paths leak ghosts too (the app-level-only fix would miss them).

## 0.3 Prod-count query (verbatim in
`/home/matt/Development/helio/.concertino/runs/HEL-1456/evidence/prod-ghost-count-query.md`; NOT run against prod)
Run against the dev DB as superuser (sees all rows):
`ghost_items=84, dashboards_affected=9, ghost_panel_ids=21, dashboards_total=2708` (12 of the 84 items are the probe's
own three ghosts above). Prod counts remain unmeasured.

## 3.11 Live re-check after the fix (V122/V123 applied to the dev DB by the worktree backend on 9795; backend cwd verified = this worktree)
- V123 on boot: the count query above went 84 ghost items / 9 dashboards -> 0 / 0 (dashboards_total 2708 unchanged).
- Fresh dashboard: A, B created (y 0, 5); `DELETE /api/panels/B` -> 204 -> stored layout holds only A in every breakpoint (4 items);
  C created -> y=5 directly under A (no gap; unfixed code put it at y=15 after the same sequence).
- Output delete (`DELETE /api/outputs/:id`, 200) and pipeline delete (204, FK cascade): the bound output panels' items vanished from all four breakpoints.
- `PATCH /api/dashboards/:id` with lg = [A, C, <non-panel id>]: response and stored layout hold no item for the non-panel id in any breakpoint.
- Cleaned up by exact id: both probe dashboards, four pipelines/sources via the API, then the throwaway user and its sessions by exact id (all counts 0).
