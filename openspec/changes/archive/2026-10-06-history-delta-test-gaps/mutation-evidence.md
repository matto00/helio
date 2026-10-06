# HEL-1327 mutation evidence

Servers: `scripts/concertino/start-servers.sh <worktree> 6759 9666 HEL-1327`; listener cwds verified via
`readlink /proc/<pid>/cwd` = this worktree's `frontend/` and `backend/`. Playwright: `--workers=1`, `nice -n 19`,
`DEV_PORT=6759`. Jest: `nice -n 19 npx jest --maxWorkers=2`. Every product mutation was reverted with
`git checkout <file>`; `git status --short` afterwards shows only the spec, the new test and this change dir (no
product file changes). Servers stopped by exact PID afterwards.

## AC2 - PublicDashboardViewerPage.history.test.tsx

Command: `cd frontend && nice -n 19 npx jest --maxWorkers=2 PublicDashboardViewerPage.history`

Mutation (delete the page's `historySource` prop):

```diff
@@ -131,7 +131,6 @@ function PublicOutputPanelBody({
         // cross-filter path must never engage.
         crossFilterMode="none"
         viewerFilterActive={controlFilterOps.length > 0}
-        historySource={historySource}
       />
       {/* HEL-1190 design.md D10 (task 5.5) — this page had NO live region at all before this
           ticket; a control-driven row-count change is announced here. */}
```

RED (both cases, anonymous and signed-in owner):

```
Expected: "dash-1", "panel-1", "tok"
Number of calls: 0
> 143 |       expect(fetchPublicOutputHistoryMock).toHaveBeenCalledWith("dash-1", "panel-1", "tok"),
```

Observed under the mutation (own probe: a temporary test copy that waits 1.5 s then dumps the mocks, deleted
afterwards): `fetchPublicOutputHistory` calls `[]`, `fetchOutputHistory` calls `[["out-1"]]`, and the DOM reads
`Revenue1,204▲ 12% vs 7d`, the authenticated payload. `useOutputHistory` falls back to
`fetchOutputHistory(outputId)` when `source` is undefined, independent of the output meta. So each of the test's
later assertions would go red on its own: the exact-args public call, `fetchOutputHistory` never called, and the
DOM `2,222` / `▲ 11% vs 7d`. GREEN on real code: `Tests: 2 passed, 2 total`.

## AC3 - e2e no-reload assertion (document-request count + window sentinel)

Mutation (the sidebar "Dashboards" nav entry becomes a full document load):

```diff
@@ -36,6 +36,7 @@ export function Sidebar({ isDashboardListCollapsed, onToggleCollapse }: SidebarP
                 key={destination.to}
                 to={destination.to}
                 end={destination.end}
+                reloadDocument={destination.label === "Dashboards"}
                 className="app-sidebar__nav-link"
                 title={isDashboardListCollapsed ? destination.label : undefined}
               >
```

Command: `DEV_PORT=6759 nice -n 19 playwright test e2e/hel1275-metric-delta-sparkline.spec.ts --workers=1 --grep light`

RED (the pre-existing text assertions on "vs 1d" / no "vs 7d" PASSED first, since a fresh load reselects the
dashboard; the new assertion then fails at the count assertion, line 322 when recorded; line 323 in the current spec after the cycle-2 precondition line):

```
Error: full document loads during editor -> dashboard
- Expected  - 1  /  + Received  + 3
+ Array [ "http://localhost:6759/", ]
> 322 | expect(documentRequests, "full document loads during editor -> dashboard").toEqual([]);
```

Hops that reloaded under this mutation: only the final "Dashboards" click (`http://localhost:6759/`); the
"Data Pipelines" hop was not mutated. The sentinel assertion follows the count assertion, so it was shown red separately (cycle 2): same
`reloadDocument` mutation, an untracked since-deleted spec copy (`hel1327-probe-sentinel.spec.ts`) with the count
assertion removed, `--grep light`:

```
Error: window sentinel lost: a full document load replaced the page
Expected: "hel1327-mdfvhnd7a1i"
Received: null
> 328 | ).toBe(sentinel);   (recorded line numbers of the probe copy; the sentinel assertion is around line 329 of the current spec)
```

Created user id: 989d77be-d695-4f72-8a9d-4f9ef93bf086. GREEN on real code: both themes (see below; re-run in cycle 2 after adding the `expect(before).not.toBeNull()` precondition to `resizeAndSettle`: light + dark, 2 passed (26.6s)).

## AC4 - resizeAndSettle (change-poll, then settle)

Mutation (`PanelList.tsx`: freeze `gridContainerWidth` at the first ResizeObserver-measured width that is not
`initialWidth` 1280; also logs measured widths):

```diff
@@ -73,9 +73,14 @@ export function PanelList() {
   // (the only consumer of both) means neither branch ever re-enters the 1280px
   // initial state: this component never unmounts across that transition, so
   // the width — once ResizeObserver reports the real value — stays settled.
-  const { containerRef: gridWidthContainerRef, width: gridContainerWidth } = useContainerWidth({
+  const { containerRef: gridWidthContainerRef, width: measuredGridWidth } = useContainerWidth({
     initialWidth: panelGridConfig.initialWidth,
   });
+  const frozenGridWidth = useRef<number | null>(null);
+  console.info(`HEL1327 measured=${measuredGridWidth}`);
+  if (frozenGridWidth.current === null && measuredGridWidth !== panelGridConfig.initialWidth)
+    frozenGridWidth.current = measuredGridWidth;
+  const gridContainerWidth = frozenGridWidth.current ?? measuredGridWidth;
   // Merges the gesture-handler ref above with `useContainerWidth`'s own ref —
   // both need to observe the SAME `.panel-list__zoom-container` DOM node.
   const setZoomContainerRef = useCallback(
```

First measured widths (browser console, light run): `1280` (initial) then `1152` (the real 1440 container; no
transient 0 or skeleton width), so the freeze pinned 1152, then later real measures of `812` (1100 viewport) were
ignored. Card width stayed 333px.

Run via two untracked, since-deleted temp copies of the spec: `hel1327-probe-new.spec.ts` (the real spec plus a
console logger) and `hel1327-probe-old.spec.ts` (same, with the new change-poll removed, i.e. the OLD
`setViewportSize` + `layoutSettled` wait). Command for each: `... playwright test e2e/hel1327-probe-<v>.spec.ts --workers=1 --grep light`.

NEW wait, RED:

```
Error: card width never changed from 333px after resizing the viewport to 1100px
Expected: not 333
Timeout 15000ms exceeded while waiting on the predicate
> 84 | await expect.poll(...)   (resizeAndSettle)
```

OLD wait under the SAME mutation, GREEN (vacuous pass): `1 passed (10.1s)`.

## Final green on real code (both themes)

`DEV_PORT=6759 nice -n 19 playwright test e2e/hel1275-metric-delta-sparkline.spec.ts --workers=1`:

```
  ✓  ... (light) (10.7s)
  ✓  ... (dark) (9.2s)
  2 passed (20.4s)
```

Full logs: `<scratchpad>/hel1327-*.log` in the session scratchpad.

## Users created (shared dev DB; not deleted, no delete route, HEL-1301)

All `hel1275-<ts>-<n>@example.test` accounts, by exact id (data rows were removed by the spec's own `finally`):

- 630d97ad-939c-4e26-8dfd-f181bac8a8ef (green, light)
- a3d245cd-7018-42d1-81b2-451cac66a39a (green, dark)
- 6e085192-6a7e-4c22-8bb4-1e95faaa7dcb (AC3 red)
- 89bb4359-8654-4733-9b19-4399f9017fd0 (AC4 new-wait red)
- 826d5e26-6d41-473e-bb31-fdc424f035d4 (AC4 old-wait green)
- 9be9246d-b79f-446d-9537-339841096262 (final green, light)
- 7c556361-9058-4a16-b767-9e69de0924c0 (final green, dark)
- 989d77be-d695-4f72-8a9d-4f9ef93bf086 (cycle 2, sentinel red)
- dc5175a4-5836-4aed-afb9-da7d2ce599f4 (cycle 2, final green, light)
- d31004aa-01d4-4f3c-917d-3f2b697bd59a (cycle 2, final green, dark)

## Cycle 3 - re-recorded on the tree merged with origin/main (HEL-1326, 659eec305)

`git merge origin/main` was clean (no conflicts). Fixture unchanged: PublicDashboardViewerPage.history.test.tsx
passed as-is (the metric identity on history points already matches `METRIC_CONFIG`).

- AC2 red on the merged tree (same `historySource` removal): `Expected: "dash-1", "panel-1", "tok" / Number of
  calls: 0`, `Tests: 2 failed, 2 total`; reverted; green `2 passed`.
- E2E green on the merged tree, both themes: `2 passed (25.3s)`.
- AC3 and AC4 reds were NOT re-recorded: the merge changed no file of the e2e spec, the sidebar, the grid or
  `PanelList`, `useOutputHistory` or the history cache, so the mutation sites and the exercised navigation/reflow
  paths are unchanged.

Users created in cycle 3 (not deleted): 783712c8-1ee9-4611-8c3d-f0f8968ded21 (light),
8c0bf349-0464-4bc6-b139-a5171a21aa4a (dark).
