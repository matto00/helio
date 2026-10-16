## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: a3bb53f8bdd383d9341f75d4a828042697a271ff. Base: 7fd2f4f29157c1f159db12e99bda86ef886e4cf2, resolved live with `resolve-review-base.sh` (exit 0). The spawn-cwd guard printed `READY`.

Evidence prefix: `E=/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.concertino/scratch/HEL-1576`

### What I verified (with evidence)

**Owner answers.** I checked `events.jsonl` directly, and every answer has `answer_source: human`:
- Line 27 (c95b08): `meta-row-replaces-command-bar`, `drag-only-in-edit`, `tidy-layout`.
- Line 35: `proceed-to-execution`.
- Line 59: `fix-forward`.

**Gates I ran myself in the worktree under `nice -n 19`:**
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- Targeted jest at `HELIO_JEST_MAX_WORKERS=2`, over the meta row, AppShell, CommandBar, dashboardChrome, tidyLayout, layoutHistory slice and thunks, useDashboardMeta, DesktopPanelGrid*, panelGridConfig, useLayoutUndoRedo, useLayoutSave and the token guards: 27 suites and 241 tests passed.

I relied on the evaluator's pasted output for the rest:
- Full jest: 7504 tests.
- Full e2e on 40f36039e: "312 passed (15.4m)", evaluation-3.md:57.
- hel1028 on the cycle-4 head: "13 passed".

The only frontend/e2e delta since 40f36039e is `DashboardMetaEditTools.tsx` plus its RTL test (`git diff 40f36039e HEAD --stat`).

**Live checks.** Servers ran on 7008/9915 against `helio_hel1576`. I mapped the backend PID's PostgreSQL client ports through `pg_stat_activity` and all 6 connections went to `helio_hel1576`. I used the evaluator's existing throwaway user, never `helio` or matt@helio.dev. I confirmed port 7008 before every action and awaited fonts. Servers were stopped with `stop-servers.sh`.

**AC1: no title; the meta row shows facts and the actions work.**
- The row reads "3 panels · refreshed 1 hour ago · source · Sample: Ops incidents", with a success dot.
- The only `<h1>` is the pre-existing visually hidden landmark. No visible heading carries the dashboard name.
- Edit layout, Share, Add panel, the appearance editor, the assistant and the kebab are all present.
- Share opened the share dialog from the kebab tier at 820, and Escape returned focus to the kebab.
- `/pipelines` still renders the CommandBar, and the phone shell (768, 375) keeps the CommandBar unchanged.
- Code: `App.tsx` swaps on `usesDashboardMetaRow` (`dashboardChrome.ts`, composed from `isDashboardViewPath`).
- Screenshots: `$E/sk-dark-1280-248-view.png`, `$E/sk-light-820-kebab.png`, `$E/sk-light-768.png`.

**AC2: undo and redo.**
- Edit mode shows Undo and Redo buttons, with titles taken from `formatCombo`.
- Live: after Tidy, Ctrl+Z restored the gapped positions (tops 72/712/1224) and Ctrl+Shift+Z re-applied the tidy (72/456/456).
- `useLayoutUndoRedo` is mounted in whichever of DashboardMetaRow and CommandBar is rendered.
- The existing undo tests pass in my targeted run, and hel1028 e2e passed per the evaluator.

**AC3: gutter token.**
- `GRID_GUTTER_PX = 12` is pinned to `--space-3` by a test that parses `theme.css`.
- DESIGN.md §9 gains "Dashboard grid gutter: `--space-3` (12px)".
- Live DOM: horizontal 328+458=786 → 798 (12px); vertical 444 → 456 (12px).

**AC4: gaps fixed with no unprompted rewrite.** On the throwaway user's "Finance spend (sample)" I PATCHed a gapped layout (rows 6–10 and 14–18 empty at lg; the same in md/sm/xs). Then:
1. **Before opening:** DB `md5=fce10678…`, `layout_version=5`.
2. **After opening plus 30s idle (one auto-save tick):** the row was byte-identical (same md5, version and `last_updated`).
3. **Click Edit layout:** Tidy was enabled.
4. **Click Tidy:**
   - Panels compacted upward with order and x preserved.
   - Tidy became disabled ("Nothing to tidy") and focus moved to Undo.
   - The save state showed "Unsaved changes".
5. **Save now:** DB `layout_version=6`, lg y = 0/6/6, which is the tidied layout. After a reload the tidied layout persists.

Screenshots: `$E/sk-tidy-1-before.png`, `$E/sk-tidy-2-after.png`. DB rows: `$E/sk-db-after-save.txt`.

**Drag only in edit mode (owner answer 2).**
- View mode: 0 visible drag handles, `dragConfig.enabled=false`, and the resize handles are `display:none` (`react-resizable-hide`).
- Edit mode adds handles and the `panel-grid--editing` class.
- Escape leaves edit mode.

**ui-decisions.md, judged live:**
- **Borderless Share:** matches the §5 chrome rule. Add panel is the only accent control in every state I captured.
- **Light "Done" pressed state:** visible in light (`$E/sk-light-1600-edit.png`) and in dark (`$E/sk-dark-1280-248-edit.png`).
- **Narrow-width ladder:**
  - Labelled in view mode at 1280 with the default 248px list.
  - Icon-only edit tools at 1280 in edit mode.
  - Fully labelled edit tools at 1600.
  - Count-only, with Share and the assistant in the kebab, at 820.
  - Actions never wrapped or overflowed at any width I checked.
- **Edit layout only while the movable grid is mounted:** at 820 the stack renders and Edit layout is not offered.
- **Short-card rhythm:** 4-row chart cards at 244px render without clipping in both themes.
- **Tidy's authored-layout rule:** `tidyLayout.ts` keeps non-live entries verbatim, never adds entries, leaves unauthored breakpoints alone, and returns the input layout itself when nothing moves.
- **Comparison with the B2 board:** the same row structure ("N panels · refreshed · source", then Edit layout / Share / Add panel).

**HEL-1575 composition (design D1).** HEL-1575's `App.css` targets `.app-shell--tabs .app-command-bar { grid-row: 2 }`. The meta row's root carries `app-command-bar`, so it lands in row 2 directly under the tab bar, as claimed. HEL-1575's `showTabBar = showRail && onDashboardView` matches `usesDashboardMetaRow`.

Expect a textual conflict in `App.tsx`: HEL-1575 re-indents the whole shell block under `CommandPaletteProvider`. The second lane to merge must keep both the tab bar and the meta-row swap, and fold the now-unreachable dashboard branch of `hidesBreadcrumbItemName`, as ui-decisions.md already notes.

**Console.** The only errors were intermittent 502s on `/api/pipelines/:id/run-events` (an SSE stream through the Vite proxy). That subscription comes from the pre-existing `pipelineRunFanout`, which base `useOutputHistory` and `ProvenanceTrigger` already use, so I do not attribute it to this change. The ECharts zero-size warnings come from the pre-existing switch from grid to stack.

**Gate-defect check.** No report I drilled into discloses unsound evidence mtimes, and no conclusion here rests on mtime ordering. All persisted evidence is content: screenshots and DB md5/version rows.

### Verdict: CONFIRM

### Non-blocking notes
- The icon-only Edit layout toggle changes its accessible name ("Edit layout" → "Done") while also toggling `aria-pressed`, so a screen reader hears "Done, pressed". A fixed name with `aria-pressed`, or a changing name without it, is the conventional pattern.
- The `PanelGrid.css` comment says React Grid Layout "stops rendering the resize handles". In fact they are rendered and hidden with `react-resizable-hide`. The behaviour is correct; only the comment is imprecise.
- At 1280 with the default list, edit mode makes Tidy layout icon-only (LayoutList icon plus title). Tidy is the owner-chosen AC4 action, so it is worth confirming its discoverability with the owner at that common width.
- The evaluator's open nits still stand:
  - Memoise `selectCanTidyLayout`, which runs `tidyLayout` on every store update while editing.
  - Seed `useMetaRowTier` from the content box.
  - Remove the duplicated comment at `e2e/hel516-palette-quick-create.spec.ts:347`.
