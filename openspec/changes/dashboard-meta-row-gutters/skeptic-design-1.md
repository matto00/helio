## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585. The change dir is untracked, so the planning artifacts were read from the working tree.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/dashboard-meta-row-gutters/HEL-1576`.
- **Artifacts read:** ticket.md, proposal.md, design.md (D1-D10), tasks.md (groups 1-5 plus C1-C4), the four spec deltas, workflow-state.md (OPEN_ESCALATION HEL-1576-1792053433726-b1fb9d). Also read DESIGN.md §0, §3 Spacing and §9; HANDOFF.md; the B2 board markup (`B2Dashboard.dc.html:68-79`: a 40px meta row directly under the 44px tab strip, no command bar, gap 12px); the HEL-1574 owner rulings in `.concertino/runs/HEL-1574/events.jsonl`; the HEL-1576 escalation text in `.concertino/runs/HEL-1576/events.jsonl`.
- **Code claims that hold:** `panelGridConfig.margin` is `[18, 18]` (`panelGridConfig.ts:34`). Its only consumers are `DesktopPanelGrid.tsx:143` and `DesktopPanelGridSkeleton.tsx:53`. `--space-3` is `0.75rem /* 12px */` (`theme.css:50`). `DesktopPanelGrid` uses `noCompactor` with preventCollision and `dragConfig={{ handle: ".panel-grid-card__handle" }}` (`:34`, `:145`). CommandBar has the Undo/Redo buttons (`CommandBar.tsx:236-256`), calls `useLayoutUndoRedo` unconditionally (`:108`) and builds the kebab's Add panel from `useCreatePanelAction().cta` (`:80-86`). `formatCombo` (`shortcuts.ts:130`), `useShareDialog` (`shareDialogContext.tsx:67`), `useIsPhoneShell` and `PipelineSummary.{roots[].dataSourceName,lastRunStatus,lastRunAt}` (`pipelineStep.ts:686-706`) all exist. The context list's Share has no gate (`DashboardList.tsx:360-372`), so "mirror the gate" means always available. The zoom widget is `position: fixed` (`PanelList.css:23`), so it does not compete with the meta row for a row.
- **Grid-margin literal sweep:** `grep` for 18-margin hits finds only `panelGridConfig.ts:34`, `DesktopPanelGrid.processedWidth.test.tsx:66` and `openspec/specs/panel-content-sizing/spec.md:76,80`. All are covered by D7 and task 1.2, and the delta's 190-206px figure is arithmetically right (332→308).
- **Concurrent lanes (checked against their branches, not the brief):**
  - HEL-1575's diff touches `PanelList.tsx` (+restoringDashboardId skeleton gate, empty-state copy; small and mergeable), `CommandBar.tsx` (hideDashboardBreadcrumb only) and `App.tsx`/`App.css` (tab bar row).
  - HEL-1575's archived design.md:25 and :206 say: "the meta row, title/undo relocation ... (HEL-1576)" and "Everything else on the `CommandBar` stays **until HEL-1576**." This contradicts this plan's D1 (see CR1).
  - HEL-1578's diff does not touch PanelList, the grid or CommandBar.
- **Overall:** the plan is mostly concrete and buildable, the gutter work (group 1) is clean and independent, and AC4 is correctly blocked under C1. But two decisions taken as "overnight reversible" are ones that later work, including this ticket's own open escalation, builds on. One stated mechanism is false against the code, and the task list misses tests the plan itself will break.

### Verdict: REFUTE

### Change Requests

1. **D1 (meta row under the command bar) must be escalated, not deferred to an ownerless follow-up.**
   - DESIGN.md §9 is binding and above HANDOFF in the stated precedence. It says the meta row is "a slim row under the tab bar", and the board has no command bar on the dashboard view at all.
   - D1 accepts tab bar → command bar → meta row → grid. That is three chrome rows where §9 specifies two. It hands "folding the command bar's remaining dashboard controls into the meta row" to "whichever ticket owns the command bar's dashboard-view content after HEL-1575".
   - HEL-1575's own design names that owner as **HEL-1576** ("Everything else on the CommandBar stays until HEL-1576", archived design.md:206). The two lanes point at each other, so the follow-up has no owner.
   - It is also a shell-structure choice that later tickets build on (HEL-1583 reuses the derivation, HEL-1584 adds motion), so the driver's overnight rule requires escalation.
   - Required: raise it to the owner, `--raise-only` so groups 1 and 3.1 continue, and record the answer in workflow-state.md. Suggested options:
     - (a) This ticket moves the dashboard view's remaining command-bar controls (Save state/Save now, appearance editor, Refine with AI, assistant) into the meta row and hides the command bar on the rail-shell dashboard view. This needs C3 relaxed for a scoped App.tsx/CommandBar edit, sequenced after HEL-1575 merges.
     - (b) Accept three rows now and file a named Linear ticket for the fold.
     - (c) Something else the owner names.
   - Do not leave "a follow-up" unnamed in the PR body.

2. **D4 (edit mode gates drag and resize) should go to the owner in the same escalation.**
   - It changes the core interaction for every existing user: panels can no longer be dragged without first clicking Edit layout.
   - The ticket only says "Undo/redo move into edit mode". It does not say drag becomes modal.
   - The open AC4 escalation already presupposes D4: `tidy-layout` is "shown only in Edit layout mode", and `compact-while-viewing` only has meaning if viewing and editing are distinct modes. The owner's AC4 answer therefore rests on an unratified premise, which makes D4 a decision other work builds on, not a local reversible one.
   - Required: add D4 as a sub-question (options e.g. `gate-drag-in-edit-mode` / `drag-always-edit-reveals-undo-only`). Mark tasks 2.1/2.2, the `dashboard-layout-edit-mode` spec and the undo/redo-visibility scenarios as contingent on it.

3. **D2's live-update mechanism does not exist as described. Specify a real one.**
   - D2 says the facts update "when the store's pipeline summaries change (e.g. a run completing through the existing run-status refresh path); no new polling or endpoint".
   - Nothing on the dashboard view updates `PipelineSummary.lastRunAt/lastRunStatus` when a run completes. `pipelinesSlice.ts` writes summaries only on `fetchPipelines`/`fetchPipelineById`/`updatePipeline`/`createPipeline`/delete (`:96-215`). The run-status path panels use is `pipelineRunFanout.ts` (SSE, module-scoped), and it never touches Redux.
   - As planned, the spec scenario "A run completes while the dashboard is open → shows the new time without a reload" cannot pass.
   - Required: specify the mechanism. For example, subscribe the meta row's feeding pipeline ids via the existing `subscribeToPipelineTerminal` (`pipelineRunFanout.ts:117`). It shares the panels' refcounted connection, so no new connection is opened. On a terminal event, refetch that pipeline's summary or patch it. Add a test that drives a terminal event and asserts the new time.
   - Also state how Output → pipelineId is resolved. `outputMetaCache` is a non-reactive module `Map`, `getOutputMetaCached` returns `undefined` unless retained, and `useOutputMeta` takes a single id. The hook needs `fetchOutputMeta` per distinct outputId into local state, not a synchronous cache read. "Read from the existing Output metadata cache" can be read both ways.

4. **The task list misses the tests D4 will break.**
   - Task 3.3 re-points only the undo/redo button clicks.
   - Drag/resize-handle e2e specs exist that will fail once drag is gated: `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts`, `e2e/hel1230-drag-then-create-persists.spec.ts`, `e2e/hel1457-stale-tab-layout-save.spec.ts` (`grep -l "panel-grid-card__handle\|react-resizable-handle" e2e/*.ts`). The same may apply to any jest test asserting handles render by default.
   - Required: add a task to enter edit mode in each before dragging (never delete or skip them), with the e2e run cited.
   - Task 2.1's "drag disabled when off" must be proven against a real RGL render (handles absent from the DOM, `react-draggable` not bound). The many `DesktopPanelGrid.*.test.tsx` files mock RGL and call `lastProps().onDragStop` directly, which passes whether or not drag is gated.

5. **D3's "at 820px everything fits on one line (checked live)" is false by arithmetic.**
   - At 820 the content column is 820 − 56 (rail) − 248 (default list) − 48 (`.panel-list` padding `--space-6` × 2) ≈ 468px. With the list at its 400px max it is ≈ 316px.
   - In edit mode the row holds five controls (Undo, Redo, Done, Share, Add panel) at roughly 400px or more before any fact. At max list width even the actions alone do not fit, so "facts truncate before actions wrap" cannot hold.
   - Required: specify the narrow behaviour, e.g.:
     - Undo/Redo become icon-only `IconButton`s with aria-labels below a container width (container query, since §4 forbids new breakpoints).
     - Or the facts wrap to their own line.
   - Then verify at 820 with the list at 248 and at 400, in and out of edit mode.

6. **Meta-row geometry and background are unspecified.**
   - The meta row would mount inside `<section className="panel-list">`. That section has `padding: var(--space-6)` and carries the user's `--dashboard-grid-background-override`, an opaque preset tint (`PanelList.tsx:273-287`, `appearance.ts:208-227`).
   - D3's hairline bottom border would therefore be inset 24px. On the board it is full-bleed (`padding: 0 20px`, border spanning the column).
   - The muted mono `--text-xs` text would sit on arbitrary tinted grid colours.
   - Required: state whether the row bleeds to the section edges (and how) or is intentionally inset. Add to 4.2 a contrast check of the muted text and dot against at least two non-transparent grid backgrounds in both themes.

7. **C3 contradicts the CommandBar change.**
   - Removing the Undo/Redo buttons leaves `.undo-redo-btn` dead in `App.css`: the explanatory comment at `:315-323` and the hide rule at `:468`. C3 forbids editing App.css.
   - Required: say which applies. Either C3 permits deleting exactly that selector and the dead sentence (a one-line, conflict-light edit next to HEL-1575's additions), or the dead rule is left and recorded with a named follow-up. An implementer cannot satisfy both CONTRIBUTING's no-dead-code norm and C3 as written.

8. **Add a content-fit check for the tighter gutter.**
   - Every panel loses 6px per row gap: a minimum 4-row panel goes from 262 to 244px.
   - Task 4.2 measures the gutter but never checks whether content that fits today (KPI, footnoted charts per HEL-1398/1444, tables at minH) now clips or grows a scrollbar.
   - Required: add a 4.2 sub-check of one minimum-height panel per panel kind at 1280, before vs after, with screenshots.

### Non-blocking notes

- **Escape guard (D4):** also ignore `event.defaultPrevented` and open popovers/menus. `ProvenancePopover.tsx:53` and `ActionsMenu` handle Escape themselves; "no dialog open" alone would close the popover and exit edit mode on one keypress.
- **Share focus:** `useShareDialog` throws outside `ShareDialogProvider`, so PanelList/meta-row unit tests need the provider. Pass a `restoreFocusSelector` that targets the meta row's Share button, as `DashboardList.tsx:370` does for its trigger.
- **Merge order:** if this lane merges before HEL-1575, the command-bar breadcrumb "Dashboards / <name>" still shows the name. Disclose the ordering dependency for AC1 in the PR.
- **GRID_GUTTER_PX test:** `--space-3` is declared as `0.75rem`, so the test must convert rem at 16px rather than parse a px literal.
- **Toggle styling:** the pressed "Done" toggle must not use an accent wash, because the spec makes Add panel the only accent control. On the board, Edit layout is borderless ghost and Share is bordered secondary; D3's "secondary/ghost" should say which is which.
- **Naming:** a `panel-edit-mode` capability already exists in `openspec/specs/`. Make the new `dashboard-layout-edit-mode` spec's Purpose distinguish the two.
- **Independence:** apart from CR1/CR2, group 1 (gutter) and task 3.1 (derivation, once CR3 is fixed) are independent of every open question and can proceed while the escalation is out.
