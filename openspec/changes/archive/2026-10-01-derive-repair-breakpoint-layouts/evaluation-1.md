## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: c3035ce961cf3697eaf7be412d243f5605a7145f

### Phase 1: Spec Review — PASS
Issues: none blocking. Verified against the code:
- Owner ruling honoured: derive from nearest authored breakpoint (ties wider), compact, repair overlap/out-of-bounds at render; persisted only on edit at that breakpoint (DesktopPanelGrid.handleLayoutChange returns the store `layout` unchanged when the RGL layout equals the resolved one; useLayoutSave now baselines on the authored layout). Valid authored layout returned as saved (resolveFor early return; value-identity unit test + e2e V state).
- Always-on compaction rejected: resolver only compacts when overlapping/derived; test fails under always-compact mutant (evidence-mutations.txt).
- Overlap detection is a small pure function (rectsOverlap/findOverlaps/isLayoutValid) mirrorable for HEL-1071.
- Executor deviation claims checked: fixpoint compactLayout is real and bounded; derived breakpoints start at y=0 (source top offset dropped) - consistent with "compacted", not contradicted by spec; createPanel covered at resolver level only - acceptable.
- Boundary fix (0.001 shift) matches spec "Grid breakpoint selection agrees with the stack boundary".
- Spec scenarios (breakpoint-layout-resolution and mobile-viewer-stack delta) match the implementation.

### Phase 2: Code Review — FAIL
Gates run fresh in WORKTREE_PATH (nice -n 19, 3 workers): `npm run lint` clean; `npm run format:check` clean; `npm test` 4211/4211 pass (403 suites); `npm --prefix frontend run build` ok. Worktree clean after all runs (git status empty; src swap for the red check restored exactly).

Issues:
- The new e2e spec is not robust under the default backend configuration (see Phase 3 / CR1). A deliverable regression spec that goes red on the unmodified-by-me, default dev backend is a mechanical failure.
- Dead code: `deriveLayout` (breakpointLayout.ts) has no production caller (resolver calls scaleLayoutItem + compactLayout directly); only tests use it. `isLayoutValid` is production-unused but is the stated HEL-1071 contract, so acceptable; `firstFreeY` is exported but only used internally.
- Leftover comment artifact: useLayoutSave.ts:65 reads "Reset when the layout syncs back to persisted ." (dangling space before period after a removed identifier).

### Phase 3: UI Review — FAIL
Servers: started via start-servers.sh; backend/frontend cwd confirmed as the worktree (`readlink /proc/<pid>/cwd`).

- HEL-1028 e2e (e2e/hel1028-layout-undo-redo-visual-revert.spec.ts): 13/13 PASS on default backend.
- e2e/hel1023-breakpoint-layout-derivation.spec.ts on the DEFAULT backend (no env overrides): 5/5 FAIL, reproducibly (full run twice; A_lg_only alone once). Root cause measured from the trace: the spec makes ~130 `/api` requests for one user in ~15s (60 of them `/api/outputs/<id>` from the chart panel, ~6 per page load, 18 `/api/auth/me`, 10 page loads per state); the backend's per-user rate limit (RATE_LIMIT_REQUESTS_PER_WINDOW default 120/60s) returns 429, `/api/auth/me` 429 logs the page out, the page shows the login form, and `settledRects` times out at "expected 8 grid items, received 0". The afterEach DELETE also 429s, leaking the dashboard (11 leaked dashboards, all removed by exact id below).
- With the backend restarted with RATE_LIMIT_REQUESTS_PER_WINDOW=100000: hel1023 spec 5/5 PASS (1.1m). So the geometry/logic is right; the spec's request volume is the defect.
- Red on main logic: with `git checkout 543bd04a -- frontend/src` (restored with `git checkout HEAD -- frontend/src`, git status verified empty) and the high rate limit: 5/5 FAIL (red); restored tree green. So the spec discriminates.
- No layout PATCH on view / no dirty indicator: the spec asserts this and passed with the raised limit; live look also showed Undo/Redo disabled and no pending indicator.
- Live look, 1500px window (md), dashboard authored lg-only with image/markdown/text/divider: light AND dark both render non-overlapping, in-container, reading order preserved (A,B / C,D / E,F), no console errors. (Image panel shows "failed to load" only because my test image URL was invalid; not a defect.)

### Overall: FAIL

### Change Requests
1. e2e/hel1023-breakpoint-layout-derivation.spec.ts: make it pass on the default backend (RATE_LIMIT_REQUESTS_PER_WINDOW=120) without relying on timing. Reduce per-user request volume: for each state seed once, then switch widths with `page.setViewportSize` (RGL/PanelGrid re-layouts on resize) instead of a full `page.goto` per width/theme where the assertion allows, and/or drop the chart output panel's repeated fetches (or use a state-per-user split so each user stays well under 120 requests per 60s, with a safe margin, e.g. under ~80). Also make the afterEach DELETE tolerant/robust (do not leak dashboards on a 429; retry after a short wait). Re-verify against a backend started with NO rate-limit override, and record the pass in the evidence file.
2. useLayoutSave.ts:65: fix the comment ("...syncs back to persisted ." -> "...syncs back to the persisted layout.").
3. breakpointLayout.ts: remove `deriveLayout` (no production caller) or have the resolver use it; un-export `firstFreeY` if only used internally.

### Non-blocking Suggestions
- Derived layouts drop the source's top offset (start at y=0); fine under "compacted", worth a line in design.md if not already stated.
- A createPanel-level integration test (thunk + resolver) would close the executor's noted gap.

### Residue / cleanup (this evaluation)
- Deleted by exact id (psql `delete from dashboards where id in (...)`, panels cascade): af8cb154-3313-4883-9558-70fef46b4854, 42b4f383-ba57-4798-9ecc-d757de8fb786, aacce7c6-e1e8-458d-a164-72872931b6d7, 029685c4-6780-45c3-bb53-7df4f01dfbc8, a1fd0ddf-80c9-414b-a178-703f872836da, 740835c4-e5fa-4a22-a61b-f10798511e3b, ac053507-62a5-4da8-b13a-e5281427f39b, 3a6614b5-3c07-485a-af57-914bf1f2f1f6, f4dc4136-77b3-41ac-b839-ce1e7ebc8e85, c66255da-19f8-48fb-919a-03c6d110479e, 282d36e1-0196-4701-bbd8-283a92fb091f; plus live-look dashboard fda8244a-5645-45fe-9601-e36841fdcf1d (via API DELETE, 204).
- Remaining residue: throwaway `hel1023-*@example.test` and `hel1028-*@example.test` users (22 hel1023-* rows in users at last count, including the executor's earlier runs) and their pipelines/data-sources/outputs; no user-delete API, left in place. The live-look dashboard was created under whichever user the shared Playwright browser session was already logged in as (page title showed another ticket's session), so my "register" fetch did not create a user there.
- Servers I started (sbt backend, vite) are stopped; ports 9362/6455 free.
