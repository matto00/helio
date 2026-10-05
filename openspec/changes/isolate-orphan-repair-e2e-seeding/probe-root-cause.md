# HEL-1289 root-cause probe (orchestrator, Planning, unmodified spec at fba0d78f)

Command (worktree, own servers DEV_PORT=6721 / BACKEND_PORT=9628, 2 workers, nice 19):
`npx playwright test e2e/hel1260-orphan-owner-repair.spec.ts -g "owner open" --repeat-each 10 --workers 2 --trace on`

Result: **10 failed / 20** (light 4/10, dark 6/10), every failure at line 83 (`repairPosts.length` 0, expected 1).

Each trace's resource snapshots were parsed (`/api/*` requests with their frame and start time) against the
`goto /dashboards/<id>` action's start time:

| outcome | repair POST before goto (sent from `/`) | repair POST after goto |
|---------|-----------------------------------------|------------------------|
| FAIL x10 | 1 each | 0 each |
| pass x10 | 0 each | 1 each |

20/20 correlation. In no run was the repair POST absent. The product repaired exactly once every time, and only the
listener's attach point decided whether the test saw it.

**Correction (design-gate skeptic, round 1, re-derived in consistent ms units):** the "pass: after goto" row overstates
the explicit open. In only 2 of the 10 passes (light base and repeat1) was the POST a genuine post-navigation load, about
+840 ms after the goto. In the other 8 passes the counted POST started +0.7 to +29.8 ms after the goto action began.
That is too early for a new document to load, fetch and repair, so it was sent by the old `/` page as it unloaded
(mostly status `-1`), and it was counted only because the listener was already attached. So `/` was the repairer in
**18/20** runs. The unmodified spec almost never exercises the explicit owner open. Unit hazard: this parser prints
`_monotonicTime*1000` next to action `startTime` in ms; compare both in ms.

Failing trace (light, repeat7), `/api/` requests in start order:
- 16.070 POST dashboards (request fixture) 201
- 16.105 POST panels (request fixture) 201
- 16.136 GET dashboards (**page frame**, App.tsx mount fetch, which now includes the seeded board, auto-selected)
- 16.145 PATCH dashboards/:id/update (request fixture, the layout clear) 200
- 16.198 GET dashboards/:id/panels (**page frame**)
- 16.248 POST dashboards/:id/layout/repair (**page frame**, on `/`, before goto at monotonic 95779 > 95774)
- 16.826 GET dashboards / 16.877 GET panels (page, after goto); no repair POST (layout already repaired)

Passing trace (light, repeat1, one of the 2 genuine explicit-open passes): the page's GET dashboards (43.365) started after POST dashboards but before POST panels, so
`/` never observed the orphaned state and the repair fired only after the goto.

Mechanism: `App.tsx` dispatches `fetchDashboards()` on mount. `fetchDashboards.fulfilled` auto-selects the most recent
dashboard (`dashboardsSlice.ts`). `/` renders `PanelList`, so `PanelGrid` mounts `useStoredLayoutRepair` for it. The spec
seeds through the API while that `/` page is live, so whether the owner-open repair happens on `/` or on the explicit
route is a race between the page's mount fetches and the seeding requests.

Parser: `probe-parse-trace.py` (this directory) reads `resource-snapshot` and `before` action entries from trace.zip.
