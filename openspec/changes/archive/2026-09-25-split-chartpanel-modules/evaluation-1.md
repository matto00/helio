## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: e41d8212 (HEAD at review time — see `head_sha` on the emitted
verdict for the exact 40-char SHA). Diff base: `1c532e8d9f50b5e5bc6ee9de5c6c1b077ea56fa1`
(resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS

- All ticket ACs addressed: `ChartPanel.tsx` split into single-concern
  modules/hooks (`chartDataOptions.ts`, `buildChartOption.ts`,
  `useChartOption.ts`, `useChartClickHandler.ts`), `ChartPanel.test.tsx`
  split by concern into 4 new files + itself trimmed, `ChartPanel.click.test.tsx`
  (HEL-572) genuinely untouched (absent from the diff entirely — confirmed
  via `git diff --stat`). `npm run lint`/`typecheck` (via `tsc` inside the
  build)/`test` all pass, zero new warnings (see Phase 2).
- No AC reinterpreted. Design.md D1-D6 match the implemented file boundaries
  exactly, including the round-1-REFUTE-driven correction (D2:
  `buildChartOption` takes only `themeTokens`, never `theme`/`accentColor`/
  `themeSyncTick`) and the D6 correction (`baseAppearance`/`baseChartConfig`
  included in the shared test helper).
- All 15 tasks.md items are marked done and match what's actually in the
  diff (verified against the diff directly, not just tasks.md's own
  checkboxes).
- No scope creep: diff touches only the 11 source/test files proposal.md
  names, plus the OpenSpec change-dir artifacts. No HEL-1178 (empty
  `appearance.chart` → `{}`) or HEL-1179 (`prefersReducedMotion`
  consolidation) fix snuck in — both call sites (`appearanceToEChartsOption`
  branch in `buildChartOption.ts`, `prefersReducedMotion()` call) are
  unchanged verbatim moves. No HEL-588 (cross-filter) behavior pre-built.
- No regressions: full repo test suite (`npm test`, root) — 350 frontend
  suites / 3816 tests, 28 helio-mcp suites / 271 tests, all green. No
  backend files touched (migration ledger claim N/A, correctly untouched).
- No API/schema impact — correctly none, pure frontend structural refactor.
- Planning artifacts (design.md/tasks.md/files-modified.md) accurately
  reflect the final implementation, **with one exception** (see Change
  Requests / Non-blocking Suggestions below): files-modified.md's blanket
  claim that "every `describe`/`it` in every split file... was moved
  verbatim from the original file — only import paths changed" is not
  literally true for one file's leading doc-comment (see finding below);
  the code itself (every `it`/`expect` body) genuinely is byte-identical.
- `workflow-state.md`'s `CONSTRAINTS` is `[]` (no non-retired entries) —
  nothing additional to honor beyond the ticket's own constraints, all of
  which are addressed above.

### Phase 2: Code Review — PASS

**Gates (fresh run, this worktree, `EVALUATOR_CLEAN_WORKTREE=false` so no
clean-worktree re-run applies):**
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` (root) — 350+28 suites, 3816+271 tests, all pass. The
  6 ChartPanel-concern files run together in isolation
  (`npx jest --config jest.config.cjs <6 files>`) also independently
  reproduced: **6 suites, 64 tests, all pass** — matches files-modified.md's
  claimed post-split total exactly (14+13+8+13+6=54 split, +10 untouched
  click file = 64).
- `npm --prefix frontend run build` — clean; `ChartPanel-DoriXQI1.js` still
  its own lazy-loaded chunk (confirms the HEL-512 echarts code-split is
  intact post-split).
- Note (environmental, not a code defect): the repo's own documented
  `--testPathPatterns=<name>` filter (CLAUDE.md's example command) does not
  actually filter under this repo's jest 30 — `--listTests` with and without
  a pattern both return all 350 frontend suites. Pre-existing tooling quirk,
  unrelated to this diff; worked around by passing explicit file paths
  instead, which correctly filtered.

**Verbatim-move verification (the ticket's central ask), done by direct
diff against the pre-split file at the resolved base SHA, not by trusting
the executor's report:**
- Hook order/deps: `ChartPanel.tsx`'s call sequence
  (`useRef`→`useMeasuredChartHeight`→`useChartOption(...)`→
  `useChartClickHandler(...)`) exactly reproduces the original inline
  sequence (`useMeasuredChartHeight`→`useTheme`→`useState`→`useEffect`→
  `useMemo`→`useCallback`→`useMemo`), since each custom hook's internal
  call sequence is spliced in at the position its call site occupies.
  `useChartOption.ts`'s `useEffect` deps (`[theme, accentColor]`) and
  `useMemo` deps (11 entries, same order) are byte-identical to the
  original. `useChartClickHandler.ts`'s `useCallback` deps are
  byte-identical.
- `buildChartOption.ts`/`chartDataOptions.ts`: diffed function-by-function
  against the original file's inline code — bodies are byte-identical
  (only the call signature changed, per design.md D2, from closure capture
  to an explicit `BuildChartOptionParams` object including `themeTokens`).
  `resolveChartTheme()` is called inside `useChartOption.ts`'s `useMemo`,
  before `buildChartOption(...)`, exactly as D2 specifies.
- `chartPanelTestHelpers.tsx` exports exactly `renderChart`/`getOption`/
  `baseAppearance`/`baseChartConfig` — confirmed by reading the file — and
  every split test file (plus the pre-existing `ChartPanel.click.test.tsx`)
  imports from it rather than re-declaring.
- Every one of the 6 ChartPanel test files has its own
  `jest.mock("echarts-for-react/esm/core", ...)` and
  `jest.mock("./echartsCore", ...)` calls at file scope (grepped directly).
- Test-count claim verified independently: `grep -oE '\b(it|test)\('` on
  each file gives 14/13/8/13/6 = 54 (split) matching the 54 in the original
  file exactly, +10 (untouched click file) = 64, matching the executor's
  claim and the independent 6-file joint test run above.
- **Assertion-equivalence, block-by-block:** wrote a bracket-matched
  extractor and diffed all 14 `describe(...)` blocks' full bodies (code,
  not just titles) between the original file and the concatenated split
  files. All 14 titles present in both, no extra/missing. Every block's
  code (every `it`/`expect`) is byte-identical after normalizing one
  cosmetic difference (some original titles use a literal `—` JS
  string escape where the split versions use a literal em-dash character —
  same runtime string value, not a behavior or assertion change).
  **One genuine deviation found:** the multi-line doc-comment immediately
  preceding `describe("ChartPanel — measured compact from ResizeObserver
  (F-094/F-026)", ...)` in `ChartPanel.compact.test.tsx` was substantively
  rewritten, not moved verbatim — the original explains the F-094/F-026
  regression via "`MobilePanelStack.tsx` passes it unconditionally... which
  is how a normal panel-card-sized pie chart's legend collided with its own
  outer data labels (F-026, "Mobile Title Test" panel, HEL-248 Chart Config
  Eval)"; the new comment instead says "`MobilePanelStack.tsx` forwards
  `compact` unconditionally to every chart it renders... ECharts' canvas-
  rendered legend/axis chrome can't be reached by a CSS container query —
  it isn't DOM — so this is the JS-side equivalent." Same rough topic,
  different wording, drops the specific F-026/HEL-248 citation, adds a new
  CSS-container-query framing not in the original. The `describe` block's
  actual code is byte-identical (confirmed separately) — this is a
  comment-only change with zero runtime/behavioral/test effect, but it
  directly contradicts files-modified.md's explicit "every `describe`/`it`
  ... moved verbatim ... only import paths and file location changed"
  claim. See Non-blocking Suggestions.
- CONTRIBUTING.md file-size budgets: every touched file is well under the
  ~400-line propose-a-split threshold (`ChartPanel.tsx` 110,
  `buildChartOption.ts` 235, `chartDataOptions.ts` 203, `useChartOption.ts`
  113, `useChartClickHandler.ts` 85, `chartPanelTestHelpers.tsx` 42, test
  files 168-277) — the split actually achieves its stated CONTRIBUTING.md
  goal, not just nominally.
- No dead code, no unused imports (lint's zero-warnings policy would have
  caught these), no TODO/FIXME introduced.
- DRY/readable/modular/type-safe: straightforward mechanical extraction,
  no new abstractions, no `any`.

### Phase 3: UI Review — PASS

Triggered by `frontend/**` changes. Dev servers confirmed serving THIS
worktree (`readlink /proc/<pid>/cwd` for both the Vite PID on 6612 and the
backend PID on 9519 resolved to this worktree's path) before trusting them;
reused via `start-servers.sh`/`assert-phase.sh` (`PASS servers`).

- **Theme toggle in-grid, without navigating away:** on "Skeptic HEL-566
  theme test dashboard" (pre-existing dev-DB fixture), toggled dark→light
  via the command palette (Ctrl+K → "Switch to light theme"). Canvas DOM
  node identity captured before/after via `window.__chartCanvasRef ===
  document.querySelector('canvas')` — **unchanged (no remount)**.
  `document.documentElement`'s `data-theme` flipped to `light`, `--app-bg`
  read back as `#f4f2ed`. Hover-dispatched tooltip re-rendered with
  light-theme styling (white background, dark text) at the same data point
  it showed dark-theme styling at before the toggle — screenshots persisted
  (see below).
- **Theme toggle inside `PanelFullscreenOverlay`, same mount:** opened
  fullscreen, captured the fullscreen canvas's identity, toggled
  light→dark via the same command-palette action (no navigation) —
  identity again **unchanged**, `data-theme` flipped to `dark`, overlay
  visibly re-themed (dark background/text) in the persisted screenshot.
- **Click-to-Inspect (HEL-572):** on "Skeptic HEL-572 pie dashboard"
  (fullscreen), a synthetic click landed on the pie's "West" wedge and
  correctly opened the Inspect dialog: "Showing rows for region: West /
  revenue" with the correct row (`West`, `150`) in the data grid. A
  precursor click that missed the wedge correctly fell through to the
  panel's own "open settings" handler instead of Inspect — confirms the
  `componentType !== "series"` bail-out (design.md D2) still works
  post-split.
- No console errors attributable to this change in any of the above flows.
  One pre-existing `502` on `/api/pipelines/<id>/run-events` (an SSE
  subscription for a pipeline id that doesn't correspond to a live
  pipeline in this dev DB) appeared on initial page load — unrelated to
  `ChartPanel`/`ChartPanel`'s consumers, not touched by this diff, and
  consistent with this repo's documented dev-DB-residue hazard
  (MEMORY.md). Not treated as a defect of this change.
- Loading/empty states, breakpoints, and other entry points were not
  separately re-verified beyond the above — out of scope for a pure
  structural refactor with no visual/behavioral change, and DESIGN.md
  [judgment] visual calls are the skeptic's remit, not this gate's.

Screenshots (evidence, CON-160, persisted before being cited here):
- `hel1180-theme-toggle-dark-tooltip.png` — ref:
  `/home/matt/Development/helio/.concertino/runs/HEL-1180/evidence/.concertino/runs/HEL-1180/evidence/hel1180-theme-toggle-dark-tooltip.png`
- `hel1180-theme-toggle-light-tooltip.png` — ref:
  `/home/matt/Development/helio/.concertino/runs/HEL-1180/evidence/.concertino/runs/HEL-1180/evidence/hel1180-theme-toggle-light-tooltip.png`
- `hel1180-fullscreen-light.png` — ref:
  `/home/matt/Development/helio/.concertino/runs/HEL-1180/evidence/.concertino/runs/HEL-1180/evidence/hel1180-fullscreen-light.png`
- `hel1180-fullscreen-dark.png` — ref:
  `/home/matt/Development/helio/.concertino/runs/HEL-1180/evidence/.concertino/runs/HEL-1180/evidence/hel1180-fullscreen-dark.png`
- `hel1180-click-inspect-pie.png` — ref:
  `/home/matt/Development/helio/.concertino/runs/HEL-1180/evidence/.concertino/runs/HEL-1180/evidence/hel1180-click-inspect-pie.png`

(The executor's own evidence, `01`-`05` PNGs, was already present in
`.concertino/runs/HEL-1180/evidence/` at review time — this evaluator's
screenshots are independent, freshly captured evidence, not a copy of the
executor's.)

### Overall: PASS

### Non-blocking Suggestions

1. `openspec/changes/split-chartpanel-modules/files-modified.md` (and by
   extension tasks.md 4.3's "moved verbatim" framing) overstates what
   actually shipped for one file: the doc-comment above
   `ChartPanel.compact.test.tsx`'s `describe("ChartPanel — measured compact
   from ResizeObserver (F-094/F-026)", ...)` block was rewritten, not moved
   verbatim (original cites "F-026, 'Mobile Title Test' panel, HEL-248
   Chart Config Eval"; the new text drops that citation and substitutes a
   CSS-container-query rationale). Zero behavior/test impact — the code
   body is byte-identical — but worth either restoring the original wording
   for a genuinely byte-verbatim move, or correcting files-modified.md's
   claim before merge so the shipped record doesn't overstate literal
   verbatim-ness. Not blocking given the ticket's actual binding constraint
   ("assertions... preserved in substance") is about assertions, which this
   is not.
