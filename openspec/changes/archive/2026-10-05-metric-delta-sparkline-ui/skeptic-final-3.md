## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `d3f1fa78c9962619a5b802b6688bcf34bbce094b`. Review base resolved live by `resolve-review-base.sh` (exit 0): `9c247cf6a22858ae0bb5285887995b31de874860`. The branch diff touches only `frontend/src/**`, `e2e/**` and the change dir. It does not touch `ci.yml`, `playwright.config.ts`, migrations or the backend (C1).

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/metric-delta-sparkline-ui/HEL-1275`.

**Gates, run fresh by me in the worktree under `nice -n 19`:**
- `npm run lint` exit 0
- `npm run typecheck` exit 0
- `npm run format:check` exit 0 ("All matched files use Prettier code style!")
- Full frontend jest (`--maxWorkers=3`): `Test Suites: 434 passed, 434 total` / `Tests: 4524 passed, 4524 total`
- The HEL-1275 suites alone: 10 suites / 91 tests passed.
- `DEV_PORT=6707 BACKEND_PORT=9614 nice -n 19 npx playwright test e2e/hel1275-metric-delta-sparkline.spec.ts --workers=2` → `2 passed (13.7s)` (light and dark).
  - Backdated row ids: c466edb1-2ee3-4989-9c37-85591e5676ff and 3b03f2dc-f063-4c18-94a5-5b6aaa8f7d51.
  - The spec cleaned up its own records.
- No FirstRunRoutesSpec timeout and no "Java heap space": no sbt run was needed, because there are no backend changes. HEL-1294 and HEL-1298 were not seen.
- Servers: pid 7896 (cwd `.../HEL-1275/frontend`) on 6707 and pid 7435 (cwd `.../HEL-1275/backend`) on 9614, both checked through `/proc/<pid>/cwd`. Both were reused, not killed. `assert-phase.sh servers` printed `PASS servers`.

**Acceptance criteria, traced:**
- **RTL tests for ▲/▼/flat, available-from and filter-hidden.** Covered by `MetricRenderer.test.tsx` and `PanelContent.metricHistory.test.tsx`. All pass. Mutating the filter guard out of `selectMetricHistoryView` (`if (filterActive && <never>)`) turns 5 tests red (in `metricHistoryView.test`, `PanelContent.metricHistory`, and the publisher-side provenance test), so that guard is red-first.
- **Playwright exit-criterion proof.** The e2e spec passes in both themes. Compare is chosen through the editor UI (C5), and seeding happens after `about:blank` (C2).
- **Light and dark visual check against the running app.** Done by me (see below).
- **HEL-918 exit criterion, live.** I seeded my own user, a source, a pipeline and an editor-shaped `{fieldMapping:{}, aggregation:{value:"amount",agg:"sum"}, format:"integer"}` Output with no compare (C6), plus real runs and one row backdated by exact id. I then chose "7 days" in the editor. The saved config is `{"aggregation":{"agg":"sum","value":"amount"},"compare":"7d","fieldMapping":{},"format":"integer"}`, so the aggregation survives the save.
  - The default 3x2 card reads "1,204 / ▲ 12% vs 7d" with the inline sparkline. Ref: `/home/matt/Development/helio/.concertino/runs/HEL-1275/evidence/openspec/changes/metric-delta-sparkline-ui/screenshots/skeptic-final-3-default-card-light.png` and `.../skeptic-final-3-dashboard-light.png`.
- **Filtered state, with a real dropdown control (region = west).**
  - The headline becomes 604, and "Comparison hidden" appears with `title` and `aria-describedby` both reading "comparison reflects unfiltered data" and `tabIndex` 0.
  - The provenance popover on that panel has no "Compared with" row. The unfiltered card's popover shows "Compared with 7 days ago · 1,075".
  - Refs: `.../skeptic-final-3-filtered-light.png`, `.../skeptic-final-3-provenance-light.png`, `.../skeptic-final-3-filtered-provenance-dark.png`.
- **Editor → navigate back, with no reload.** Every hop was an in-app link click (Data Pipelines → pipeline → Outputs → editor → Save → Dashboards). I set `window.__skepticMarker` before leaving the dashboard; it was still `"alive"` and `performance.getEntriesByType('navigation').length === 1` after each return.
  - **Light, 7d → 30 days:** both cards show "1,204 / 30d comparison available from 10/28/2026".
  - **Dark, 30d → 1 day:** both cards show "1,204 / ▲ 12% vs 1d" (`.../skeptic-final-3-compare-switch-dark.png`).
  - **History requests:** exactly #603 (initial, shared by both panels), #652 (after 30d) and #700 (after 1d). Nothing more after an 8 s wait. The refetch is bounded in the running app.
- **Public path.** I logged out and opened `/dashboards/:d/panels?token=`.
  - The only history requests were `GET /api/dashboards/:d/panels/:p/history?token=…`, one per panel. There were no `/api/outputs` calls.
  - The payload's top-level keys are `availableFrom, baseline, compare, current, delta, pct, points, sparkline`, and the point keys are `capturedAt, rowCount, summary`. A grep for `outputId|runId|triggerSource|ownerId|userId|pipelineId` returned no hits, and the page's innerText has 0 UUIDs.
  - The panels show "▲ 12% vs 1d" with a sparkline. A public dropdown filter gives 604 / "Comparison hidden", and the public provenance shows "Compared with 7 days ago · 1,075".
  - Refs: `.../skeptic-final-3-public-dark.png`, `.../skeptic-final-3-public-filtered-provenance-dark.png`.
- **"previous run" copy (C4).** `git diff base...HEAD -- frontend/src ':!*.test.*' | grep '^+' | grep -i "previous run"` has exactly one hit: a code comment explaining why the label is "previous". There is no UI copy with that phrase, and the live card text contains none.
- **Visual cohesion (DESIGN.md).**
  - The delta reuses the existing `.panel-content__metric-trend--up/down/flat` modifiers.
  - The note matches the trend's mono/micro/muted recipe, including the sibling's `letter-spacing: 0.02em`.
  - The sparkline stroke uses `--app-accent`, and spacing uses `--space-*` tokens. In the compact 3x2 card the sparkline sits inline beside the delta without crowding the footer.
  - The Compare `Select` is the same shared component and section layout as Format (`.../skeptic-final-3-editor-light.png`, `.../skeptic-final-3-editor-dark.png`).
  - The "Compared with" row reuses `provenance-popover__heading`/`__value`/`__time`, the same as "Last run".
  - Light and dark are at parity. I would not reject any of this on looks.

**Red-first proof of the claimed guards.** I mutated a scratch copy of `frontend/`, never the worktree.
1. **Compare-mismatch guard** (`metricHistoryView.ts:113`, condition made unsatisfiable). 3 tests go red:
   - `selectMetricHistoryView › hides delta and sparkline when the config's compare differs…`
   - `PanelContent › a compare saved after the history was cached hides the stale delta and refetches once`
   - `PanelContent › compare None (null) against a cached 7d history…`

   **The guard is red-first.**
2. **The refetch itself** (the `invalidateHistory`/`loadHistory` pair in the mismatch effect removed). 3 tests go red. **Red-first.**
3. **The refetch bound** (`useOutputHistory.ts:62`, `if (done && done.key === key && done.compare === expectedCompare) return;` replaced by a no-op). **All 44 history and PanelContent tests stay green. The bound has no failing test.**
   - **Root cause.** `beforeEach` sets `fetchHistory.mockReset().mockResolvedValue(makeHistory())` (`PanelContent.metricHistory.test.tsx:56`), so every fetch resolves to the *same object reference*. `useSyncExternalStore` sees an identical snapshot, nothing re-renders, and the mismatch effect never runs again. The test's "still 2 calls after 50 ms" check (lines 176-178) therefore passes with or without the bound.
   - **Confirming the bound is load-bearing.** I changed only that test to `fetchHistory.mockImplementation(() => Promise.resolve(makeHistory()))`, which returns a fresh object per call the way axios does:
     - with the bound, it passed (`1 passed`);
     - without the bound, the jest process never finished and was killed by `timeout 120` (exit 143).

     A server that keeps answering the old compare would make the panel loop on `/history` with no bound. The bound works today (live: bounded), but the test offered as its proof can never fail.

### Verdict: REFUTE

All the behaviour is correct, and I confirmed it live in both themes. That covers the exit criterion at default size, the filtered state with a real control, the editor → back compare switch with no reload, and the public path (public route only, no ids). The one failure is the proof itself. The orchestrator asked for red-first proof of the refetch bound, and the only test claiming to prove it is vacuous. It passes with the bound deleted, while deleting the bound in real conditions produces an unbounded request loop. This is the "evidence-shaped non-evidence" pattern, and it is a small fix.

### Change Requests
1. **Make the refetch-bound test able to fail** (`frontend/src/features/panels/ui/PanelContent.metricHistory.test.tsx`, test "a compare saved after the history was cached hides the stale delta and refetches once", ~lines 167-179).
   - Have `fetchHistory` return a **fresh object per call** within a finite budget, so a missing bound shows up as a count rather than a hung worker. For example: `let n = 0; fetchHistory.mockImplementation(() => ++n <= 5 ? Promise.resolve(makeHistory()) : new Promise(() => {}));`
   - Keep `expect(fetchHistory).toHaveBeenCalledTimes(2)` after the wait.
   - Then show both runs in the change dir: red with `useOutputHistory.ts:62` removed (the count rises above 2), and green with it restored.
   - No production code change is required.

### Non-blocking notes
- The e2e editor → back step (`e2e/hel1275-metric-delta-sparkline.spec.ts` ~244-262) does not assert "no reload", so a future full-page navigation would pass it for the wrong reason. A cheap fix is to set a `window` marker before leaving and assert it survives, or to assert `performance.getEntriesByType("navigation").length === 1`. I checked this property by hand in this round.
- `PanelCard`'s `viewerFilterActive={controlFilterOps.length > 0}` wiring has no unit test. Mutating it to `false` keeps jest green, but the e2e filtered block (asserting "604" plus the marker) covers it.
- I agree with the evaluator that several panels on one Output can each issue one bounded extra refetch. A per-key marker in the module cache would make it exactly one.
- The console errors were only `GET /api/pipelines/:id/schedule` 404s on the pipeline page. That page is not touched by this branch.

**Cleanup.** Records I created were deleted by exact id, each returning 204:
- dashboard ac16ea35-81a1-4ace-8914-6a2c134367ae
- pipeline f6650380-9c07-4981-991e-e92993f76ccf
- source 52cb2ef7-4be6-4919-a1e2-27098f9273f6

The backdated history row was f026f5af-1b73-4eff-a581-b199cc83615c, for output 6e7fbf16-6785-4e66-8cee-d2e5237d1fda. My test user (dc69cb79-d744-4f74-abfa-325457db235f) remains, like every e2e-registered user.

**Gate-defect check.** No evidence here depends on mtime ordering. Every claim rests on command output, network request ids, DOM text or mutation results.
