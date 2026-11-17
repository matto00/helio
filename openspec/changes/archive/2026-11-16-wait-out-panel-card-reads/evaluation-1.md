## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: e7b781c0ada8c0771f112905a7c08847de1a3ef3. Diff base (resolve-review-base.sh): d60b1f799.

### Phase 1: Spec Review — FAIL

Issues:

1. **One sweep hit has no verdict (AC 1, design D2).** At the base, `git grep -n "panel-grid-card" d60b1f799 -- e2e`
   returns 72 hits. I cross-checked every hit against sweep.md and 71 of them have a verdict with a line reference.
   The missing one is `e2e/hel1573-motion-grid-chart.spec.ts:398`
   (`card.querySelector(".panel-grid-card__title")?.textContent`). sweep.md gives hel1573-grid-chart a per-file count
   of 6, but it classifies only :172, :285, :305, :389 and :396. The read sits inside the :396 loop, so it is easy to
   justify: it is scoped to a `card` from :396, which the :389 `waitForPanelGrid(page, 3)` settles, and
   `__title` is a class only real cards carry. D2 still requires every hit to have its own verdict, and AC 1 requires
   every hit to be justified line by line. As it stands the record does not cover all 72 hits.

Everything else checks out:
- AC 2 / D3 is met. hel1028:310 now calls `waitForPanelStack(page, 2)` before both count-0 assertions
  (`e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:313`). mutation-hel1028.md has a pinned command
  (`DEV_PORT=7155 BACKEND_PORT=10062 nice -n 19 ... --workers=2 --trace retain-on-failure`). It shows the new spec
  failing under the mutation on the handle assertion at :314 with **`Received: 2`** (nonzero, so C2 holds), after the
  wait had passed. The old spec passed under the same mutation, which demonstrates the vacuity. The revert is recorded.
- I spot-checked these verdicts against the base code and agree with them: hel1584-surfaces:420 (`data-entrance` is set
  only by `DesktopPanelGrid.tsx:214`), :395 (count after Duplicate, with the grid already mounted), :113/:114;
  hel1457:42-45 and :118-121 (a `.react-grid-item` anchor, then `Loading panels` 0, matching the D2 rule);
  hel1023:236 (settled by `openAt`'s `waitForPanelGrid(page, 8)` at :364); hel1392-burst:63 (settled by :86);
  hel1398:167/168/174 (scoped by the `hasText` item at :159); hel1656:166 (`__title` is real-only);
  hel1575-tabs :132/:196/:896 (hasText / `__handle`, correctly not converted).
- All tasks are checked, and they match the diff.
- The diff contains no product code: `git diff d60b1f799 HEAD -- frontend backend schemas` is empty.
- `e2e/hel1685-draft-polish.spec.ts` is untouched (empty diff).
- In `e2e/hel1681-refresh-control.spec.ts` the changed lines are :332 and :343 (both now `waitForPanelGrid(page, 3)`,
  and seedWorld seeds 3 panels, `motionPrimitivesSeed.ts:58-60`) plus one import line at :7. The import is the
  minimum both conversions need, and sweep.md discloses it. I am treating it as within D4's intent, not as a violation.
- C1 and C2 are honored. My own runs below were pinned too.
- There is no scope creep. Every edit is a skeleton wait in a spec that the sweep classified FIX.

### Phase 2: Code Review — PASS

I ran the gates myself. The changed files are all `e2e/**` and `openspec/changes/**`, so neither the `frontend/**`
nor the `backend/**` gate set is triggered. I ran the gates that apply to these files:
- `npx eslint --max-warnings=0 <6 edited specs>`: exit 0.
- `npx prettier --check <6 edited specs> openspec/changes/wait-out-panel-card-reads`: all files pass.
- `npx tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- Playwright, pinned `DEV_PORT=7155 BACKEND_PORT=10062 nice -n 19 ... --workers=2 --trace retain-on-failure`, servers
  started with start-servers.sh (PASS servers) and stopped with stop-servers.sh. Neither log contains a
  `DEV_PORT is unset` warning:
  - hel1028 + hel1681: `28 passed (1.3m)`, exit 0.
  - hel1573-grid-chart + hel1573-primitives + hel1584-perf + hel1584-surfaces: `28 passed (2.5m)`, exit 0. The
    hel1584-surfaces:496 flake the executor saw did not occur in my run.

Code quality:
- D1 (reuse) holds. Every conversion uses the existing `waitForPanelGrid`/`waitForPanelStack`, and no new helper
  was added.
- `hel1584-surfaces` `openDashboard` (:60-65) picks a helper based on the viewport, which is needed for the 375 px
  caller at :448-450. It is readable and well typed.
- `hel1584-perf:184` keeps its 30 s timeout through the helper's options parameter.
- No dead code, no `any`, no TODOs.

### Phase 3: UI Review — N/A

No UI-trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The Playwright runs
in Phase 2 are the behavioral verification for this test-only change.

### Overall: FAIL

### Change Requests
1. `openspec/changes/wait-out-panel-card-reads/sweep.md`: add a verdict for `hel1573-grid-chart:398`. For example, in the
   OK-scoped list: "hel1573-grid-chart:398: `card.querySelector(".panel-grid-card__title")`, scoped to the `card` of
   the :396 loop (settled by :389's `waitForPanelGrid(page, 3)`); `__title` is real-only". After the fix the per-file
   verdicts must account for all 6 hel1573-grid-chart hits and all 72 base hits. This is a documentation fix only; no
   spec code needs to change.

### Non-blocking Suggestions
- sweep.md's header says "11 reads converted", but the FIX section lists 12 hits. The 11 counts only the conversions
  that removed the string; hel1028:310 keeps its `__handle` string. One clarifying clause would avoid confusing a
  reader.
- The PR body should name the hel1681 import line along with :332/:343 when it flags the overlap with lane HEL-1692.
- `openDashboard` in hel1584-surfaces branches on the viewport width (< 768), but the product branches on the
  container width (`PanelGrid.tsx:73`). This is fine for the widths the spec uses (1440/375). A comment saying so
  would stop a future caller at roughly 780 px from guessing wrong.
