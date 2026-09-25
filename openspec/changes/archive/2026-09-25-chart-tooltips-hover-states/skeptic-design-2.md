## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Spawn-cwd guard:** `pwd -P` → `/home/matt/Development/helio`;
`scripts/concertino/assert-cwd.sh` → `READY ambient=/home/matt/Development/helio
branch=feature/chart-tooltips-hover-states/HEL-566`. Proceeded normally.

**CR1 (axis-trigger scope contradiction) — verified resolved, not just reworded:**
- `specs/echarts-chart-panel/spec.md:18-23` (Requirement 2) now reads "Bar and
  line charts with more than one series ... SHALL show an axis-trigger
  tooltip. Bar and line charts with exactly one series, and pie and scatter
  charts ... SHALL keep an item-trigger tooltip (unchanged)," with its scenario
  at :31-35 explicitly covering the single-series-bar/line case.
- `design.md:58-68` (D3) now states the condition explicitly: axis-trigger
  "for bar/line WITH MORE THAN ONE SERIES, unchanged `item` for ... single-series
  bar/line," citing "resolution (a)" and `series.length > 1` by name, and the
  Risks/Trade-offs entry at :112-116 was rewritten to describe the
  series-count gating as the (now consistent) chosen behavior rather than an
  unresolved conflict.
- `tasks.md:16-21` (task 2.2) now says "ONLY when the chart has more than one
  series (item-trigger otherwise, matching the ticket AC and spec Requirement
  2 exactly)" and lists unit-test coverage for both single- and multi-series
  bar/line plus pie/scatter.
- `ticket.md:12,18` (AC, unchanged) already said "multi-series comparison on
  shared-x charts" / "multi-series charts show an axis tooltip" — all four
  documents (ticket AC, spec Requirement 2, design D3, tasks 2.2) now state
  the identical `series.length > 1` gate. No contradiction remains.

**CR2 (accent token choice) — verified resolved, not just reworded:**
- `design.md:91-101` (D5) now reads `--app-accent-strong` (not plain
  `--app-accent`) for the hover-emphasis color, explicitly citing "design-gate
  skeptic round 1 CR2" and DESIGN.md's `(hover)` token-purpose row as the
  reason.
- `tasks.md:3-6` (task 1.1) and `tasks.md:25-29` (task 3.1) both now name
  `accentStrong`/`--app-accent-strong` and explicitly say "not plain
  `--app-accent`."
- `proposal.md:11` was also updated to cite `--app-accent-strong` (DESIGN.md's
  documented `(hover)` token) as the rationale for the `accentColor` dep-array
  addition.
- `grep -n "app-accent\b" design.md tasks.md proposal.md specs/.../spec.md
  ticket.md` → zero hits for bare `--app-accent`; every remaining mention
  across all five artifacts is `--app-accent-strong` or `accentColor` (the
  live-theme hook value, a different thing). No stale reference to the old
  token survives anywhere in the change dir.
- Cross-checked the underlying premise directly: `DESIGN.md:99` — "Accent
  (user-set) | `--app-accent`, `--app-accent-ink`, `--app-accent-strong`
  (hover), `--app-accent-surface`/`--app-accent-dim` (selection washes),
  `--app-accent-mid` (selection borders)" — confirms `--app-accent-strong` is
  in fact the documented `(hover)` token, not an invented justification.

**`openspec validate chart-tooltips-hover-states --type change`** → `Change
'chart-tooltips-hover-states' is valid` (exit 0).

**Re-checked the rest of the design against the live tree (not just the
artifacts' own narrative), since no code changed between rounds and the
"Already done" / "Genuinely missing" claims needed to still hold:**
- `frontend/src/utils/chartAppearance.ts:44-131` — confirmed
  `resolveChartTheme()` reads exactly the five tokens claimed, tooltip
  `backgroundColor`/`borderColor`/`borderWidth`/`textStyle`/`valueFormatter`
  already exist, axis labels are `fontMono` but `tooltip.textStyle.fontFamily`
  is still `fontSans` — the mono-value gap D2 targets is real.
- `frontend/src/theme/theme.css:60,224,294` — `--app-radius-md: 9px` and
  `--app-shadow-soft` (both themes) exist and are unread by
  `chartAppearance.ts`, matching D1's premise.
- `frontend/src/features/panels/ui/ChartPanel.tsx:272,428-438` — `theme` is
  destructured and is a `useMemo` dependency; `accentColor` is neither
  destructured nor in the dependency array — confirms the gap D5/task 3.2
  targets is real.
- `ChartPanel.tsx:372` — `built = applyChartTypeOptions(built, chartType,
  chartOptions)` confirms the "post-merge pass" pattern D3 cites as precedent
  for where axis-trigger fields would be set.
- `grep -ni "TODO\|TBD\|figure out later\|TKTK"` across all five artifacts →
  no hits.
- `git status --short` → only the untracked `openspec/changes/...` dir; no
  code files were touched this round (expected — design gate, pre-execution).

### Verdict: CONFIRM

Both round-1 change requests are genuinely resolved (not reworded around):
the axis-trigger scope is now `series.length > 1` identically across
ticket.md AC, the spec delta's Requirement 2 text and scenarios, design.md D3,
and tasks.md 2.2; the hover-emphasis color is now `--app-accent-strong`
identically across design.md D5, tasks.md 1.1/3.1, and proposal.md, matching
DESIGN.md's own documented `(hover)` token. The artifacts are internally
consistent with each other and with the live code they describe. No new
placeholders, contradictions, or scope drift were introduced by the revision.
`openspec validate` passes.

### Non-blocking notes

- None beyond what round 1 already closed out.
