## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed head: 9d2d260b5c1cd74e32ca4bcebd13ced801e6b236. Base: 31263face74bbf493bdd790b8f4ae248d7d6ffa2, resolved live with resolve-review-base.sh. The review covers the whole change against all four ACs and the owner's answers.

The owner's answers come from `events.jsonl`, not from what the brief relayed:
- `escalation.answered` for HEL-1576-1792053980784-c95b08: `meta-row-replaces-command-bar`, `drag-only-in-edit`, `tidy-layout`; `answer_source: human`, channel `chat`.
- HEL-1576-1792085585343-91650c: `proceed-to-execution`, `answer_source: human`.

The two documentation change requests from cycle 1 are fixed:
- the panel-content-sizing delta now restates "Panel card container sizing baseline" with margin=12 and 308px;
- design.md D7 no longer describes a CSS custom property.

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1: no title; meta row shows count, refresh and sources; actions work | PASS with one defect (CR1). Live: the h1 is the sr-only landmark (`app-content__sr-heading`, 1×1, clipped); the row text is "3 panels · refreshed 17 seconds ago · source · Orders feed", with no heading and no dashboard name. |
| AC2: undo/redo in edit mode and by keyboard; existing tests pass | PASS. Undo, Redo and Tidy appear only in edit mode, with `formatCombo` titles ("(Ctrl+Z)"). Live: Ctrl+Z with the meta row mounted restored the pre-tidy layout exactly. |
| AC3: gutter is a token and matches DESIGN.md | PASS. Measured 12px at 1280 and 1500. The drift test is unchanged from cycle 1. |
| AC4: gap fix built, demonstrated, no unprompted rewrite | PASS. Reproduced independently on my own throwaway dashboards (below). |
| Owner answers 1–3 honoured | PASS. Rail-shell dashboard view: meta row and no command bar. /pipelines at 1280 and the phone shell at 768 and 375: command bar and no meta row. Drag and resize are gated. Tidy is click-only. |
| No silent AC reinterpretation | PASS |
| Tasks marked done match the code | PASS, except the gaps in CR1, CR2 and CR3 |
| Scope creep | PASS |
| Regressions | PASS (full jest and full e2e green, see Phase 2) |
| API, schemas | N/A (frontend only) |
| Planning artifacts reflect implemented behaviour | **FAIL**, see CR4 |
| CONSTRAINTS C1–C5 | PASS. C1 is proven live (below). C3: `App.tsx` changes only the swap, via `usesDashboardMetaRow`; `App.css` changes only the dead `.undo-redo-btn` comment and its hide-list entry; CSS pins are recounted 141→142. C5: I re-ran the full e2e suite myself. |

### Phase 2: Code Review — FAIL

**Gates I ran myself in WORKTREE_PATH.** All ran under `nice -n 19` with jest capped at 2 workers. Load was 9.80 at start and 15.27 at end, after waiting for load to drop to 10 or below.
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run check:e2e-types`: exit 0.
- `npm test`: exit 0. Root: 51 suites / 469 tests. Frontend: 628 suites / 7501 tests. `jest --listTests` lists 628 paths, all under this worktree.
- `npm --prefix frontend run build`: exit 0.

**Full Playwright e2e (C5 claim verified).**
- Command: `npx playwright test --workers=2` under `nice -n 19` and `flock -w 3600 …/scratchpad/e2e.lock`, run from this worktree.
- Environment: DEV_PORT=7008, BACKEND_PORT=9915, `DATABASE_URL` set to the scratch database `helio_hel1576`. The backend log shows "Successfully validated 135 migrations", so it is not the shared V136 database.
- Result: "Running 312 tests using 2 workers" ending in **"312 passed (16.1m)", exit 0**. Load was 9.71 at start and 6.21 at end.
- Persisted log: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.e2e-eval2.log`.
- The executor's own raw first-run log (300 passed, 12 failed at 62f178b45) is consistent with its triage note in measurements.md.

**Red-first evidence** (`evidence-red-first.md`, files under `.concertino/runs/HEL-1576/evidence/`):
- `drag-gate-red.txt`: two real-RGL tests fail when `enabled` is forced on.
- `tidy-patch-red.txt`: 0 or 1 PATCHes instead of 1 or 2 when the reducer is swapped out.
- `tidyLayout-red.txt`: three mutations, all killed.
- `escape-popover-red.txt`: killed.

I also confirmed the drag gate live, independently: in view mode no `.react-grid-item` has `react-draggable`, every item has `react-resizable-hide`, resize handles are `display:none` and drag handles are hidden. In edit mode all three items are `react-draggable` and 3 handles are visible.

**Checklist**
- Code quality: PASS. Imports are at the top. Files are within budget (DashboardMetaRow.tsx is 197 lines). No `any`.
- DESIGN [mechanical]:
  - PASS. Spacing uses `--space-*`; font-size `--text-xs`; colours are tokens; the dot is 6px, a dimension rather than spacing.
  - Exactly one `.cmd-btn--primary` in the row in both themes.
  - The Done pressed state uses `--app-surface-soft` / `--app-surface-strong` with `--app-text`, never the accent.
- DRY: PASS.
  - Tidy wraps the existing `compactLayout`.
  - Undo and redo reuse the same thunks.
  - Add panel uses `useCreatePanelAction().cta`.
  - Share mirrors the context list's action, which has no gate.
- Error handling: PASS.
- Security: N/A.
- Tests: mostly meaningful, with two untested paths that are real defects (CR1, CR2).
- Dead code: `container-type: inline-size` in `DashboardMetaRow.css:4-7` has no `@container` consumer; the tier is measured in JS (non-blocking).
- Specific defects: CR1, CR2, CR3.

**Executor decisions I was asked to judge**
- **Short-card rhythm** (`data-short-card`, `h <= 4`; `PanelGrid.css` adds `padding-block: var(--space-3)` and `gap: var(--space-2)`): sound.
  - It fixes the 12px-gutter regression of the HEL-1398/HEL-1444 canvas floors in the panel's own CSS, as D10a requires, without loosening those floors or changing `rowHeight`.
  - An attribute on the parent is the right tool. The padding belongs to `.panel-grid-card`, which is itself the `panel-card` size container, so a container query cannot restyle it.
  - It is tokens only, and a test covers marking and not-marking.
  - It is not written down anywhere in the spec or design (CR4b).
- **Edit layout only while the movable grid is mounted** (`desktopGridDashboardId`): sound. The read-only stack (for example 820px with the list open, or 1100px with the list at its default width) cannot move panels, so a toggle there would do nothing. Unmounting the grid ends edit mode, and a test covers it. The spec still says Edit layout is always present (CR4a).
- **Appearance editor kept in the row at every tier:** acceptable.
  - The live sweep (mine at 820 and the executor's at 780–1500) shows the actions never wrap or overlap the facts.
  - DESIGN.md §9 as written matches the build: only Share and the assistant move into the kebab.
  - design.md D3(iii) still says the editor moves (CR4c).

### Phase 3: UI Review — FAIL

Servers were started with `start-servers.sh` with `DATABASE_URL` set to `helio_hel1576`; `assert-phase servers` printed PASS. I checked the page port was 7008 before every action and awaited fonts before every measurement. I used throwaway users only:
- `hel1576-eval-1792093660345@example.test`, seeded by a copy of the executor's API seed;
- `hel1576-eval-empty-1792093883075@example.test`.

Both live only in the scratch database. Nothing was written to `helio` or under matt@helio.dev.

**C1 proof (independent)**
- Stored `layout` md5 before opening: Workouts `38a34b55…`, Roadmap copy `f2bc32ef…`.
- I opened Roadmap copy and left it idle for about 35s, past the 30s auto-save tick. No `/api/dashboards` write was sent, md5 was still `f2bc32ef…`, and `last_updated` was unchanged (12:47:43, the seed time).
- Edit layout, then Tidy: "Unsaved changes · Save now" appeared, and nothing was written until a save.

**AC4 demo, 1500px, dark**
- Workouts: the table moved from top=1608 to 456 and Notes from 456 to 72, with x, w and h unchanged.
- Roadmap copy: items moved from 1544/1992 to 392/392.
- Ctrl+Z restored the pre-tidy rects exactly. Tidy then reads "Nothing to tidy" (disabled). Escape left edit mode.
- On Workouts, a PATCH landed at 12:48:29.85, the moment of the click. That matches the grid's 30s auto-save tick after mount (the user's tidy is the explicit action that made the layout pending), so it is not a C1 issue.

**Breakpoints**
- **1280, dark and light:** meta row present, no command bar. Row height 48. One primary. Vertical gap 12. No overflow.
- **820, both themes:** row 516px wide, tier 3: "5 panels" and Add panel; Share and "Open assistant" are in the kebab; no Edit layout because the stack renders. Actions fit and do not overlap the facts.
- **768 and 375, both themes:** command bar only, with no meta row and no undo buttons. The phone kebab contains "Add panel" and "Refine with AI".
- **/pipelines at 1280:** command bar.
- **Contrast:** muted text on surface measures rgb(170,164,156) on rgb(26,24,22) in dark and rgb(100,94,86) on rgb(253,252,250) in light, consistent with the executor's 7.17 and 6.25.
- **Console:** no errors from the meta row.
  - The 502s on `/api/pipelines/:id/run-events` (SSE through the Vite proxy) are the same pre-existing ones seen in cycle 1.
  - One Redux "selector returned a different result" warning appeared when the share dialog opened. The likely source is `DashboardShareDialog`'s `selectShareTokensForDashboard`, which is not in this diff.

**Defects found live:** CR1 (empty chrome row, screenshot below) and CR2 (focus lost).

Screenshots (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots2/eval2-workouts-1500-dark-view.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots2/eval2-roadmap-1500-dark-after-tidy.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots2/eval2-roadmap-1280-light.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots2/eval2-roadmap-375-dark.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots2/eval2-nodashboard-820-empty-row.png`

### Overall: FAIL

### Change Requests

1. **With no dashboard selected, the assistant button disappears below tier 2.**
   - **Code:** `frontend/src/app/dashboardMeta/DashboardMetaRow.tsx:192-193` renders `{!shareInKebab && assistantButton}`, while the kebab, which holds "Open assistant" at tier 2 and above, renders only when `selectedDashboard` is set. With no dashboard and a row under 670px, the chrome row is empty.
   - **Live:** a new user with no dashboards on `/home` at 820px has a row 516px wide containing no buttons. At 1280 the same row shows "Open assistant". Screenshot: `eval2-nodashboard-820-empty-row.png`.
   - **Why it matters:** this breaks design D1 ("No dashboard selected … only the assistant button") and the RTL test's own claim at `DashboardMetaRow.test.tsx:215`. That test only covers tier 0.
   - **Fix:** render `assistantButton` when `!shareInKebab || !selectedDashboard`. Add an RTL case with `tierMock.mockReturnValue(2)` (and 3) and `selected: false` asserting "Open assistant" is present.
2. **Share's focus restore fails at the kebab tiers.**
   - **Code:** `DashboardMetaRow.tsx:29,87-91` always passes `restoreFocusSelector: 'button[aria-label="Share dashboard"]'`. At tier 2 and above Share is a kebab menu item, which unmounts when the dialog opens. That selector then matches nothing, and focus falls to `<body>`.
   - **Live:** at 820, Dashboard actions → Share dashboard → Escape left `document.activeElement` as `BODY`.
   - **Fix:** when `shareInKebab`, pass the kebab trigger instead (for example `.dashboard-meta-row button[aria-label="Dashboard actions"]`, the `ActionsMenu` trigger), which is what DashboardList does for its row kebab. Add an RTL test that calls the dialog's close at tier 2 and asserts focus lands on the kebab trigger.
3. **Wrong e2e re-point for the phone shell.**
   - **Code:** in `e2e/hel909-output-picker-panel-sheet.spec.ts:177-186`, the 375/430px test was changed to click `getByRole("group", { name: "Dashboard actions" }).getByRole("button", { name: "Add panel" })`. The meta row never renders on the phone shell. Live at 375, the phone CommandBar kebab still holds "Add panel" (confirmed), as design D6 intends.
   - **Why the full run passed anyway:** the spec is quarantined (`playwright.config.ts:75-79`). The edit would fail as soon as HEL-963 un-quarantines it, and the comment just above it now contradicts the code.
   - **Fix:** restore the kebab path for the phone case (`getByRole("button", { name: "Dashboard actions", exact: true })` then `getByRole("menuitem", { name: "Add panel" })`). Keep the meta-row path for the two desktop cases.
4. **Planning and spec artifacts do not match the build.**
   - a. `specs/dashboard-meta-row/spec.md`, requirement "The meta row carries the dashboard's actions…": say that Edit layout and the edit tools are offered only while the movable desktop grid is rendered. Change the "Narrow content column" scenario (820px window, list at 400px): it now renders the read-only stack, so Edit layout is not offered there. Adjust its THEN, or switch it to a width where the grid renders.
   - b. `specs/panel-content-sizing/spec.md`: add the minimum-height card rhythm, either to "Panel card container sizing baseline" or as an added requirement. A 4-row card takes `padding-block: var(--space-3)` and `gap: var(--space-2)`, and the HEL-1398/1444 canvas floors depend on it.
   - c. `design.md`:
     - D3: list (iii) should say the appearance editor stays in the row at every tier, matching ui-decisions.md and DESIGN.md §9.
     - D3: the Done token pair should be `--app-surface-soft` / `--app-surface-strong`, not `--app-surface-raised`.
     - Risks: delete or rewrite the last bullet. AC1 no longer depends on HEL-1575's merge order, because the command bar does not render on the rail-shell dashboard view.
   - d. `files-modified.md` still lists only the cycle-1 files. Regenerate it for the full diff (68 files).

### Non-blocking Suggestions
- After Tidy is clicked it becomes disabled ("Nothing to tidy"), and live keyboard focus fell to `<body>`. Consider moving focus to Undo after a successful tidy.
- Cosmetic artifacts of the scripted e2e edits: literal `\'` inside `//` comments ("meta row\'s") and blank lines inside member chains, in hel1189, hel1230, hel1260, hel516 and hel909. Also, the comment above the hel516 re-point (`hel516-palette-quick-create.spec.ts:343-346`) still says Add panel moves into the CommandBar kebab.
- `DashboardMetaRow.css:4-7`: `container-type`/`container-name` have no `@container` consumer. Drop them, or note that they are kept for future CSS.
- `tidyLayout` compacts live entries only. A stored entry for a panel this tab has not loaded can therefore end up overlapped, and the HEL-1233 repair would then flag the breakpoint as stored-bad on the next open. This was a deliberate D8 decision mirroring the drag path; worth a sentence in ui-decisions.md.
- `selectCanTidyLayout` runs a 4-breakpoint compaction on every store update while editing. This is fine at current panel counts; memoise it if dashboards grow large.
