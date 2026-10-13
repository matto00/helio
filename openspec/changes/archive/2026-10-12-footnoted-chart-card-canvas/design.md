## Context

See proposal.md (Why) and ticket.md (repro table). A desktop h=4 card is 262px tall with a 220px content box; the
`panel-card` container (PanelGrid.css) is a size container, so `@container panel-card (max-height: 260px)` matches
exactly the h=4 desktop card and never the mobile stack item (`inline-size` containment only, HEL-1438).

Space today (w=4/6, one-control bar, annotation + truncation note): header 20.6 + gaps 24 + footer 24 + bar 57
(13px label row + 4px gap + 32px select + 8px bar padding) + annotation 28.8 (16.8 line + 12 padding) + note 24.8
(16.8 + 8) leaves 25.4px of canvas. HEL-1398's narrow-only block (PanelContent.css ~L438-496) already removes footnote
padding and clamps to one line, but only when the card is also <=260px wide.

ECharts uses the CanvasRenderer (echartsCore.ts), so axis labels are not DOM. `ChartPanel` already measures its own
canvas height (`useMeasuredChartHeight`) and passes compactness into `buildChartOption`; `hideOverlap` is already used
for time and category axes (buildChartOption.ts ~L228, heatmapHistogramOptions.ts), never for the value axis.

## Goals / Non-Goals

**Goals:** the canvas floors and no-overprint guarantee in `specs/`; a native title tooltip; CSS comment hygiene.

**Non-Goals:** the mobile stack, fullscreen/detail surfaces, grid min sizes, any change to h>=5 cards, footer layout
(the claimed ~4px overrun measured 0px in all 36 cards; re-check in the new e2e, change nothing unless it reproduces).

## Decisions

**D1. Short-card footnote compaction at every width.** Split HEL-1398's block: the footnote rule (padding-block 0,
one-line clamp) moves to `@container panel-card (max-height: 260px)`; the short note form, title clamp and footer
nowrap stay under the existing width+height query. Full text is already on each footnote's `title`. Expected: w4/6 no
bar 94.4 -> ~114 (2 footnotes), 69.6 -> ~98 (3). w=2 is already compacted, so it is unchanged by D1.
Alternative rejected: merging all footnotes into one inline row -- unreadable at w=2 (174px canvas width).

**D2. Inline a one-control bar on short chart-output cards (OWNER REVIEW).** Under the same height query, scoped
to a chart-output card's bar -- `.output-viewer-control-bar--chart`, a class `PanelCardBody` sets from the resolved
Output's kind (`output?.kind === "chart"`), i.e. from config, not from rendered data -- whose bar holds exactly one
control (`:has(> .output-viewer-control-bar__control:only-child ...)`; orphaned controls are never rendered, so children
= visible controls) that is NOT a range control (`:not(.output-viewer-control-bar__control--range)` -- numeric-range and
date-range both carry it; label + two 80/140px inputs cannot fit one row at w=2, so a lone range control stays stacked,
unchanged), the text/dropdown control becomes a row (label beside input, centered, label `flex: 0 0 auto` so its text is
never truncated) and its input flexes to the remaining width (`flex: 1 1 auto; min-width: 0`, and the text input's fixed
160px width yields to `width: auto` in this scope only) so it fits on one row at w=2, and the bar's bottom padding drops
to `--space-1`. Saves ~21px (57 -> ~36). Markup is otherwise unchanged: each control keeps its existing labelling. A bar
with two or more controls is untouched, and so is a bar on a non-chart panel (table, metric, ...).
*Cycle 2 (skeptic-final-1 CR3):* the first design keyed this on footnote presence
(`:has(.chart-panel__annotation, ...)`). Typing into the text control until the result was empty unmounted the
footnotes, the scope stopped matching and the bar restacked under the focused input. The HEL-1398 title/footer
tightening also now matches a card with a chart control bar for the same reason. Keying on the Output's kind keeps the
layout identical through loading, empty and error states, and gives a footnote-less chart the same layout as a
footnoted sibling. Alternatives rejected: hiding the label (loses the visible name of the control); a taller minimum
card height for charts with controls (rewrites stored layouts of existing dashboards, not freely reversible).
Floors in specs are stated for a one-control text/dropdown bar. Two floors have ~1.2-1.6px margin; the e2e asserts
the floors exactly at both 1440 and 1900, and a miss is escalated, never loosened.

**Load-time shift (superseded in cycle 2).** D2 now keys on the Output's kind, so the bar layout no longer changes
when data lands. Only the Output metadata fetch (a few frames after mount) can flip a chart card's bar from stacked
to inline; nothing the user is typing into is mounted before then. D1 and D3 still key on footnote elements, which
do not hold a focus.

**D3. Annotation yields to the control bar on narrow short chart cards (OWNER REVIEW).** Under HEL-1398's existing
width+height query (w=2 only), when the card has an `.output-viewer-control-bar`, `.chart-panel__annotation` is
visually hidden with the canonical `.sr-only`
recipe (re-declared, exactly as HEL-1398 does for the long note, keep in sync with theme.css). Data-honesty notes
(truncation, skipped values, omitted rows) stay visible. The annotation is the author's static subtitle and is shown
on fullscreen/detail views. Expected: w2 (D2+D3) 2 footnotes 33 -> ~71, 3 -> ~54; w4/6 (D1+D2, annotation stays visible) 2 -> ~66, 3 -> ~50.
Hiding at w4/6 too (~83/~66) was considered and rejected as unnecessary: D1+D2 already clear the floors there, and
keeping the author's subtitle visible is the lower-impact call. The PR offers the owner both.

**D4. Value axis drops labels instead of overprinting.** Root cause first (systematic-debugging law): confirm with a
probe at the measured short heights that the y labels overlap because ECharts keeps its default ~5 splits regardless
of height. Preferred fix: in `buildChartOption`, for the value axis of cartesian charts, derive a max label count from
the measured canvas height (label line height incl. compact font) and cap `splitNumber` accordingly, and/or set
`axisLabel.hideOverlap: true`; the executor picks whichever the probe shows actually prevents overlap, and records the
probe. Tall canvases (>=180px) must produce an identical option (guarded by the existing unchanged-path snapshot test,
`chartUnchangedPath.main.snapshot.json`). Horizontal bar charts (value axis on x) are untouched unless the probe shows
the same defect.

**D5. Title tooltip.** `PanelCardHeader.tsx`'s `<h3 className="panel-grid-card__title">` gets `title={panel.title}`.
Accessible name is already the full text content (repro: getByRole resolves); a unit test pins both. Mobile stack h3
is HEL-1438's and is not touched.

**D6. Comment hygiene.** Rewrap every PanelContent.css comment line over 100 characters (today L44, L46, L431,
L438-449, L477, L493) while editing the file; no content change.

## Testing

- Red first: new `e2e/hel1444-footnoted-chart-canvas.spec.ts` (use an annotation long enough to wrap to 2+ lines at
  w=6 so the one-line clamp is exercised), reusing hel1398's seed/measure helpers, asserting the
  spec floors for w=2/4/6 x {no bar, one-control bar} x {2, 3 footnotes} at 1440 and 1900, light and dark; label
  inline geometry (one dropdown), and a two-control bar and a lone numeric-range bar no taller than on main at
  w=2/w=4 (assert against the measured main heights recorded in the red run); w=2 annotation
  hidden-but-in-a11y-tree; h=5 unchanged; title attribute + accessible name; footer
  bottom <= card content-box bottom. Commit the red run output as evidence before the fix.
- Value-axis overlap: unit tests on `buildChartOption` for the height-derived cap (red first), including a >=180px
  measured height proving the option is unchanged, for a bar AND a histogram or time-axis chart, plus an e2e assertion
  that reads the rendered y label positions from the ECharts instance (or, if not reachable, a documented
  screenshot-and-pixel probe), at the shortest measured canvas.
- Card screenshots in both themes at 1440 and 375 (375 = phone stack, unchanged) saved via `evidencePath`.
- Existing specs that must stay green: hel1305, hel1306, hel1311, hel1398, hel1508, hel1512; update hel1398's
  control-bar containment expectations only where this change intentionally improves them (never loosen).

## Risks / Trade-offs

- [Hidden annotation surprises an author] -> OWNER REVIEW in the PR body; reversible CSS; text stays in a11y tree and
  on fullscreen/detail.
- [`:has()` scoping] -> already used by HEL-1398 in the same file; supported by the e2e browsers.
- [Value-axis cap changes tall charts] -> unchanged-path snapshot + spec scenario for >=180px.

## Planner Notes

- Self-approved: D1, D4, D5, D6 (bug fixes within existing behaviour). D2 and D3 are reversible product calls taken
  under the owner's overnight rules; the PR carries "OWNER REVIEW: assumed product call(s)" and is parked, unmerged.
- Floors in specs were derived from the repro arithmetic; slack is thin in places (w2 three-footnote no bar 85.2 vs
  84; w4/6 three-footnote with bar ~50 vs 48). If an implementation honestly lands below a
  floor, the executor escalates rather than loosening it.
