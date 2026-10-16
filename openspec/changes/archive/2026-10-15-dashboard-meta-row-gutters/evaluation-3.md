## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed head: 40f36039e8b77154b77a1886a57bcc42d9b98d1f. That is the cycle-3 fixes in 3cef351ca plus a clean merge of origin/main 7fd2f4f29, with no conflict hunks. The base, 7fd2f4f29157c1f159db12e99bda86ef886e4cf2, was resolved live with resolve-review-base.sh. The diff is 69 files, and I reviewed the whole change.

This was a cold fallback spawn after the 15:42 reboot. Context was recovered from workflow-state.md, evaluation-2.md and the diff. The executor's cycle-3 report was lost, so everything below comes from my own runs.

### Cycle-2 change requests: status

| CR | Status | Evidence |
|---|---|---|
| CR1: assistant button with no dashboard below tier 2 | **FIXED** | `DashboardMetaRow.tsx:194` now renders `(!shareInKebab \|\| !selectedDashboard) && assistantButton`. The new RTL cases for tier 2 and tier 3 pass. Live: a new user with no dashboards at 820px has a 516px row containing "Open assistant" (28×28). The executor's red-first file `cycle3-red.txt` shows both cases failing before the fix. |
| CR2: Share focus restore at the kebab tiers | **FIXED** | At the kebab tiers, `restoreFocusSelector` is `.dashboard-meta-row button[aria-label="Dashboard actions"]`. The new RTL case passes. Live at 820: Dashboard actions → Share dashboard opened the dialog `Share "Ops incidents (sample)"`. Escape then left `document.activeElement` on the meta row's "Dashboard actions" button, not `BODY`. |
| CR3: phone e2e path in hel909 | **FIXED** | The 375/430 case now uses `getByRole("button", {name: "Dashboard actions", exact: true})` and then `menuitem "Add panel"`, and the comment matches the code. The desktop cases keep the meta-row path. See the hel909 run below. |
| CR4a: spec, Edit layout only with the movable grid | **PARTIAL**, see new CR2 | The requirement text is right, and the "Read-only stack" and "No dashboard selected" scenarios match the build. The rewritten "Narrow content column" scenario describes a state the build never produces. |
| CR4b: short-card rhythm in panel-content-sizing | **FIXED** | New requirement plus design D11. |
| CR4c: design.md D3(iii), the Done tokens, the stale HEL-1575 risk | **FIXED** | D3(iii) now says the appearance editor stays in the row. Done uses `--app-surface-soft` / `--app-surface-strong`. The risk bullet is removed, and D12 is added. |
| CR4d: files-modified.md | **FIXED** | It covers every changed file except itself and evaluation-2.md. |

Cycle-2 non-blocking items:
- **Fixed:** the stray `\'` and blank lines in the e2e member chains (all five specs), and the dead `container-type`/`container-name` in DashboardMetaRow.css.
- **Fixed:** the tidy-live-entries note in ui-decisions.md.
- **Fixed, but defective:** focus-after-Tidy, see new CR1.

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1 (no title; meta row facts and actions) | PASS. Live at 1280 in both themes: the h1 is `app-content__sr-heading`; the row reads "3 panels · refreshed N minutes ago · source · Sample: Ops incidents"; no other command bar is present. |
| AC2 (undo/redo in edit mode and by keyboard; existing tests pass) | PASS |
| AC3 (gutter is a token, 12px) | PASS. Live at 1500: card bottoms at 444 and 700, next tops at 456 and 712, so the gap is 12px. |
| AC4 (gap fix built and demonstrated, no unprompted write) | PASS. Unchanged since cycle 2, which proved it independently. |
| Owner answers 1–3 | PASS. The phone shell at 768 and 375 shows the command bar and no meta row. |
| No AC silently reinterpreted; tasks match the code; no scope creep; no regressions | PASS |
| Planning artifacts reflect the build | **FAIL**, new CR2 |
| CONSTRAINTS C1–C5 | PASS. C3: cycle 3 does not touch App.tsx or App.css. C5: full e2e re-run on this head (below). C2 and C4: every run here was capped. |

`openspec validate dashboard-meta-row-gutters --type change` printed "Change 'dashboard-meta-row-gutters' is valid".

### Phase 2: Code Review — FAIL

**Gates I ran myself in WORKTREE_PATH, all under `nice -n 19`.** Load was 8.41 before the gates and 9.11 after.
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run check:e2e-types`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- `HELIO_JEST_MAX_WORKERS=2 npm test`: exit 0. Root: 55 suites / 485 tests. Frontend: 628 suites / 7502 tests. `jest --listTests` lists 628 paths, all under this worktree.
- The new RTL cases ran by name, from `--json` output for `.../HEL-1576/frontend/src/app/dashboardMeta/DashboardMetaRow.test.tsx`, and all passed:
  - "after a successful Tidy, keyboard focus moves to Undo"
  - "tier 2 / tier 3 with no dashboard selected: the assistant button is still rendered"
  - "tier 2: closing the share dialog returns focus to the kebab trigger"

**Full Playwright e2e (C5) on this head.**
- Command: `npx playwright test --workers=2`, run from WORKTREE_PATH under `flock -w 3600 …/scratchpad/e2e.lock` and `nice -n 19`.
- Environment: DEV_PORT=7008, BACKEND_PORT=9915.
- Database: the backend ran against `helio_hel1576`. I proved this by mapping the 9915 server's (pid 58266) Postgres client ports through `pg_stat_activity`: all 6 connections are to `helio_hel1576` and none to `helio`.
- Result: "Running 312 tests using 2 workers" ending in **"312 passed (15.4m)", EXIT=0**. Load was 6.01 at start and 5.31 at end.
- Log: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots3/e2e-full-eval3.log`

**hel909 (quarantined, HEL-963).** The file is in `testIgnore`, so I ran it through a scratch config that clears the quarantine only:
- Config: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots3/pw909.config.ts.txt`
- Log: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots3/e2e-hel909-unquarantined.log`
- All 4 tests ran, with paths under this worktree. In every test, the re-pointed steps passed: the desktop meta-row "Add panel", the phone kebab plus menuitem "Add panel", the picker becoming visible and the picker becoming hidden.
- All 4 then fail at the documented quarantine point, "placed panel `Untitled Panel` never visible", at lines 125, 199, 199 and 268. That is the pre-existing HEL-963 defect, not this change.
- Separately, I clicked the phone kebab live at 375: the menu items are ["Add panel", "Refine with AI"] and the picker opens.

**Checklist**
- Code quality and DESIGN [mechanical]: PASS.
- DRY, readability and type safety: PASS.
- Tests: meaningful, except that the new focus-after-Tidy test covers only the first-history-entry case (CR1).
- Dead code: PASS. The `container-type` lines are gone.
- Defect: **CR1**.

### Phase 3: UI Review — FAIL (CR1 is observable)

**Servers.** I started them with `start-servers.sh` and `DATABASE_URL=…/helio_hel1576`, and `assert-phase servers` printed PASS. I checked the page port was 7008 before each MCP action, and awaited `document.fonts.ready` before each measurement.

**Users.** Throwaway users only, in `helio_hel1576`:
- `hel1576-eval3-1792105697210@example.test`, with the ops and finance persona templates;
- `hel1576-eval3-empty-1792105730902@example.test`.

Nothing was written to `helio` or under matt@helio.dev.

**Breakpoint sweep, both themes** (Ops dashboard; context list at 400px):
- **1280:** meta row 824×48 at tier 1, with Edit layout and Share icon-only. Exactly 1 `.cmd-btn--primary`. No row overflow, no overlap between facts and actions, actions on one line, no unnamed buttons. Movable grid rendered.
- **820:** row 364×48 at tier 3. Facts read "3 panels"; the buttons are Add panel, the appearance editor and the kebab. No Edit layout, because the stack renders.
- **768 and 375:** command bar only, with no meta row and no horizontal overflow.
- **Muted text on surface:** rgb(170,164,156) on rgb(26,24,22) in dark; rgb(100,94,86) on rgb(253,252,250) in light.

Sweep data: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots3/breakpoint-sweep.json` and `breakpoint-sweep-light-phone.json`.

A note on the light theme at 768 and 375: the first sweep run hit `429`s because I sent requests too fast. I re-ran it after the rate window and it was clean. That is the second JSON file. Its screenshots replaced the 429-affected ones.

Screenshots: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots3/eval3-meta-{1280,820,768,375}-{dark,light}.png`, and `eval3-nodashboard-820-assistant.png` for CR1.

**Console.**
- No errors from the meta row.
- Pre-existing errors: the `502` on `/api/pipelines/:id/run-events` (SSE through the Vite proxy, as in cycles 1 and 2) and the pre-login `401` on `/me`.
- Warnings: ECharts "Can't get DOM width or height" warnings in the stack, and the same Redux selector-memo warning when the share dialog opens (`DashboardShareDialog`, not in this diff).

**Focus-after-Tidy probe.** I used a real-mouse Playwright script, not the shared MCP browser, at 1500px on the Finance dashboard. Its log is `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots3/tidy-focus-probe.txt`; it was run twice, with identical results:

```
after-drag-1                   active="Move Sample: Transactions panel"  undoDisabled=false tidyDisabled=false
after-tidy-with-prior-history  active=BODY                               undoDisabled=false tidyDisabled=true ("Nothing to tidy")
after-undo-all                 active=BODY                               undoDisabled=true
after-drag-2                   active="Undo layout change"   <- focus stolen from the drag handle
```

### Overall: FAIL

### Change Requests

1. **Focus after Tidy works only when Undo was disabled beforehand, and it leaves a stale flag that later steals focus.**
   - **Code:** `frontend/src/app/dashboardMeta/DashboardMetaEditTools.tsx:44-54`. The effect depends on `[canUndo]`, so it runs only when `canUndo` changes.
   - **First failure:** after any earlier undoable change (for example a drag), `canUndo` is already `true`. The effect never fires, and Tidy disables itself under focus, so focus drops to `<body>`. This is the exact case ui-decisions.md ("Focus after Tidy … so focus moves to Undo") promises to handle.
   - **Second failure:** `focusUndoNext.current` stays `true`. The next false→true change of `canUndo` then moves focus to Undo unprompted: undo everything, then drag a panel, and focus jumps from the panel's "Move … panel" handle to "Undo layout change".
   - Both are reproduced live; see the probe log above.
   - **Fix:** key the focus move on a per-tidy signal rather than on `canUndo`. For example, a `const [focusUndoRequest, setFocusUndoRequest] = useState(0)` that is incremented when `applyLayoutTidy` returns `true`, with `useEffect(() => { if (focusUndoRequest) undoRef/querySelector?.focus() }, [focusUndoRequest])`. A successful tidy always pushes a history entry, so Undo is enabled by the time the effect runs.
   - **Tests:** add an RTL case that makes an undoable change first (for example dispatch a layout-history push or a drag-stop) and then Tidies, asserting Undo has focus. Add a second case asserting that, after a Tidy has moved focus, a later history change does not move focus.
2. **The rewritten "Narrow content column" scenario contradicts the build.**
   - **Text:** `openspec/changes/dashboard-meta-row-gutters/specs/dashboard-meta-row/spec.md:61-63` says: "movable desktop grid renders and the row is about 640px wide (1280px window, context list at 400px) … Share and the assistant through the 'Dashboard actions' menu".
   - **Live, 1280px window with the list at 400:** the row is **824px**, at tier 1. Share is an icon-only button in the row and the assistant is in the row, not the menu. Screenshot: `eval3-meta-1280-light.png`.
   - **Why no configuration fits the scenario:** in view mode the kebab tier (row < 640, `useMetaRowTier.ts:11`) can never coincide with the movable grid, which needs a grid container of at least 768 (`panelGridConfig.breakpoints.sm`). At 1100px with the list at 400, the row is 644 and the stack renders.
   - **Fix:** restate the scenario to match what the build does at a width where the grid renders. For example: WHEN the movable grid renders and the row is about 824px wide (1280px window, list at 400px), THEN Edit layout and Share are icon-only with their accessible names, every action is on one line, and Add panel keeps its label. If you want to cover the kebab case at all, say it is reached only in edit mode on a narrow grid (threshold 790 with the +150 edit offset), or only alongside the stack. This is the spec delta that will be synced into `openspec/specs/`, so the wrong scenario would become canonical.

### Critical Path

This is the final cycle (CYCLE 3 = EXECUTION_CYCLES 3), so these are the remaining blockers and my recommendation:
1. **CR1** is a small, contained code fix (about 10 lines plus two RTL cases) in code that cycle 3 itself added, and there is still no red-first evidence for focus-after-Tidy. The defect is an accessibility nuisance, not data loss: C1 holds, and no layout is written.
2. **CR2** is a one-scenario text correction.

Everything else is verified green:
- all four cycle-2 code CRs, apart from CR4a's scenario;
- lint, format, typecheck, e2e types and build;
- jest: 485 root and 7502 frontend tests;
- full e2e: 312/312;
- the owner answers and C1–C5.

**Recommendation for the human:** either authorise one more short fix cycle for CR1 and CR2, or accept the change with CR1 filed as a follow-up and CR2 fixed during archive. Do not drop CR1 silently: the stale flag is a focus-steal regression introduced in cycle 3.

### Non-blocking Suggestions
- `e2e/hel516-palette-quick-create.spec.ts:345-347`: the rewritten comment is followed by the old one-line HEL-1576 comment, which now repeats it. Drop the second line.
- Cycle-2 suggestion still open: memoise `selectCanTidyLayout` if dashboards grow large.
