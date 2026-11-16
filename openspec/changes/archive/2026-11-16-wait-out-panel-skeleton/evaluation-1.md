## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 93bc696bf67d2da2fba4b9961a2d0a4aa2d7b54f (base fd7064f7d700e49a2f7dfc1f6a244aab02048fd2, resolved live).
Evaluator evidence (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1633/evidence/.concertino/scratch/HEL-1633/`
`eval-mutA.txt`, `eval-mutB.txt`, `eval-mutA-nopre.txt`, `eval-fixed-specs.txt`, `eval-hel1572-density.txt`.

### Phase 1: Spec Review — FAIL

- AC1 (hel1572 `--repeat-each 30` under load, zero failures): met. The executor's `ac1.txt` shows `450 passed (17.5m)`
  (15 tests x 30), 0 failed/flaky lines, at 2 workers; load average 4.81 before and 11.40 after. That run finished at
  11:01, before the 11:03 commit. My own run at HEAD covered the density tests 10 times at 2 workers under `nice -n 19`
  (load avg about 4.8): 20 passed, 0 failed.
- AC2 (the sweep is recorded and every hit is fixed or justified): **not met for two hits.** See Change Requests 1-2.
  The other 70+ verdicts I spot-checked hold up. Each cites a line, `.panel-grid` is correctly treated as skeleton-shared
  (`DesktopPanelGridSkeleton.tsx:58`), and no hit is OK-filtered on a skeleton-shared class.
  - hel1584-motion-surfaces :110 and :612: both read after an "Edit layout" click (that button mounts only after loading),
    then 600 ms more, and both locators are `hasText: "Metric"` filtered. :399 and :420 come after a duplicate (not a
    load), and :420 also filters on `data-entrance="pop"`, which only real cards carry. Sound.
  - hel1584-motion-perf :217: read after "Edit layout" plus 800 ms, which is longer than the 280 ms fade. Sound.
  - hel1573-motion-grid-chart :288: `items.filter({ hasText: "M-drag Metric" })`. Sound. **:37 is not sound** (CR 2).
  - hel1023 :231/:245: **not sound** (CR 1).
- Tasks 1.1-1.9 are all checked, and they match the diff.
- No scope creep. HEL-1644 (`hel1575-dashboard-tabs.spec.ts`) and `hel1681-refresh-control.spec.ts` are absent from
  `git diff --name-only`, so they were not touched.
- No product code, schema or spec delta changed (`skip_specs: true` is appropriate).
- Constraints: all three are honored, with one note on C2.
  - C1 holds: the guard's post-helper reads are `count()`, `count()` and one `evaluateAll`, followed by plain `expect`.
  - C3 holds: only `:root .crossfade .crossfade__skeleton` is stretched to 3000 ms with `!important`, and the guard
    asserts `transition-duration` is `3s` while the skeleton is up.
  - C2 holds: I reproduced it myself.

**Guard soundness (the executor's own mutant-A caveat, checked independently).** I built both mutants in a throwaway
detached worktree, outside the delivery worktree, and ran each with `--repeat-each 5` at 2 workers:
- Mutant A (step 2 only), as committed: red 5/5. The failure is `skeletons` = 1 at :104 (the read is held until the
  stubs attach, by the parallel pre-assert).
- Mutant A with the parallel pre-assert removed (`await ready` only): red 5/5. The failure is `items` = 0 at :103,
  meaning the helper returned before anything mounted. That is exactly D4's stated mechanism.
- Mutant B (step 1 only): red 5/5. The failure is `items` = 6 at :103 (stubs still fading).
- Real helper: green 5/5.

So mutant A is caught deterministically with or without the pre-assert. The pre-assert changes only which one-shot
assertion fires first, and both firings rest on a window of at least 4.5 s (a 1.5 s delayed panels response plus the
3 s stretched fade). The pre-assert is also sound for the real helper. `Promise.all` makes the reads wait for both
branches. The pre-assert only proves the scenario: stubs attached and the fade stretched. It cannot shorten the
helper's own wait. If the skeleton never showed, the guard would go red rather than pass vacuously. The executor's
description of why mutant A is red was accurate, and the guard still satisfies D4/C2.

### Phase 2: Code Review — PASS

I ran these myself at HEAD. The changed files are `e2e/**` and `openspec/**`, so no frontend/** or backend/** gate
triggers. I ran task 1.9's checks:
- ESLint (`--max-warnings=0`) on all 11 changed e2e files: clean.
- Prettier `--check` on the changed e2e files and the change dir: clean.
- `npm run check:e2e-types`: clean.
- `check:e2e-user-cleanup` and `check:e2e-evidence-paths`: clean (140 files).
- Every FIX'd spec, run once (hel1575-reload-after-edit, hel1260, hel1457, hel1230, hel1575-delayed-restore, hel1065,
  hel1085, hel1392-remount-request-burst): 22 passed.
- Guard spec at `--repeat-each 5`: 5 passed.

The helper (`e2e/support/panelGridReady.ts`) is small and typed. Its doc comment states the order rule and that it is
desktop-only. It reuses the HEL-1584 selector through `LIVE_GRID_ITEMS` rather than copying it. Its timeouts are
explicit. There is no dead code, no `any` and no over-engineering.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). This is a test-only
change.

### Overall: FAIL

### Change Requests

1. **hel1023 :231/:245: the sweep verdict "OK-settled" is not a D2 justification, and the reason given for not
   converting is factually wrong.**
   - `sweep.md` itself says "Not proven stub-proof: follow-up candidate". D2 has no follow-up verdict for
     `.react-grid-item` hits, and the proposal defers only `.panel-grid-card` hits.
   - The reason given, "the helper cannot be applied (phone widths)", is wrong. `openAt`
     (`e2e/hel1023-breakpoint-layout-derivation.spec.ts:354-362`) does its only `goto` on the first window of each
     theme. That window is `windows[0]` = 1900 px (`:44-45`), and the second test's `windows.filter(bp !== "stack")`
     also starts at 1900. Later windows are `setViewportSize` resizes, not loads.
   - Nothing in that path excludes the skeleton:
     - `settledRects` first counts `.react-grid-item, .mobile-panel-stack__item` toward 8, and 8 stubs can satisfy that
       for a fully saved layout.
     - `readRects` takes `document.querySelector(".panel-grid")`. The skeleton layer is first in DOM order
       (`Crossfade.tsx:97-104`) and its grid root is also `.panel-grid`, so this can return the skeleton grid.
     - `waitForGridWidth` and the 150 ms stability loop are both satisfied by a static skeleton.
   - The non-stack branch then checks only bounds and overlaps, which stub rects drawn from the saved layout can pass.
     This is the same race the ticket targets, and it can pass vacuously.
   - Fix: in `openAt`, right after `page.goto(...)` at `:360`, call `await waitForPanelGrid(page, 8)`. The load always
     happens at 1900 px, so the helper's desktop-only rule holds. Use a timeout of at least the 20 s that `settledRects`
     already allows. Then change both hel1023 verdicts in `sweep.md` to FIX. If 8 is wrong for a seeded state, use that
     state's real count.
   - If conversion is impossible, give a written justification with a line reference that shows the skeleton cannot
     satisfy the read. "Follow-up candidate" is not one.

2. **hel1573-motion-grid-chart :37: the verdict "OK-settled by timed wait" is not a D2 justification.**
   - The test at `:30-32` is `goto("/dashboards")`, then a `.panel-grid-card` count of 3 (three stubs satisfy that),
     then `waitForTimeout(800)`.
   - `:36-37` then reads `document.querySelector(".panel-grid")` and its first `:scope > .react-grid-item`. Under load
     that is the skeleton grid whenever loading takes longer than about 800 ms.
   - The viewport is 1900 px (`:14`), so the helper applies directly.
   - Fix (either one):
     - (a) Replace `:31-32` with `await waitForPanelGrid(page, 3);` and mark the hit FIX.
     - (b) Re-justify it as a CSS-rule probe. You would need to show that a stub item under the skeleton's own
       `.panel-grid` root resolves the same computed transition values. That has to be shown, not assumed.
   - Option (a) is cheaper and removes the doubt.

### Non-blocking Suggestions

- `sweep.md`: hel1584-motion-surfaces :110/:612 and hel1573 :288 could be labelled OK-filtered (`hasText`), which is the
  stronger and more accurate reason, instead of "OK-settled by timed waits".
- `e2e/hel1575-reload-after-edit.spec.ts:49`: the `toHaveCount(1)` after `waitForPanelGrid` is redundant but harmless.
- Housekeeping: my mutant runs in the throwaway worktree had no DB config, so its global teardown could not delete
  their 15 throwaway users. I deleted them by exact recorded id with the delivery worktree's own harness
  (`userCleanupCore.buildUserDeleteSql`), removed the throwaway worktree, and confirmed `git worktree list` has no
  straggler. No residue remains.
