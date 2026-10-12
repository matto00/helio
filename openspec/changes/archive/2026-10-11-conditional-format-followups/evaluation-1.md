## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `26ca8ba93a9557acc31fe954bedf3988ddac1c9a` (base `d6aef6c46cfd3fcd47ebddd5519497d0f58c562b`, resolved live with `resolve-review-base.sh`).
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1490/evidence/` (gate logs `eval1-*.txt`, screenshots `eval1-screens/`, Playwright snapshots and console logs `eval1-playwright-mcp/`).

### Phase 1: Spec Review — PASS
- AC5 (history rows rules): met. `historyRowRules` (D2/D3) feeds `TableRenderer.conditionalFormats` (D1). The Change-cell class plus a (0,4,3) history rule keeps the accent wash (D4). Metric Outputs and no-rules Outputs stay unstyled (jest).
- AC2 (metric unit and label >= 4.5:1): met. `--panel-secondary-text-mix` is 62% in light and 60% in dark, used in both selectors, and stays relative to currentColor. Measured in the running app (Phase 3).
- AC4 (single footer prop): met. `grep -rn saveDisabled frontend/src` finds nothing. `OutputEditorSheet` ORs all three triggers into `saveBlocked`. Mutation runs are recorded (`item4-mutation-*.txt`: rulesInvalid 4 fail, bincount 2 fail, refmarks 6 fail, footer 13 fail).
- AC6 (Select invalid state): met. The trigger joins both invalid selectors in `inputs.css`. Measured in both themes (Phase 3).
- Scope: items 1 and 3 untouched, no backend, schema or API change. No scope creep.
- Spec deltas match the implementation. Constraints: C1 red runs recorded (`item5-red` 6 failed, `item6-red` 2 failed, `item2-red` 4 failed) and no new eslint-disable (only mentions in the planning text). C2 is now satisfied by this evaluation's running-app measurements. C3 and C4 are covered under "Constraint conduct" below.
- tasks.md 2.1 and 5.1 are still unchecked. That work was explicitly given to the evaluator and is done below (see Non-blocking Suggestions).

### Phase 2: Code Review — PASS
Gates, my own fresh runs in WORKTREE_PATH (logs in the evidence dir):
- `npm run lint`: exit 0 (`eval1-lint.txt`)
- `npm run format:check`: exit 0 (`eval1-format.txt`)
- `npm run typecheck`: exit 0 (`eval1-typecheck.txt`)
- `npm test`: exit 0, 560 suites and 6146 tests passed, plus 48 suites and 454 tests in the second project (`eval1-jest.txt`)
- `npm --prefix frontend run build`: exit 0 (`eval1-build.txt`)
- Backend: not triggered (no `backend/**` change).

Code: tokens only, no magic colours. One path for rule evaluation, with no second evaluator (DRY). `historyRowRules` is pure and memoized in `OutputHistoryModal`. No `any` and no dead code. The footer fold changes no behaviour. The CSS guards read the stylesheet source, since jest maps CSS to a stub, and they fail when the rules are removed (red runs recorded). No [mechanical] CONTRIBUTING.md or DESIGN.md violation found.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` on 6922/9829 and passed `assert-phase.sh servers`. I used a throwaway user (`eval-hel1490-1791764972@example.test`, id `8fd1021c-eaf6-4ee1-8844-4ad8bea3edd1`), verified via `/api/auth/me` before any probe. Its tier was set to beta on that exact row, because history payloads are never stored for free tier.

Fixture: a static/dataset source (`name`, `duration_s`) with three Outputs:
- table: cell rule `gt 600 -> warning` and row rule `gt 250 -> error`
- collection: value = `duration_s`, rules `lt 50 -> error` and `gt 600 -> success "Slow ok"`
- metric: unit `sec`, label `Duration`

I ran it, then replaced rows so `gamma` changed 300->700 and `delta` was added, and ran it again. I also built a dashboard with a default metric panel, a custom-colour metric panel (`#1e3a5f` / `#ffd27f`) and a form panel with a required select field.

**AC2: metric unit and label contrast.** Measured from computed `color` composited over the ancestor background chain, i.e. against the actual `.panel-grid-card` background:

| theme | width | default panel bg | unit | label |
|---|---|---|---|---|
| light | 1440 | rgb(253,252,250) | 4.69:1 | 4.69:1 |
| light | 375 | rgb(253,252,250) | 4.69:1 | 4.69:1 |
| dark | 1440 | rgb(26,24,22) | 6.20:1 | 6.20:1 |
| dark | 375 | rgb(26,24,22) | 6.20:1 | 6.20:1 |

- Computed `--panel-secondary-text-mix` is 62% in light and 60% in dark.
- Hover and raised state: `.panel-grid-card:hover` (PanelGrid.css:52) changes only the border and shadow, never the background. The card surface is `var(--panel-surface-override, var(--app-surface))`, so the default surface is the only one in play.
- Custom panel text colour is followed. In dark, the unit computes to `color(srgb 1 0.8235 0.498 / 0.6)`, i.e. `#ffd27f` at 60%. In light, the panel's theme-adapted override `#181511` is followed at 62%.
- Screenshots: `eval1-screens/eval1-metric-{light,dark}-{1440,375}.png`.

**AC5: history modal.** Computed backgrounds were matched against token probes. Light and dark, at 1440 and 375, both Outputs:
- Table Output:
  - `gamma` (changed, row rule error, cell rule warning): Change cell = `--app-accent-surface` and reads "New or changed"; `duration_s` cell = `--app-warning-surface`; `name` cell = `--app-error-surface`.
  - `beta` (ruled, not changed): row wash error, cell warning.
  - `delta` (changed, not ruled): accent on every cell, as before.
  - `alpha` (neither): no wash.
- Collection Output:
  - only the `duration_s` cells are toned: 10 and 20 error ("Critical"), 900 and 700 success ("Slow ok").
  - `gamma`: Change cell accent, value cell success, `name` cell accent.
  - Non-value cells of unchanged rows are unstyled.
- Accessibility: each glyph has `title` = the label, and the sr-only text = the label ("Critical", "Warning", "Slow ok"). The SVG is `aria-hidden`. The glyphs have no visible text label, so WCAG 2.5.3 does not apply. The Change cell's visible text is its accessible text.
- At 375 the table scrolls horizontally inside the modal (document `scrollWidth` = 375, no page overflow).
- Screenshots: `eval1-screens/eval1-history-{table,coll}-{light,dark}-{1440,375}.png`.

**AC6: shared Select invalid state.** Reached through the real flow: the form panel's required select submitted empty sets `aria-invalid="true"`.
- light: border rgb(175,51,37) = `--app-error` (#af3325). Focus-visible (keyboard Tab/Shift+Tab) shadow `color(srgb 0.686 0.2 0.145 / 0.1) 0 0 0 3px` = `--app-error-surface` halo, not the accent ring.
- dark: border rgb(241,123,103) = `--app-error`. Focus-visible halo `color(srgb 0.945 0.482 0.404 / 0.14) 0 0 0 3px` = `--app-error-surface`.
- 375 (dark): invalid border rgb(241,123,103).
- Valid Select is unchanged:
  - After choosing an option, `aria-invalid` is removed. Light focus-visible keeps the pre-existing accent recipe, and the dark unfocused border is `rgba(242,239,233,0.09)` (`--app-border-subtle`).
  - By construction, the diff adds only `[aria-invalid="true"]`-qualified selectors.
- Screenshots: `eval1-screens/eval1-select-invalid-focused-{light,dark}-1440.png`, `eval1-select-invalid-dark-375.png`.

**Console.** Within this lane's origin (6922) there were no JS exceptions. The only errors were the expected pre-login 401s on `/api/auth/me` and pre-existing 404s on `/api/pipelines/:id/schedule` (no schedule set). The 6919 entries in the shared browser log belong to another lane.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- tasks.md 2.1 and 5.1 are unchecked. The executor should tick them and cite this report's measurements and `eval1-screens/`. The evaluator does not edit artifacts.
- The theme.css comment numbers differ slightly from the running app: dark "6.24:1" measured 6.20:1, and light "4.67:1" measured 4.69:1. Consider rewording to "measured >= 4.5:1 (see evaluation-1)" or using the running-app figures.
- For the owner, related to item 1 and out of scope here: on the custom-background metric panel in light theme, the unit and label measure 4.24:1 against the theme-adapted custom surface rgb(199,205,213). This is item 1 territory (custom-background contrast, escalation pending), not a regression. 62% only raises it compared with 60%.

### Constraint conduct (C3/C4)
- Dev-DB residue was deleted by exact id:
  - via API: dashboard `75d9f4e9-4244-4f59-86c8-c5930ecf307b` (and its 3 panels), pipeline `860d106f-e04b-4e55-804c-b4cebc87847c` (and its 3 Outputs and history), data source `336b5f30-f3c6-4a58-a600-48becd567627`
  - via SQL: two `pipeline_run_rate_window` rows for user `8fd1021c-...`, then the user row itself, matched on id + email
  - A post-check found 0 dashboards, pipelines, sources and Outputs for that owner.
- The owner account was never touched.
- Both servers I started (vite pid 974878 and npm 974863; sbt 974611 and 974222) were stopped by exact pid, after confirming their cwd was this worktree. Ports 6922 and 9829 are free afterwards.
- My Playwright files were moved from the main checkout's root and `.playwright-mcp/` into the evidence dir.
