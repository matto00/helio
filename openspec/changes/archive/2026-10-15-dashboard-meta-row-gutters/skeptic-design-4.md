## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD 82c96e7905511fb86a732f7eb32b428473fd9ebf. The revised artifacts (design.md, proposal.md, tasks.md, specs) are uncommitted working-tree edits, so I read them from the working tree. The question for this round is whether the plan revised for the owner's answers is sound to execute in full.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/dashboard-meta-row-gutters/HEL-1576`.
- **Owner answers are real.** `.concertino/runs/HEL-1576/events.jsonl` line 27 is an `escalation.answered` event for `HEL-1576-1792053980784-c95b08`. It has `answer_source: "human"` and `sub_answers` `["meta-row-replaces-command-bar","drag-only-in-edit","tidy-layout"]`, which matches D0. I relied on nothing from the relayed gutter ruling: D7 is self-sufficient.
- **The predicate composes correctly.** `isDashboardViewPath` is at `shared/chrome/sections.ts:158` (`/home` or `/dashboards/*`). `usesDashboardMetaRow = !isPhoneShell && isDashboardViewPath(pathname)` adds no route literal, so HEL-1578's change flows through it. HEL-1575 (`App.tsx` in its worktree) computes `showTabBar = showRail && onDashboardView`, where `showRail = !isPhoneShell`. That is the same condition (see note 1).
- **Undo/redo shortcuts survive the swap.** `useLayoutUndoRedo` (`features/layout/hooks/useLayoutUndoRedo.ts`) is a pure `useShortcut` consumer and owns no state. If it is called in whichever of CommandBar or DashboardMetaRow is mounted, exactly one binding exists. `GlobalCommandShortcuts` and the quick-launcher shortcut live in `App.tsx`, not in CommandBar, so removing CommandBar on that view drops no other binding. `ShareDialogProvider` (`App.tsx:203`) and the save-state context wrap the bar slot, so the meta row can use both.
- **Reusing the `.app-command-bar` grid slot works structurally.**
  - `App.css:66` gives the slot `grid-column: 3; grid-row: 1`, the top-chrome height, safe-area padding, the surface, the hairline border and z-index.
  - HEL-1575's `App.css:285` has `.app-shell--tabs .app-command-bar { grid-row: 2 }`, so the meta row would land under the tab strip with no grid edit.
  - e2e `state-surface-contrast-guard.spec.ts:950` only asserts `.app-command-bar` is visible, and it stays green.
  - Side effect: every descendant rule scoped to `.app-command-bar` now applies to the meta row as well. That includes `App.css:203-210` (borderless triggers) and `:549-566` (theme hover fixes). See CR3.
- **Edit-mode state in the layout-history slice is fine.**
  - `store.ts:43` registers the slice with no persistence.
  - An id-equality design makes a dashboard switch turn edit mode off without any effect to write.
  - RGL is `react-grid-layout@2.2.4`. `DesktopPanelGrid.tsx:145` already uses the v2 `dragConfig`, so `dragConfig.enabled`/`resizeConfig.enabled` exist for the gate.
- **The tidy persistence path does NOT work as literally described.** See CR1.
  - `layoutHistoryThunks.ts` `applyTraversal` dispatches `undoLayout`/`redoLayout`, which set `applied` and bump `revision`, and then `setDashboardLayoutLocally`.
  - `useLayoutSave.ts` (HEL-1230 header contract) classifies a store-layout change as a history traversal only if `revision` changed AND the layout equals `applied`.
  - Every unclassified change is class 4, "server/external truth": it re-baselines and clears pending.
  - So a thunk that does `pushLayoutSnapshot` + `setDashboardLayoutLocally` (the plain reading of "push the pre-tidy layout … apply through the same path undo uses") marks the tidied layout as already persisted. It never PATCHes. A later undo would then PATCH the original layout against the wrong baseline.
- **Tidy over "all four breakpoints" ignores HEL-1023 authored vs resolved layouts.** See CR2. `dashboardLayout.ts:130-138` (`resolveDashboardLayout`) treats a breakpoint with an out-of-bounds entry as unauthored (every panel is derived), derives panels with no anchor, and says "Nothing here is ever persisted: callers persist a breakpoint only on a user edit at it". D8 does not say whether `tidyLayout` runs on the authored store layout or the resolved one, or how unauthored/partial breakpoints and the "Nothing to tidy" check are handled.
- **Ticket AC coverage.**
  - AC1 is covered by D1, D3, D9 and the meta-row spec.
  - AC2 is covered by D5, the layout-undo-redo delta, and test re-pointing in tasks 2.3/3.3.
  - AC3 is covered by D7 and task group 1, done in cycle 1.
  - AC4 is covered by D8 and tasks 4.x, with C1 and the before/after DB proof (4.3).
  - I found no uncovered AC and no scope beyond the ACs plus the owner answers.
- **Owner routing.** All three structural choices are now owner-answered. The remaining lane choices are the narrow-width ladder thresholds, the copy, and dividers counted; they are cheap to reverse and are recorded in `ui-decisions.md` (5.4). None needs the owner, provided CR2's choice is recorded there as well.

### Verdict: REFUTE

The plan is close. Three specific gaps remain. The first is a silent-failure trap: AC4 "persisted only through the normal save path" would quietly not persist at all.

### Change Requests

1. **D8 / task 4.2: name the history mechanism that makes a tidy count as a local edit for `useLayoutSave`.**
   - Replace "pushes the pre-tidy layout onto the undo stack … through the same path undo uses" with an explicit slice reducer, for example `recordLayoutTidy({ dashboardId, before, after })`, that does all of the following in one action:
     - push `before` onto `past`, capped at `MAX_HISTORY_DEPTH`;
     - clear `future`;
     - set `applied = after`;
     - bump `revision`.
   - The thunk then dispatches `setDashboardLayoutLocally(after)`. `useLayoutSave` classifies the result as class 2 (a history traversal), so it stays pending against the server baseline.
   - Update the HEL-1230 classification comment in `useLayoutSave.ts` so class 2 names tidy, and fix its "history comes only from drag/resize/undo" line.
   - Task 4.2's "layout becomes pending and exactly one PATCH on flush" test must go through the real `useLayoutSave` with a real store, not a mocked hook. It must be shown red with the `revision`/`applied` update removed.
2. **D8 / task 4.1: state which layout tidy operates on.**
   - Specify that `tidyLayout` runs on the authored store layout, not the render-resolved one.
   - Define what happens to a breakpoint that `resolveDashboardLayout` treats as unauthored (any entry out of column bounds): leave it untouched. Never materialize derived positions into it, because HEL-1023 persists a breakpoint only on a user edit at it.
   - Define what happens to a partial breakpoint (live panels without an anchor): compact the anchors only, or leave it.
   - Compute "Nothing to tidy" on the same basis, so the button is never enabled for a click that changes nothing visible.
   - Add unit cases for an unauthored breakpoint and a partial breakpoint.
   - Record the choice in `ui-decisions.md`.
3. **D3 vs DESIGN.md §5: resolve the borderless-chrome contradiction.**
   - The meta row's root carries `.app-command-bar`. DESIGN.md §5 "Chrome surfaces are borderless" is **[mechanical]**, and `App.css:203-210` strips the hairline from every `.cmd-btn`, `.ui-icon-btn` and `.actions-menu__trigger` inside it.
   - D3 nonetheless specifies Share as a "secondary bordered button" (and Undo/Redo as "secondary").
   - As written, an implementer either sees the border silently stripped or hand-rolls a new bordered recipe, which §5 calls a defect.
   - Pick one in D3:
     - (a) every non-primary meta-row control follows §5's borderless chrome rule (Share as `.cmd-btn`, edit tools as `.cmd-btn`/`IconButton`), and the deviation from the B2 board's bordered Share is recorded in `ui-decisions.md`; or
     - (b) a deliberate, documented DESIGN.md §9 exception for the meta row's Share, with the selector named.
   - Add `.cmd-btn--primary` (`App.css:262`, already present) as the Add panel recipe so the executor does not invent one.

### Non-blocking notes

1. **One predicate for the dashboard chrome condition.** HEL-1575's `showTabBar = showRail && onDashboardView` is the same condition as `usesDashboardMetaRow`. D1 already says the second lane to merge folds `hideDashboardBreadcrumb` into the shared predicate. Extend that to `showTabBar` too, so one predicate gates the tabs, the meta row and the `app-shell--tabs` class, rather than two parallel conditionals.
2. **`.undo-redo-btn` is also in the phone hide list.** It appears in `App.css`'s phone `@media` hide list (`.undo-redo-btn, .dashboard-appearance-editor, .app-command-bar .save-state-indicator`), not only as a standalone rule. D10b should say to remove it from that selector list. The F-186 comment it mentions is in `CommandBar.tsx`, not `App.css`.
3. **Stale CommandBar doc comment.** It says it "Owns undo/redo entirely … since it's unconditionally mounted for exactly `AppShell`'s lifetime", which is no longer true after the swap. Update it in 3.3.
4. **Duplicated sentence in tasks.md.** C3 says "CSS-count pins are recounted to the true number, never loosened" twice.
5. **Escape guard.** The D4 Escape guard should also skip while an RGL drag or resize is in progress. The menu/dialog guards are already listed.
