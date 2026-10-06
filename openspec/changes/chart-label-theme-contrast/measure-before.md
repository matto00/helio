# HEL-1263 measure-before

Method: for every zrender text element of each chart (via echarts.getInstanceByDom on the running app, dev 6695), `style.fill` is read, and the element's rect is screenshotted (DPR 2). Background = most common pixel in that rect; painted colour = the pixel farthest from it (glyph antialiasing means this is a lower bound on the true contrast). Ratio = WCAG relative-luminance ratio. Threshold: WCAG 2.x SC 1.4.3 AA, 4.5:1 (normal text).

| theme | kind | text | fill(s) (zrender) | painted colour(s) | background | min painted ratio | max painted ratio | >= 4.5 |
|---|---|---|---|---|---|---|---|---|
| dark | bar | axis name | inherit | #000000 | #1a1816 | 1.19 | 1.19 | FAIL |
| dark | bar | axis tick label | inherit | #000000 | #1a1816 | 1.19 | 1.19 | FAIL |
| dark | bar | legend | inherit | #5070dd | #1a1816 | 3.96 | 3.96 | FAIL |
| dark | line | axis name | inherit | #000000 | #1a1816 | 1.19 | 1.19 | FAIL |
| dark | line | axis tick label | inherit | #000000 | #1a1816 | 1.19 | 1.19 | FAIL |
| dark | line | legend | inherit | #ffffff | #1a1816 | 17.7 | 17.7 | PASS |
| dark | pie | pie legend | inherit | #0ca8df, #505372, #5070dd, #b6d634, #ff994d | #1a1816 | 2.38 | 10.67 | FAIL |
| dark | pie | pie slice label | #333 | #1a1816 | #ffffff | 17.7 | 17.7 | PASS |
| dark | scatter | axis name | inherit | #000000 | #1a1816 | 1.19 | 1.19 | FAIL |
| dark | scatter | axis tick label | inherit | #000000 | #1a1816 | 1.19 | 1.19 | FAIL |
| dark | tinted-line | axis name | inherit | #000000 | #514611 | 2.23 | 2.23 | FAIL |
| dark | tinted-line | axis tick label | inherit | #000000 | #514611 | 2.23 | 2.23 | FAIL |
| dark | tinted-line | legend | inherit | #ffffff | #514611 | 9.4 | 9.4 | PASS |
| light | bar | axis name | inherit | #000000 | #fdfcfa | 20.48 | 20.48 | PASS |
| light | bar | axis tick label | inherit | #000000 | #fdfcfa | 20.48 | 20.48 | PASS |
| light | bar | legend | inherit | #5070dd | #fdfcfa | 4.36 | 4.36 | FAIL |
| light | line | axis name | inherit | #000000 | #fdfcfa | 20.48 | 20.48 | PASS |
| light | line | axis tick label | inherit | #000000 | #fdfcfa | 20.48 | 20.48 | PASS |
| light | line | legend | inherit | #ffffff | #fdfcfa | 1.03 | 1.03 | FAIL |
| light | pie | pie legend | inherit | #0ca8df, #505372, #5070dd, #b6d634, #ff994d | #fdfcfa | 1.62 | 7.26 | FAIL |
| light | pie | pie slice label | #333 | #333333 | #ffffff | 12.63 | 12.63 | PASS |
| light | scatter | axis name | inherit | #000000 | #fdfcfa | 20.48 | 20.48 | PASS |
| light | scatter | axis tick label | inherit | #000000 | #fdfcfa | 20.48 | 20.48 | PASS |
| light | tinted-line | axis name | inherit | #000000 | #fdf3be | 18.74 | 18.74 | PASS |
| light | tinted-line | axis tick label | inherit | #000000 | #fdf3be | 18.74 | 18.74 | PASS |
| light | tinted-line | legend | inherit | #ffffff | #fdf3be | 1.12 | 1.12 | FAIL |

## Findings (before, on main 835b57d93, unmodified source)

- Every axis tick label and axis name has `style.fill === "inherit"` (not a colour). ECharts hands that string to canvas, which ignores it, so the text paints in the canvas default, black `#000000`. Black passes on the light panel surface (20.48:1) and **fails on the dark one (1.19:1)**. So the ticket's premise ("low contrast in dark") is confirmed for axes, and light was already passing for axis text; this is NOT claimed as a before-fail.
- The legend text is also `"inherit"` and paints a series-colour or white. In **light** theme, the line legend text paints white `#ffffff` on `#fdfcfa` (1.03:1, effectively invisible, see before-light-line.png), and the bar and pie legends paint the series colour (bar 4.36:1, pie 1.62:1 to 7.26:1). In dark, the bar legend is 3.96:1 and pie legend entries are 2.38:1 to 10.67:1. The line legend in dark happens to pass (17.7:1). So the legend defect is wider than the ticket text: it fails in light too.
- Scatter has no legend entries (single unnamed series), so only axes are measured.
- Pie has no axes. Pie slice labels have fill `#333` (ECharts' own default; they do not take the global `textStyle`) with a light text outline, so they stay legible in both themes. The sampled ratio is confounded by that outline (sampled background is the outline white) and is not a reliable number; they are out of this ticket's "axis and legend text" scope per design D4 and are left untouched.
- Tinted panel (dark theme, background `#ffd700`, surface `#514611`): axis text black at 2.23:1 (fail). Light theme, same tint `#fdf3be`: axis 18.74:1 (pass), legend 1.12:1 (fail).
- Observation about design D2's flip branch: `resolvePanelTextColor` with `"inherit"` never flips for any background at the 0.24 tint strength (probed 12 backgrounds, both themes; always returns `defaultText`). So the tinted-panel flip scenario is not reachable for `"inherit"` today. The helper still delegates to it, so the chart can never disagree with the card.
