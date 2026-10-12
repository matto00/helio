# HEL-1508: After HEL-1305: same-date bars overlap on a time axis; unparseable x rows silently dropped; non-numeric y plotted as 0; axis-type override

## Description

These follow-ups came from HEL-1305 (matto00/helio#959, 559c4be77). It added an automatic time x axis for timestamp-typed x on line, vertical bar and scatter charts, plus null gaps for missing multi-series points.

1. **Product call:** on a time axis, a raw-row single-series bar chart overlaps its bars when two rows share a date, so the smaller value is hidden. Options: aggregate, offset, or fall back to a category axis.
2. Rows whose x value doesn't parse are dropped from a time chart with no indication. Add a note, like the 200-row truncation note or the histogram skipped-values note.
3. Single-series and auto-detect charts still plot a non-numeric y as 0. Multi-series charts now show a gap there.
4. **Product call:** string-typed date columns have no axis-type override. In practice schema inference types most date-looking columns as `timestamp`.
5. **Spec:** cross-reference the older "x-axis categories" requirement in `chart-field-data-rendering` to the new time-axis requirement.

Priority: Low. Label: Follow-up. Related: HEL-1305.

## Owner rulings

Recorded 2026-10-12 via `concertino answer` (escalation HEL-1508-1791786452196-8806e8, channel chat). Every ruling matched the orchestrator's recommendation.

- **Q1, item 1: `category-fallback`.** When a plotted instant repeats on a raw-row single-series bar chart, that chart renders on a category axis, as before HEL-1305. Every row keeps its own bar, sorted by date, and no aggregation is invented.
- **Q2, item 3: `gap-everywhere`.** Single-series and auto-detect charts plot a non-numeric y as a gap on both category and time axes. A scatter point with no numeric y is not drawn.
- **Q3, item 4: `no-override`.** Build nothing. Item 4 closes with the pipeline cast step to `timestamp` documented as the path.

## Acceptance criteria

1. On a vertical bar chart whose x field is declared `timestamp`, a raw-row single-series chart (or an auto-detect one with no y mapping) where two plotted rows denote the same instant renders on a category axis. Every row has its own bar, in instant order, so neither value is hidden. Without a repeated instant it stays on the time axis. Line, scatter, multi-series and aggregated charts are unaffected.
2. When a chart plots on a time axis and leaves out rows whose x denotes no instant (or aggregate groups whose key denotes none), a footnote states how many, in the style and slot of the histogram skipped-values note. Nothing is shown when nothing was left out, and no note appears on non-time charts.
3. Single-series and auto-detect line/bar charts plot a non-numeric or empty y as no value (`null`) on category and time axes alike. A scatter point with no numeric y is not drawn. Where a tooltip lists a missing value (a multi-series axis tooltip) it shows `—`. A single-series gap draws no mark and has no hover target. Orchestrator correction after executor cycle 1 measured this in the running app; the original wording overclaimed.
4. Item 4: no axis-type setting is added. The spec states that a string-typed column gets a time axis by being cast to `timestamp` in the pipeline.
5. The `chart-field-data-rendering` requirement describing x-axis categories cross-references the time-axis requirement and the gap rule.
6. Red-first unit tests cover 1-3. The hel1305, hel1306, hel1311 and hel1512 e2e specs pass. The running app is verified in light and dark themes at 1440 and 375 widths.
