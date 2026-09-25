## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Spawn-cwd guard:** `pwd -P` → `/home/matt/Development/helio`;
`scripts/concertino/assert-cwd.sh` → `READY ambient=/home/matt/Development/helio
branch=feature/chart-tooltips-hover-states/HEL-566`. Proceeded normally.

**Premise-validation claims re-checked directly against the live worktree (not
trusted from the artifact):**
- `frontend/src/utils/chartAppearance.ts:88-143` (`appearanceToEChartsOption`)
  — confirmed `tooltip.backgroundColor`/`borderColor`/`borderWidth`/
  `textStyle.color`/`textStyle.fontFamily: fontSans`/`valueFormatter:
  formatChartNumber` already exist (F-025/F-196 land). Confirmed axis labels
  already use `fontMono` (lines 121, 131) but `tooltip.textStyle.fontFamily`
  is `fontSans` (line 110) — the mono-value gap is real.
  `resolveChartTheme()` (lines 44-55) is the single existing theme-token
  helper, reading five tokens live via `getComputedStyle`.
- `grep -n "trigger|axisPointer|emphasis"` across `chartAppearance.ts`,
  `chartTypeOptions.ts`, `ChartPanel.tsx` → zero hits. Confirms no
  trigger/axisPointer/emphasis config exists anywhere today.
- `frontend/src/theme/theme.css:60` (`--app-radius-md: 9px`) and `:224,294`
  (`--app-shadow-soft`, per-theme) — both tokens exist and are unread by
  `chartAppearance.ts`.
- `ChartPanel.tsx:272` — `const { theme } = useTheme();` — confirmed
  `accentColor` is not destructured or in the option `useMemo`'s dependency
  array (lines 428-438 list `theme` but not `accentColor`).
  `ThemeProvider.tsx:25,52-96` confirms `accentColor` is a real, separate
  field `useTheme()` exposes.
- `frontend/src/theme/motionTokenGuard.css.test.ts:26-37` (`allCssFiles`) —
  confirmed it walks only `*.css` files by extension; it cannot and does not
  cover JS-side ECharts `emphasis`/animation config, supporting D4's claim
  that reduced-motion handling for hover emphasis needs its own
  `matchMedia` read.
- `ChartPanel.tsx` — no `onEvents`/`.on(`/`selectedMode` anywhere. Confirms
  D4's claim that this change adds no click-handler surface that would
  collide with HEL-572.
- Conclusion: every claim in `premise-validation.md` and the "Already
  done"/"Genuinely missing" split in `design.md`'s Context section holds up
  against the live tree, not just the artifact's own narrative.

**Design soundness review (proposal.md, design.md, tasks.md,
specs/echarts-chart-panel/spec.md):**
- No placeholders/TODOs/TBDs found in any artifact.
- No new unit/label-format system is introduced; `formatChartNumber` reuse
  is explicit and matches the code (`chartAppearance.ts:61-71`).
- No ECharts click/event-handler wiring is added (verified above) — HEL-572
  is not blocked.
- Found two concrete issues below.

### Verdict: REFUTE

### Change Requests

1. **Internal contradiction: design.md D3 / tasks.md 2.2 silently widen scope
   beyond the ticket AC and the spec delta's own Requirement 2 text.**
   - `openspec/changes/chart-tooltips-hover-states/ticket.md:12,18` and
     premise-validation.md both frame the axis-trigger tooltip as
     "multi-series comparison on shared-x charts" / "multi-series charts show
     an axis tooltip comparing series at the hovered x."
   - `specs/echarts-chart-panel/spec.md:18-22` (ADDED Requirement 2) codifies
     this literally: "Bar and line charts **with more than one series**
     sharing a category x-axis SHALL show an axis-trigger tooltip" — the
     requirement is explicitly gated on series count.
   - But `design.md:63-65` (D3) explicitly overrides this: "Single-series
     bar/line charts also get axis-trigger (harmless... avoids adding a
     second series-count-dependent branch to test/reason about)," and
     `tasks.md:16-18` (task 2.2) implements exactly that — a per-`chartType`
     branch with **no series-count condition at all** ("axis+shadow for bar,
     axis+line for line, item for pie/scatter, unchanged").
   - This is a real conflict between what the spec delta says will happen and
     what the design/tasks will actually build, and it is also unrequested
     scope beyond the ticket's stated AC (single-series bar/line tooltip
     behavior is changing even though nothing in ticket.md asked for that).
     Pick one and make the artifacts agree:
     - (a) Restrict D3/task 2.2 to only apply `trigger: "axis"` when
       `series.length > 1`, matching the ticket/spec text exactly as
       written, or
     - (b) Explicitly broaden `specs/echarts-chart-panel/spec.md` Requirement
       2's text (and its scenario) to state axis-trigger applies to every
       bar/line chart regardless of series count, with a stated rationale,
       so the spec delta isn't silently narrower than what tasks.md will
       actually ship.
   - Either is fine; leaving the contradiction as-is is not — the evaluator's
     spec-conformance check and the skeptic's final-gate AC trace will each
     have to guess which document is authoritative.

2. **D5's accent-token choice diverges from DESIGN.md's own token-purpose
   table without acknowledging it.**
   - `design.md:81-87` (D5) plans: "extend `ChartThemeTokens` with `accent:
     string` (read via the same `resolveChartTheme()` pattern)" reading
     `--app-accent` directly for the hover-emphasis highlight color.
   - `DESIGN.md`'s own canonical color table (§3, "Color (themed; tokens are
     `--app-*`)") names the token purposes explicitly: `--app-accent-strong`
     is documented as `(hover)`; `--app-accent-mid` is documented as
     `(selection borders)`. Plain `--app-accent` is not the row the table
     assigns to hover states.
   - This isn't theoretical: `grep -rl "app-accent-strong" frontend/src` hits
     ~20 files (`PanelGrid.css`, `PipelineDetailPage.css`,
     `MessageComposer.css`, `auth.css`, etc.), the established convention for
     `:hover` states site-wide.
   - Using bare `--app-accent` for the chart hover emphasis is a deviation
     from that established, documented convention, made without a stated
     reason in design.md (D5 just calls `--app-accent` "the natural choice").
     Either change D5 to read `--app-accent-strong` (matching the
     documented hover-purpose token and the site-wide convention), or, if
     there's a real reason chart emphasis should use the base accent instead
     (e.g. a contrast measurement, mirroring the `--app-accent-strong`→
     `--app-focus-ring-color` repoint noted at `PanelGrid.css:256-264` for a
     different reason), state that reason explicitly in design.md so it
     reads as a deliberate decision rather than an unexamined default.

### Non-blocking notes

- `proposal.md:27` hedges "`chartTypeOptions.ts` (per-chart-type emphasis, if
  kept out of the base option builder)" while `design.md` D4 commits emphasis
  to `appearanceToEChartsOption` unconditionally. Not a contradiction (the
  proposal explicitly flags it as conditional), but worth tightening once
  Change Request 1 is resolved, since the same file may need a series-count
  branch depending on which resolution is chosen.
- Risks/Trade-offs section in design.md already flags the axis-trigger
  single-series content-shape change as something "evaluator/skeptic to
  visually confirm... reads as 'richer,' not 'noisier'" — that's a good
  instinct, but the risk section describes it as if it were already an
  accepted decision rather than the unresolved spec/design conflict in CR1
  above.
