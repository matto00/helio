## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 3dea0b855c7140c86efd94d0d09d838d2d72c0fa (fix for evaluation-1 CR1-CR4; design.md D2a).

### Phase 1: Spec Review — PASS
- CR1 addressed: `useCrossFilterServerOps` now returns client-fallback deterministically when a control op shares the cross-filter eq's (column, op); D2a documents it; spec scenario updated; different-op control on the same column still composes server-side.
- CR3 (evidence.md real-request record) and files-modified updated. CR4 (PR-body split note for PanelCard.tsx, now larger again) remains a PR-description item, non-blocking.
- Diff since cycle 1 touches only `useCrossFilterServerOps.ts`, `PanelCard.tsx`, the test file and openspec docs; no backend/public-route change. C1-C4 still honored.

### Phase 2: Code Review — PASS
Fresh gates on 3dea0b85: lint 0, format:check clean, typecheck clean, root jest 271/271, frontend jest 375 suites / 4000 tests all pass, build ok, openspec hygiene clean. No flakes.
Red-first for the new backend-mirroring tests: scratch detached worktree of the cycle-1 commit 2ff73ca8 + the new `PanelCard.crossFilterServer.test.tsx`: 2 failed / 15 passed — "same-(column,op) control + cross-filter (D2a) > takes the client fallback with no 400, no cache invalidation, and an announcement matching the display" and "> the same control value as the cross-filter also falls back". Both green on 3dea0b85. Scratch worktree removed.

### Phase 3: UI Review — PASS
Servers restarted via start-servers.sh; `readlink /proc/241210/cwd` (6623) and `/proc/240959/cwd` (9530) both point into this HEL-1191 worktree.
Live, real backend, dataset "SkepticOrders" (250 rows):
- Light, desktop: cross-filter `region = east` + control `region = west`: only the control-scoped request is sent (200, no 400, no console errors); panel shows "No data to preview." with live region "0 results." (count matches display). Control `east`: 51 rows, "51 results.", all requests 200. eval2-01-light-samecol-west.png.
- Mobile remount (390x844, light) with control east + cross east: 51 rows, 0 non-east, "51 results.", no 400s. eval2-02-mobile-light-samecol-east.png.
- Dark, desktop: control `region = west` + cross east: single 200 request `ops=[region eq west, created_at eq ...]`, "No data to preview." + "0 results.", 0 console errors. eval2-04-dark-samecol-west.png.
- Different-column control still uses the server path: added a `created_at` dropdown control (dev data, removed afterwards); with cross `region = east` + Date `2026-02-13T00:00:00Z` the request carries BOTH ops (`created_at eq`, `region eq`), 200, 2 rows, live region "Filtered by region = east: 2 results.". eval2-03-dark-diffcol-server.png.
- The cycle-1 400 (`duplicate filter op 'eq' for column 'region'`) no longer occurs anywhere; capabilities are not invalidated. Cycle-1 verifications (set/clear announcements, fallback disclosure, mobile remount) are unaffected by this narrow diff and were not regressed by anything observed.
Screenshots under the change dir `evidence/` (gitignored); durable copies under `/home/matt/Development/helio/.concertino/runs/HEL-1191/evidence/openspec/changes/cross-filter-server-side-eq/evidence/eval2-0{1,2,3,4}-*.png`.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- PR body must carry the PanelCard.tsx split proposal (CONTRIBUTING, file well over budget).
- Empty intersection shows the generic "No data to preview." (disclosed deviation) - consider a column-preserving empty table later.
