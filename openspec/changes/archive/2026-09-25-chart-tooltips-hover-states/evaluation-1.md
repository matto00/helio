## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- Reviewed `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/echarts-chart-panel/spec.md`, and `premise-validation.md`
  (`.concertino/runs/HEL-566/evidence/premise-validation.md`). The premise-check
  scope-down is well-evidenced (file:line citations for what F-025/F-196/F-195
  already shipped) and the executor implemented exactly the five genuinely-missing
  gaps it identified — no more, no less.
- All 4 ticket ACs addressed explicitly, none reinterpreted:
  1. Tooltip shadow/radius/mono values + axis-trigger multi-series comparison —
     implemented (`extraCssText`, `textStyle.fontFamily: fontMono`,
     `applyAxisTriggerTooltip`).
  2. Values honor existing formatting — unchanged use of `formatChartNumber`
     (no new unit system invented, matching the premise-check's explicit
     correction).
  3. Tooltip/hover re-resolve on theme/accent change without remount —
     `accentColor` added to `ChartPanel`'s option `useMemo` deps (D5); verified
     both by a live browser check (see Phase 3) and a dedicated component test
     (`ChartPanel.test.tsx` task-3.2 test, spy-based, proves `resolveChartTheme()`
     is re-invoked on an accent-only change with no `theme` change).
  4. Hover emphasis subtle + `prefers-reduced-motion`-aware —
     `applyHoverEmphasis` sets `animation: false` on reduced motion rather than
     omitting emphasis, matching D4's stated rationale exactly.
- Tasks 1.1–4.3 all marked done in `tasks.md` and match what was implemented
  (verified against the diff, not just trusted).
- No scope creep: diff confined to `chartAppearance.ts`/`.test.ts` and
  `ChartPanel.tsx`/`.test.tsx`, matching design.md's stated Impact section
  exactly. `chartTypeOptions.ts` was deliberately left untouched (design.md
  settled emphasis inside `appearanceToEChartsOption`, not
  `chartTypeOptions.ts`) — consistent with the proposal's "if kept out of the
  base option builder" conditional language, not a contradiction.
- No regressions: full frontend test suite (3767 tests, 342 suites) passes
  green with no other files touched.
- No API/schema changes — correctly, this is a frontend-only, config-only
  change (no backend/schema impact, confirmed by the diff `--stat`).
- Planning artifacts (`design.md` D1–D5) match the implemented behavior
  precisely — verified token names, `extraCssText` shape, `axisPointer.type`
  per chart type, and the `--app-accent-strong` (not plain `--app-accent`)
  choice all line up with the code.
- `workflow-state.md`'s `CONSTRAINTS` is `[]` (none promoted this run) — no
  standing constraint to check beyond the Iron Laws.

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates (fresh run, `WORKTREE_PATH`, no `CLEAN_WORKTREE` this cycle):**
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` (targeted: `chartAppearance|chartTypeOptions|ChartPanel`) — 93/93
  passed.
- `npm test` (full suite) — 3767/3767 passed, 342/342 suites, no collateral
  regressions (notable since the executor's own handoff flagged a
  `prefersReducedMotion` guard bug that broke 62 unrelated tests on a
  first pass — verified fixed, see below).
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk-size
  warning, unrelated to this diff).

**CONTRIBUTING.md compliance:**
- No inline FQN violations (N/A — TypeScript, not Scala).
- File-size budget: `ChartPanel.tsx` is 484 lines (over the ~400-line
  "propose a split" trigger), but was already 458 lines pre-change — this
  diff added ~26 lines to an already-over-budget file rather than pushing it
  over the line itself. Informational-only per CONTRIBUTING.md; noted as a
  non-blocking suggestion below.
- Comments follow the hazard/contract/why convention (e.g. the D1–D5
  doc-comments in `chartAppearance.ts` cite the decision and state it inline,
  not just a bare `HEL-566` pointer).

**DESIGN.md compliance:**
- `--app-accent-strong` is confirmed as DESIGN.md's own documented `(hover)`
  token (color-purpose table, line 99) — the D5 choice is not an unexamined
  deviation.
- No hardcoded hex in component/TSX paths that read live tokens; the
  `FALLBACK_CHART_THEME` literal fallbacks are the pre-existing SSR/Jest-only
  pattern (same shape the other five tokens already used before this ticket),
  not a new violation.
- `--app-shadow-soft`/`--app-radius-md`/`--app-accent-strong` all verified to
  exist in `theme.css` (lines 60, 190/264, 224/294) for both themes.

**Design quality:**
- DRY: `toSeriesArray` is a deliberate small duplicate of
  `chartTypeOptions.ts`'s private `seriesArray` helper, with an explicit
  comment explaining why (avoids cross-module coupling for a 2-line helper) —
  a reasonable, documented call, not an oversight.
- Readable/modular: `applyAxisTriggerTooltip`/`applyHoverEmphasis` are small,
  single-purpose, well-named functions with doc comments citing the design
  decision they implement.
- Type safety: no new `any`; the one `as EChartsOption` cast in
  `applyHoverEmphasis` is narrowing a spread-built object back to the known
  option shape, consistent with the surrounding code's existing casts.
- No dead code, no leftover TODO/FIXME.
- No over-engineering: `prefersReducedMotion()` is a small, scoped helper;
  no premature shared-utility extraction (see spinoff note below).
- Tests are meaningful: `chartAppearance.test.ts` covers every branch of
  `applyAxisTriggerTooltip` (multi/single-series bar/line, pie, scatter) and
  `applyHoverEmphasis` (animated/reduced-motion), and
  `ChartPanel.test.tsx` proves the wiring end-to-end through the real
  component, including the accent-only-recompute proof via `jest.spyOn`.

**Bug-fix and spinoff claims, independently verified:**
- The `prefersReducedMotion()` jsdom-guard fix is real: confirmed
  `chartAppearance.ts`'s guard (`typeof window === "undefined" || typeof
  window.matchMedia !== "function"`) is byte-for-byte the same shape as
  `Toast.tsx`'s existing private `prefersReducedMotion` guard — not a
  post-hoc rationalization.
- Confirmed no ECharts click/event-handler wiring was added anywhere in the
  diff (`grep` for `onEvents`/`.on(`/`click`/`selectedMode` across
  `chartAppearance.ts`, `chartTypeOptions.ts`, `ChartPanel.tsx` — zero hits).
  HEL-572 (drill-down, next in queue) is not blocked.
- Spinoff candidate concurred as genuine, non-blocking follow-up (see below):
  `prefersReducedMotion` now has three near-identical private
  implementations (`chartAppearance.ts`, `Toast.tsx`,
  `useIsNarrowerThan.ts`'s own `matchMedia` guard). CONTRIBUTING.md's refactor
  discipline ("a structural change is not the place to also fix bugs, add
  features" / flag as spinoff) supports leaving this out of scope here.

### Phase 3: UI Review — PASS

Issues: none.

Dev servers reused (5998/5998 frontend, 8905 backend) — independently verified
serving THIS worktree before trusting them: `readlink /proc/<pid>/cwd` for both
the Vite (194683) and sbt/Pekko (194393) processes resolved to
`.../worktrees/feature/chart-tooltips-hover-states/HEL-566/{frontend,backend}`.

Built a fresh, independent verification fixture (not reusing the executor's own
claimed setup) via the live API: a two-series static data source (`year`/
`value`/`team`), a chart-kind Output (`chartType: bar`,
`fieldMapping: {xAxis: year, yAxis: value, series: team}`), and a dashboard
panel bound to it, appearance `chartType: bar`.

- **Happy path (dark theme, in-grid):** hovering the "2020" category shows an
  axis-trigger tooltip listing both series ("A": 10, "B": 30), a shaded
  `axisPointer` column under the cursor, and a visible orange
  (`--app-accent-strong`) border-highlight on the hovered bar. Computed styles
  read directly off the tooltip DOM node confirm `box-shadow` matches
  `--app-shadow-soft`, `border-radius: 9px` matches `--app-radius-md`, and
  `font-family` is `"JetBrains Mono", ...` — all exactly the theme tokens, not
  approximated.
  (`/home/matt/Development/helio/.concertino/runs/HEL-566/evidence/dark-in-grid-tooltip-hover-03.png`)
- **Light theme + Blue accent, in-grid:** switched theme and accent via
  Settings, re-opened the dashboard (same SPA session, no reload). Tooltip
  re-themed to a white surface with the light-theme shadow/border values;
  `--app-accent-strong` computed value updated to
  `color-mix(in srgb, #3b82f6 76%, black)` (blue-derived); hover-emphasis
  border on the bar rendered in the new blue accent. No remount glitches
  observed (chart re-rendered in place).
  (`/home/matt/Development/helio/.concertino/runs/HEL-566/evidence/light-blue-tooltip-hover-05.png`)
- **Light + Blue, inside `PanelFullscreenOverlay` (HEL-584):** opened
  fullscreen via the panel's Fullscreen button — confirmed `ChartPanel` reused
  unmodified in the modal (HEL-584's stated constraint): identical
  axis-trigger tooltip, mono values, and blue hover-emphasis border render
  correctly in the enlarged canvas.
  (`/home/matt/Development/helio/.concertino/runs/HEL-566/evidence/light-blue-fullscreen-tooltip-07.png`)
- **No-remount claim for accent-only change**: verified two ways — (a) the
  component test (`ChartPanel.test.tsx`, task 3.2) deterministically proves
  via `jest.spyOn(resolveChartTheme)` that an accent-only change re-invokes
  the theme read without a full remount; (b) live browser check above shows
  the accent-derived color taking effect on the next tooltip/emphasis render.
- **Unhappy/empty/loading states**: unaffected by this change (no new async
  states introduced) — pre-existing `PanelBodySkeleton`/loading behavior
  untouched, verified by the full regression suite passing.
- **Console**: no console errors attributable to the chart/tooltip/hover code
  during any tested flow. The only console errors seen were from my own
  manual fixture setup (a 403/400/405 while discovering the correct
  `POST /api/data-sources` shape, before I found the right payload) and a
  pre-existing, unrelated SSE reconnect 502 on `/pipelines/:id/run-events` —
  neither is new nor caused by this diff. Two "Can't get DOM width or height"
  ECharts warnings appeared during the fullscreen-close transition — a
  transient dimension-timing warning during modal animation, not new/blocking,
  and not `console.error`.
- **Entry points**: verified both in-grid and fullscreen-overlay entry points
  (the two the ticket's constraint calls out); table/metric/other Output kinds
  are unaffected (chart-only code path).
- **Accessible names/keyboard**: unchanged — no new interactive elements
  added (tooltip/hover are hover-only ECharts canvas rendering, not new
  focusable DOM); pre-existing panel toolbar buttons (Refresh, Fullscreen,
  actions) untouched.
- **Breakpoints**: 1440 / 1100 / 768 all render without layout breakage
  (`/home/matt/Development/helio/.concertino/runs/HEL-566/evidence/breakpoint-1440-10.png`,
  `breakpoint-1100-09.png`, `breakpoint-768-08.png`) — this is pre-existing
  `PanelGrid` responsive behavior, unaffected by the chart-internal change
  under review, and confirmed not broken by it.

**Cleanup**: deleted the dashboard/pipeline/data source created for this
verification (`DELETE` all returned 204) and restored the shared dev
account's theme/accent to their prior defaults (dark / Orange) before
finishing, per the shared-dev-DB hygiene concern (`MISTAKES.md`).

### Overall: PASS

### Non-blocking Suggestions

1. `frontend/src/features/panels/ui/ChartPanel.tsx` is 484 lines, over
   CONTRIBUTING.md's ~400-line "propose a split" soft-budget trigger — it was
   already at 458 lines before this ticket, so this is pre-existing technical
   debt this diff modestly added to, not something HEL-566 introduced or is
   obligated to fix. Worth a future decomposition pass (e.g. extracting the
   post-merge-pass chain — `applyChartTypeOptions`/`applyAxisTriggerTooltip`/
   `applyHoverEmphasis` — and the pie-legend-overlap measurement logic into a
   separate module) the next time this file is touched non-trivially.
2. Concur with the executor's spinoff candidate: `prefersReducedMotion()` is
   now duplicated three times (`chartAppearance.ts`, `Toast.tsx`,
   `useIsNarrowerThan.ts`'s own guard). A follow-up ticket to consolidate into
   one shared `useReducedMotion`/`prefersReducedMotion` utility (e.g. under
   `frontend/src/shared/` or `frontend/src/utils/`) would remove the
   duplication without touching this ticket's scope — genuine follow-up, not
   fold-in material per CONTRIBUTING.md's refactor-discipline guidance.
