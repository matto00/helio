## Context

`ChartPanel.tsx` currently holds, in one file: pure data-option builders
(`buildDataOption`/`buildDataOptionCore`/`buildAggregateDataOption`/`withPointerCursor`),
the appearance+data+compact merge logic (the `useMemo` body), the HEL-566 theme-sync
state (`themeSyncTick` + rAF `useEffect`), and the HEL-572 click-wiring
(`handleChartClick`/`chartOnEvents`). See proposal.md for why this needs to split now.
The fragile part, per HEL-566's own final-gate finding: `resolveChartTheme()`'s live
`getComputedStyle` read is stale at both render time and same-commit child-effect
time; only a `requestAnimationFrame`-deferred read after paint observes the corrected
theme/accent tokens. `themeSyncTick` exists purely to force that one corrective
recompute. Moving this code must not change hook call order or `useMemo`/`useEffect`
dependency arrays.

## Goals / Non-Goals

**Goals:**
- Split by concern: pure option-assembly (no React) vs. hooks (React-coupled) vs.
  the component itself.
- Preserve behavior exactly, including hook order and every memo/effect dependency
  array, so the HEL-566 theme-sync fix and HEL-572 click wiring keep working
  identically.
- Split `ChartPanel.test.tsx` to mirror the same concerns; preserve every existing
  assertion in substance (moving files is fine, weakening assertions isn't).

**Non-Goals:**
- No behavior change of any kind — this is not the place to fix HEL-1178 or land
  HEL-1179's `prefersReducedMotion` consolidation.
- No pre-built HEL-588 (cross-filter) behavior. HEL-588 will consume
  `panelsSlice.interactionState`/`SelectionDescriptor` and likely add row-filtering
  upstream of the chart's data option — the seams below (`chartDataOptions.ts`
  taking already-resolved `rawRows`) leave room for that without building any of it
  now.
- No change to `ChartPanel`'s public export shape (name/props/default export) —
  zero import-site changes needed in `PanelCard.tsx`/`PanelFullscreenOverlay.tsx`.

## Decisions

**D1 — Two pure modules, not one, for option assembly.** `chartDataOptions.ts`
(`buildDataOption`/`buildDataOptionCore`/`buildAggregateDataOption`/
`withPointerCursor`, ~lines 91-267 of the current file) and `buildChartOption.ts`
(the appearance+data+compact merge — the guts of the current `useMemo`, ~lines
352-537, plus `defaultOption`/`COMPACT_AXIS_LABEL_FONT_SIZE`/
`COMPACT_GRID_INSET_PX`). Alternative considered: one combined ~400-line pure
module — rejected, since that lands exactly back at CONTRIBUTING's split
threshold instead of clearing it, and the two concerns (raw-data → partial option,
vs. appearance+data → final option) are genuinely separable: `buildChartOption`
already calls into `chartDataOptions.ts`'s exports as a black box.

**D2 — `buildChartOption` takes ONLY `resolveChartTheme()`'s output (`themeTokens`)
plus the real data/appearance/compact inputs — it never sees `theme`/
`accentColor`/`themeSyncTick` directly.** Those three values, and the
`resolveChartTheme()` call itself, stay entirely inside `useChartOption.ts`'s own
`useMemo` callback, exactly mirroring the current file's structure (the `void
theme; void accentColor; void themeSyncTick;` cache-buster lines move there
unchanged, immediately followed by `const themeTokens = resolveChartTheme();`,
called BEFORE `buildChartOption(...)` — preserving current recompute timing
exactly). **Revised per design-gate skeptic round 1 REFUTE (2026-09-25):** the
original draft of this decision threaded `theme`/`accentColor`/`themeSyncTick`
into `buildChartOption` as plain trailing parameters. That fails
`npm run lint`'s zero-warnings policy: `react-hooks/exhaustive-deps`'s
"unnecessary dependency" check (what the `void` lines satisfy) only inspects
actual React hook calls, never a plain function — so on a plain function these
three become unused trailing parameters, and `@typescript-eslint/no-unused-vars`
(default `args: "after-used"`, no `argsIgnorePattern` configured in
`eslint.config.cjs`) flags them. They're also simply unnecessary:
`buildChartOption`'s body never reads any of the three — only `themeTokens`. This
is also the more literally mechanical move, consistent with D3's own "direct,
mechanical move" rationale.

**D3 — `useChartOption.ts` hook owns: `useTheme()`, the `themeSyncTick`
`useState`+`useEffect` (rAF), and the `useMemo` wrapping `buildChartOption(...)`.**
This is a direct, mechanical move of the existing hook call sequence into a new
function — called from `ChartPanel` in the exact position the original hooks
occupied, so React's hook-order invariant (hooks called in the same order every
render, which only depends on call order within one component's render, not which
file the call lives in) is unaffected. The `useMemo` dependency array is copied
verbatim.

**D4 — `useChartClickHandler.ts` hook owns: `EChartsClickEventParams`, the
`handleChartClick` `useCallback`, and the `chartOnEvents` `useMemo`.** Same
mechanical-move rationale as D3. Returns `{ onEvents: chartOnEvents }` (or the
memoized object directly) for `ChartPanel` to pass to `ReactECharts`.

**D5 — `ChartPanel.tsx` keeps:** props interface, `wrapperRef`/
`useMeasuredChartHeight`/`effectiveCompact`/`measuredPieLegendOverlap` (layout
concerns, already using the existing `useChartCompact.ts` hook — untouched), calls
to `useChartOption`/`useChartClickHandler`, and the `<ReactECharts>` render. Compact
adjustments to the *option* (legend hide, grid inset, axis label font) stay inside
`buildChartOption.ts` (D1) since they mutate the `EChartsOption`, not the
component's own JSX — `effectiveCompact`/`measuredPieLegendOverlap` are passed in
as plain booleans, exactly as today's `useMemo` deps already treat them.

**D6 — Tests split by the same five concerns**, per proposal.md's file list, using
the existing `ChartPanel.click.test.tsx` (HEL-572) as the established precedent for
a concern-scoped file with its own `jest.mock(...)` + `renderChart` helper.
`renderChart`/`getOption`/`baseAppearance`/`baseChartConfig` — the full set of
`ChartPanel.test.tsx`'s module-level symbols declared outside any `describe`
block (confirmed by design-gate skeptic round 1: exactly these four, no others)
— move to a shared `chartPanelTestHelpers.tsx`. **Revised per design-gate
skeptic round 1 REFUTE:** the original draft of this decision named only
`renderChart`/`getOption`, omitting `baseAppearance`/`baseChartConfig` (current
file lines 198-212), which the skeptic confirmed via grep are referenced from
**all five** proposed destination test files — leaving them unmentioned would
have forced the executor to improvise a duplication/sharing call mid-split.
Each test file keeps its OWN `jest.mock("echarts-for-react/esm/core", ...)` /
`jest.mock("./echartsCore", ...)` calls — Jest's mock-hoisting
(`babel-plugin-jest-hoist`) only hoists `jest.mock()` calls within the file they're
written in, so moving them into the shared helper module would silently stop
mocking in every file that imports the helper instead of calling `jest.mock`
itself. Skeptic-confirmed: `echarts-for-react/esm/core` is ALSO globally mapped
via `frontend/jest.config.cjs`'s `moduleNameMapper` (so the per-file mock for
that one import is belt-and-suspenders, matching current behavior — harmless to
keep), but `./echartsCore` (a relative, app-owned module) has no global mapping
and genuinely requires the per-file `jest.mock` call. This is the one
non-obvious trap in this split — call it out explicitly in the executor's task
list.

## Risks / Trade-offs

- [Risk] A hook-boundary move accidentally reorders a `useEffect`/`useMemo`
  relative to another hook, or drops/adds a dependency, silently changing when the
  theme-sync recompute fires → Mitigation: D3/D4 are literal, mechanical moves
  (copy the hook + its exact dependency array into the new file, call the new
  hook from the exact call-site position the original hooks occupied); the
  evaluator/skeptic must live-verify the theme toggle in-place (no remount) per
  ticket constraints, and tasks.md includes a red-first mutation proof specifically
  targeting the moved theme-sync and click-wiring hooks.
- [Risk] Splitting test files drops or weakens an assertion in the process →
  Mitigation: tasks.md requires a before/after test-count report and an explicit
  list of any assertion text changed, with reason; a test edited to pass is treated
  as a defect symptom per the driver brief, not an acceptable refactor step.
- [Trade-off] Five smaller test files (plus the existing click file) means slightly
  more import/mock boilerplate than one large file — accepted, since
  `ChartPanel.click.test.tsx` already established this pattern for HEL-572 and it
  keeps each file's failure output scoped to one concern.

## Migration Plan

Pure code-motion; no data migration, no schema change, no feature flag. Land as one
PR; rollback is a plain revert if needed (no persisted state depends on the new file
boundaries).

## Planner Notes

Self-approved: exact module boundaries and file names (D1-D6) — CONTRIBUTING.md
directs "propose a split" without mandating specific seams, and the ticket
explicitly delegates seam choice to the implementer ("You choose the seams and
record them in design.md").
