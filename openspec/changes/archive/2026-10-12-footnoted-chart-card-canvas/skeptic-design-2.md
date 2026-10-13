## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD a369a9cb84a0966adb3c8c9d515838ebfbf6bb15 (the planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Spawn cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/footnoted-chart-card-canvas/HEL-1444`.
- **Round-1 CR3 is fixed.** `openspec validate footnoted-chart-card-canvas --strict` now prints
  "Change 'footnoted-chart-card-canvas' is valid". tasks.md uses `## 1/2/3` groups and has no empty heading.
- **Round-1 CR1 is fixed in principle.** D2 is now scoped to `.output-viewer-control-bar:has(> :only-child)`.
  `OutputViewerControlBar.tsx` renders exactly one `OutputViewerControl` child per non-orphaned control inside
  the bar div, and returns null when there are none, so `:only-child` means "exactly one visible control". The
  spec has a new "a multi-control bar is never taller than today" scenario, and task 1.1 has a matching e2e
  assertion at w=2 and w=4.
- **Round-1 CR2 is mostly fixed.** D2's selector is now
  `.panel-grid-card:has(.chart-panel__annotation, .chart-panel__truncation-note)`, which is the same scope as
  HEL-1398 (`PanelContent.css:479,490`). It agrees with the spec's "a chart with no footnote keeps its control
  labels above their inputs". The loading/error-state sub-question is still not stated (see CR 2).
- **The round-1 non-blocking notes were taken.** The label-markup wording is corrected and matches
  `OutputViewerControlBar.tsx`: text uses `<label htmlFor>`, dropdown uses a span plus `ariaLabel`, and range
  uses a span plus sr-only labels. D3 is now narrow-only (w=2), and wide hiding is offered as the owner's
  alternative. Slack is stated honestly: 85.2 vs 84, and ~50 vs 48. The e2e annotation is now multi-line. Unit
  tests now include a >=180px case, and the overprint tests include a histogram or time-axis chart.
- **Mobile isolation holds.** `.panel-grid-card` is `container-type: size` (PanelGrid.css:28-30). The mobile
  `--output` item overrides this to `inline-size` (MobilePanelStack.css:78-82), so a height-only
  `@container panel-card (max-height: 260px)` cannot match the phone stack. `MobilePanelStack.tsx:173` renders
  its own h3, not `PanelCardHeader`, so D5 leaves the mobile title untouched, as claimed.
- **D1 and D5 code claims hold.** The footnote base rule is at `PanelContent.css:205-221` (padding 4/12/8,
  line-height 1.4, 2-line clamp). The HEL-1398 width+height block is at L450-496. The third footnote shares the
  `chart-panel__truncation-note` class (`ChartRenderer.tsx:109,150`, skipped or time note). The desktop title is
  at `PanelCardHeader.tsx:85` with no `title` attribute. The awk check finds >100-char lines at
  44, 46, 431, 438-440, 448, 449, 477 and 493, matching D6.
- **D4 code claims hold.** `hideOverlap` appears only at `buildChartOption.ts:228` (time axis) and
  `heatmapHistogramOptions.ts:27`. There is no `splitNumber` anywhere. `useMeasuredChartHeight` exists
  (`useChartCompact.ts`, `ChartPanel.tsx`), and so does `chartUnchangedPath.main.snapshot.json`. All six
  regression e2e specs named in the design exist under `e2e/`.
- **Floor arithmetic, recomputed from the CSS and the ticket's repro table.** For w4/6 with a bar, D1+D2:
  25.4 + 21 + 12 + 8 = 66.4 (floor 60), and with three footnotes 0.6 + 21 + 12 + 8 + 8 = 49.6 (floor 48). For w2
  with a bar, D2+D3: 33 + 21 + 16.8 = 70.8, and with three footnotes 54. For w4/6 with no bar, D1: 94.4 + 20 =
  114.4, and with three footnotes 97.6. For w2 with no bar and three footnotes, the canvas stays at 85.2
  (floor 84). The floors are consistent with the design. Two cases have thin slack (1.2px and 1.6px), and the
  design discloses both, with an escalate-don't-loosen rule.

### Verdict: REFUTE

### Change Requests

1. **D2 contradicts the spec on one-control range bars.** The spec SHALL says that for "a viewer-control bar
   with exactly ONE control, that control's label SHALL sit beside its input on one row". It applies the 60/48px
   floors to every "one-control bar". design.md D2 says instead: "Range controls (two inputs) may still wrap the
   bar onto two rows; floors in specs are stated for a one-control bar". But a lone numeric-range or date-range
   control *is* a one-control bar, because it matches `:only-child`.

   At w=2 (~174px content), a numeric range inline is label + 8 + 80 + 8 + 80 (`OutputViewerControlBar.css`
   number input 80px, range gap `--space-2`). That is >174px, so it cannot sit on one row. A date-range in
   `custom` mode adds two 140px date inputs and overflows at w=4 too. As written, either reading fails a
   gate:
   - the executor follows the design, and a range bar breaks the spec's SHALL; or
   - the executor follows the spec, and the result is unachievable at w=2.

   Revise so that the design, the spec and the task agree. One way: state in the spec that the one-row and
   floor guarantees apply to a single text, dropdown or preset-mode date-range control. Then say what a lone
   range control does: keep its stacked layout (exclude `--range` from the inline selector), or wrap, with the
   bar no taller than on main. Add that case to task 1.1's e2e matrix (a lone numeric-range bar at w=2: bar
   height <= main, nothing overlaps).
2. **Answer round-1 CR2's open sub-question in design.md.** D2/D1 key off the footnote elements, which exist
   only once the chart has rendered. So a short footnoted chart card's bar is stacked while the panel is in
   loading or error state (`.panel-content--state`), then jumps to inline (~21px) when data arrives. A refetch
   that toggles truncation can flip it again. State whether this layout shift is accepted, which is likely fine
   and reversible, or how it is avoided. One sentence is enough. Round 1 asked for this explicitly, and it is
   still unaddressed.

### Non-blocking notes

- **The value-axis requirement and its scenario don't match.** The requirement promises "at least the axis
  minimum and maximum when two labels fit". The scenario only checks "at least one value-axis label is drawn".
  Either add a two-label assertion at the ~60px+ canvases, or drop the min/max promise. Otherwise the final gate
  cannot verify the requirement as written.
- **D2's `min-width: 0` will not shrink the text control on its own.** `.output-viewer-control-bar__text-input`
  has a fixed `width: 160px`, and label + 160 > 174 at w=2. The executor will also need a flex-basis/width
  override on the input inside the inline form. The e2e geometry check will catch this, but flag it so it isn't
  rediscovered.
- **Thin slack.** w2 with three footnotes and no bar has 1.2px (unchanged by this work), and w4/6 with three
  footnotes and a bar has 1.6px. Sub-pixel font metrics at 1900 could flip either one. The escalate-don't-loosen
  rule in the Planner Notes is the right safeguard.
- **The public viewer renders `OutputViewerControlBar` outside any `.panel-grid-card`**
  (`PublicDashboardViewerPage.tsx:106`), so D2/D3 cannot affect it. This is correct, just worth knowing for
  the final gate.
