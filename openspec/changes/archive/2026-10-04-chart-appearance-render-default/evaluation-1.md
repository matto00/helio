## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 71cec027fbd75fa2f9d56e23ffb55ae90b1245cd

### Phase 1: Spec Review — PASS
- AC1 (chart-less renders same themed tooltip/axes/hover as explicit default, both themes): met; verified live (below).
- AC2 (red-first test): ChartPanel.defaultAppearance.test.tsx; red-first-2.1.txt shows 4 of 5 failing on unmodified code (single-series tooltip.show undefined; equality tests dark/light/undefined-appearance). Output is a real assertion failure, not an import/compile error.
- AC3 (no change for stored chart, tooltip.enabled:false hides tooltip): guard test present; mutation-2.3.txt shows the guard + undefined-appearance test failing under mutation (2 failed / 3 passed). Live: tooltip-disabled panel shows no tooltip.
- D3 parity: backend ChartAppearance.Default (model.scala:225-238) vs frontend defaultChartAppearance (appearance.ts:19-37) compared by me field by field: seriesColors (8 identical hexes), legend show/top, tooltip enabled, axisLabels x/y show:true label "" (backend Some("")), chartType line. Equal.
- Scope: diff is one source file + one test file + planning artifacts. No backend/schema change. Tasks 1.1-2.4 all done.
- CONSTRAINTS: empty; nothing to honor.
- Premise re-verified live: a panel created with the Add-panel payload (POST /api/panels, type output, config.outputId) came back with appearance {background, color, transparency} and NO `chart` key.

### Phase 2: Code Review — PASS
My own gate runs in the worktree (nice -n 19, jest --maxWorkers=2): npm run lint clean (max-warnings=0); format:check clean; npm --prefix frontend run typecheck clean; npm --prefix frontend run build succeeds; frontend jest 416 suites / 4331 tests passed (PanelCard flake did not occur). Matches gates-2.4.txt (4331 passed). No backend files changed so sbt not run.
- buildChartOption.ts: minimal one-expression change, unused ChartType import correctly removed, comment explains why. No dead code.
- Tests meaningful: equality test compares full option objects under light and dark tokens; ChartPanel-level test asserts themed tooltip fields; guard test for enabled:false.
- Evidence files verified by reading: red-first (genuine red), mutation (guard fails under mutation), gates (green). Mutation file does not state the mutation applied in prose; non-blocking.

### Phase 3: UI Review — PASS
Own headless Chromium context (own cookie jar; the shared MCP browser held another lane's session), against worktree ports 6610/9517, themes dark and light. Scratch dashboard with panels A (chart-less), B (PATCHed with full default chart appearance, replace semantics), C bar/pie/scatter (stored chart), D (stored chart, tooltip.enabled false).
- Canvas md5 of the rendered chart: A == B == D (dark: c969c3daa2; light: 3923b2036a) -> pixel-identical, gridlines/fonts/line identical.
- Hover tooltip, A vs B: identical computed style in both themes (dark bg rgb(38,35,32), text rgb(242,239,233), JetBrains Mono, radius 9px, soft shadow; light white bg, border rgba(33,29,25,..)) and identical content ("total / east / 10918"). Light screenshot ui-light-hover-A.png shows the themed card.
- D (tooltip.enabled:false): no tooltip rendered in either theme.
- bar and pie with stored chart: themed tooltip as before; scatter hover did not trigger a tooltip in my automated hover (point-hit miss), render is normal; scatter is a stored-chart path untouched by the change (the new code only affects the absent-chart branch).
- Console: only the 401s from the pre-login /auth/me probe; one transient 429 from my repeated logins (rate limit), not app errors.
- Evidence saved in the change dir: ui-dark-all.png, ui-light-all.png, ui-{dark,light}-hover-{A,B,notip,bar,pie,scatter}.png.
- Breakpoint resize (1100/768/0) not exercised: change does not touch layout.
- Cleanup: all 6 panels and the dashboard deleted by exact id (all 204; dashboard list no longer contains it); scratch scripts and cookie jar removed.

### Overall: PASS

### Non-blocking Suggestions
- Observation for the skeptic/driver (judgment, not mechanical): in the dark theme the axis tick labels on both A and B render very low-contrast (dark text on dark card; panel appearance.color is "inherit" and flows into axisLabel/textStyle). This is identical on A and B, so the AC (chart-less == explicitly-defaulted) holds, but chart-less panels on main (option {}) used ECharts' default grey labels, so newly-themed chart-less panels may be less legible in dark than before. I could not run main side-by-side. Worth a separate ticket if confirmed (it equally affects any stored-chart panel today).
- mutation-2.3.txt could record the exact mutation applied.
- The third test ("appearance itself is undefined") builds its explicit side with `color: undefined as unknown as string`, a cast to satisfy the type; acceptable but slightly awkward.
