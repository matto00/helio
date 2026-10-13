## Standing Constraints

- [C1] Never delete or loosen an existing e2e assertion: hel1398's "annotation stays visible" check for the control-bar case is replaced, for controls=true at w=2 only, by "hidden but in the accessibility tree" citing D3.
- [C2] The value-axis min/max promise is tested explicitly (unit + e2e), not assumed from hideOverlap; the PR's OWNER REVIEW section carries before/after card screenshots (light/dark) for D2/D3.

## 1. Tests (red first)

- [x] 1.1 Add e2e/hel1444-footnoted-chart-canvas.spec.ts (multi-line annotation) measuring the floor matrix, one-control inline labels, two-control and lone numeric-range bar height vs main at w=2/w=4, w=2 hidden annotation, h=5 unchanged, title tooltip, footer containment; save the red run to evidence
- [x] 1.2 Probe the y-axis overprint at the measured short heights (systematic-debugging) and record the root cause in evidence
- [x] 1.3 Add red unit tests: value-axis cap by measured height incl. a >=180px case proving the option is unchanged, for bar and histogram/time charts; PanelCardHeader title + accessible name

## 2. Frontend

- [x] 2.1 D1: move footnote one-line compaction to the height-only container query in PanelContent.css; verify w4/w6 floors in 1.1
- [x] 2.2 D2: inline a lone text/dropdown control's label on short footnoted chart cards (range controls excluded); verify geometry and two-control height in 1.1
- [x] 2.3 D3: visually hide the annotation on w=2 short footnoted chart cards with a control bar; verify a11y presence in 1.1
- [x] 2.4 D4: cap value-axis labels by measured canvas height; verify 1.3 unit tests and the unchanged-path snapshot
- [x] 2.5 D5: add title={panel.title} to the desktop card h3; verify 1.3
- [x] 2.6 D6: rewrap PanelContent.css comment lines over 100 chars; verify with an awk length check

## 3. Tests

- [x] 3.1 Run e2e hel1444, hel1398, hel1305, hel1306, hel1311, hel1508, hel1512 green; save screenshots light/dark at 1440 and 375
- [x] 3.2 Run npm test, lint, typecheck, format:check green
