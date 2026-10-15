## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 563a4c476c7f7340cf494deec06dbe6932edff7d (planning artifacts untracked; no code diff yet).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/settle-nonchart-findby-waits/HEL-1612`.
- **Scope matches the ticket's "Left" table.** I checked this against
  `openspec/changes/archive/2026-10-15-settle-lazy-chart-mounts/measurements.md:186-195` (the "Left, with reasons" table) and the
  `arm`-after paragraph at lines 106-111. The design covers every non-lazy-chart site that table names (chartTruncation, PublicDashboardViewerPage.truncation,
  crossFilter, PanelFullscreenOverlay.test, PanelContent.test), and it re-probes the two `.truncation` files that the table says were green.
  Every AC1 item maps to tasks 1.4/1.5.
- **Line citations are accurate on HEAD.** I ran `grep -n "findBy\|findAllBy\|waitFor("` over all 7 files:
  - chartTruncation: 94, 100, 135, 155, 157, 175, 184. These are HEL-1599's 93/99/131/151/153/170/179, shifted by its cycle-2 edits, and the count is the same.
  - PublicDashboardViewerPage.truncation: 89.
  - crossFilter: 177, 187, 199, 241, 249, 292, 293, 302, 392, 416.
  - FullscreenOverlay.test: 118, 161, 285, 292.
  - PanelContent.test: 106, 126, 152, 353, 426.
  - FullscreenOverlay.truncation: 77. PanelDetailModal.truncation: 78.

  All match design.md's Context.
- **Gating claims are correct.**
  - PanelContent.test mocks `getOutputById` and `fetchDatasetSchema` (lines 30-39). Its `fetchOutputHistory` default is a rejecting stub (lines 14-17), and the design's Risk section names that explicitly with an `allSettled`-style mitigation.
  - PublicDashboardViewerPage.truncation mocks `fetchPublicDashboardPanels`/`fetchPublicOutputMeta`/`fetchPublicPanelRows` as `fetchPanels`/`fetchMeta`/`fetchRows` (lines 25-41). This matches D2's two-stage chain.
  - crossFilter mocks `usePanelData` (synchronous rows) and `getOutputById`, so the table/metric waits are gated on output meta.
  - `MarkdownRenderer.tsx:11` really is a `React.lazy` of `MarkdownPanel`, so D1's "pass the lazy module promise" route is needed and is correctly identified.
- **The helper design is consistent with the existing module.** `frontend/src/test/settleChartMount.ts` already has the `Source` type and the mock-results collector. A sibling `settleMocks` that leaves `settleChartMount`'s behaviour unchanged is a small, coherent extension. Task 2.5 re-runs HEL-1599's 15 files to guard it.
- **The proof method is sound and falsifiable.**
  - D4 puts the stall in the mock's resolution microtask, on every resolution. This is the HEL-1596 method, and HEL-1599 used it with fired counts.
  - It applies an identical edit before and after, and a run where the stall did not fire is invalid.
  - The `arm` fallback covers files that are not red at the mock-resolution point.
  - D5 adds a mutation guard, so the synchronous query must still assert the real target, plus 10 clean cold-cache runs.
  - D6 records the literal commands, environment and inventory. Together these satisfy AC2.
- **AC3, AC4 and AC5 have explicit coverage.** AC3 is constraint C1 plus the Non-goals. AC4 is C4. AC5 is task 2.7, the full jest suite with `CI=true nice -n 19 --maxWorkers=3`.
- **No placeholders.** No TODO/TBD remains. The two "executor decides per site" points (how to settle a rejecting stub, and whether a D3 wait needs settling) are bounded by recorded criteria rather than left open.
- **No contract or spec delta is needed.** The change is test-only (`skip_specs: true`) with no API or schema impact.

### Verdict: CONFIRM

### Non-blocking notes

1. **Inventory every `waitFor`, not only `findBy*`.** `PanelContent.chartTruncation.test.tsx:176` has `await waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(2))`, which is also subject to the 1 s deadline. Task 1.1 inventories `waitFor`, but D6's inventory table says "every `findBy*`". HEL-1599 cycle 2 found exactly this gap: its `arm` stall never fires on a bare `waitFor`. Give each `waitFor` in the touched files a row with a disposition: converted, or left with its reason.
2. **D3 must not leave an AC1 site unflagged.** D3 allows leaving a post-interaction wait (crossFilter 392/416 `within(...).findByText`). Those are `findByText` waits on the AC1-listed crossFilter line. If any of them ends up "left", call it out as an explicit AC1 deviation, with the probe result, in measurements.md and the final report. A mention only in the inventory table is not enough.
3. **D1's markdown example path is wrong for the caller.** `import("../MarkdownPanel")` is relative to `renderers/`. From `panels/ui/PanelContent.test.tsx` the path is `./MarkdownPanel`. Typecheck would catch it, so this is cosmetic.
4. **D4 does not state N for the `-t` runs.** It says "N=5, whole file, plus `-t` for one listed test per file" but leaves N for `-t` ambiguous. HEL-1599 used N=3. Record whichever N is used.
5. **Probe extra sites before converting them.** Task 1.5 names the form/schema site (426), and design.md lists 353, both beyond the ticket's literal "metric/markdown/table" list. The design's Risk section already says to convert only probe-red sites. Keep that order: probe first, then convert.
