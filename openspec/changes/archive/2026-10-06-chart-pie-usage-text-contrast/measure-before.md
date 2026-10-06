# HEL-1342 measure-before

Running app on this worktree's own servers (dev 6774 / backend 9681; PIDs and cwd in `evidence-ids.md`), main@2c1884ac5 source unmodified, throwaway owner user. Method as `docs/contrast-audit.md` §10: every zrender text element read via `echarts.getInstanceByDom`, its rect screenshotted at DPR 2, painted colour = pixel farthest from the rect's background mode, surface sampled. Threshold WCAG 2.x SC 1.4.3 AA, 4.5:1. Raw output: `measure-before-raw.txt` (per-element JSON not committed); screenshots `before-{light,dark}-{pie-default,pie-percent,usage-0..3}.png`.

## Table (grouped; per-element data in the raw file)

| theme | chart | text kind | zrender fill | outline | surface | painted | painted ratio | fill-vs-surface ratio |
|---|---|---|---|---|---|---|---|---|
| dark | pie (default) | legend | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | pie (default) | slice label | #333 | rgba(255,255,255,1) w2 | #ffffff | #1a1816 | 17.7-17.7 | 12.63 |
| dark | pie (percent labels) | legend | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | pie (percent labels) | slice label | #333 | rgba(255,255,255,1) w2 | #1a1816 | #ffffff | 17.7-17.7 | 1.4 |
| dark | pie (percent labels) | slice label | #333 | rgba(255,255,255,1) w2 | #ffffff | #1a1816 | 17.7-17.7 | 12.63 |
| dark | usage-0 | axis | #54555a | none | #1a1816 | #54555a | 2.38-2.38 | 2.38 |
| dark | usage-1 | axis | #54555a | none | #1a1816 | #54555a | 2.38-2.38 | 2.38 |
| dark | usage-2 | axis | #54555a | none | #1a1816 | #54555a | 2.38-2.38 | 2.38 |
| dark | usage-2 | legend | #54555a | none | #1a1816 | #54555a | 2.38-2.38 | 2.38 |
| dark | usage-3 | axis | #54555a | none | #1a1816 | #54555a | 2.38-2.38 | 2.38 |
| light | pie (default) | legend | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | pie (default) | slice label | #333 | rgba(255,255,255,1) w2 | #ffffff | #333333 | 12.63-12.63 | 12.63 |
| light | pie (percent labels) | legend | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | pie (percent labels) | slice label | #333 | rgba(255,255,255,1) w2 | #fdfcfa | #333333 | 12.32-12.32 | 12.32 |
| light | pie (percent labels) | slice label | #333 | rgba(255,255,255,1) w2 | #ffffff | #333333 | 12.63-12.63 | 12.63 |
| light | usage-0 | axis | #54555a | none | #fdfcfa | #54555a | 7.25-7.25 | 7.25 |
| light | usage-1 | axis | #54555a | none | #fdfcfa | #54555a | 7.25-7.25 | 7.25 |
| light | usage-2 | axis | #54555a | none | #fdfcfa | #54555a | 7.25-7.25 | 7.25 |
| light | usage-2 | legend | #54555a | none | #fdfcfa | #54555a | 7.25-7.25 | 7.25 |
| light | usage-3 | axis | #54555a | none | #fdfcfa | #54555a | 7.25-7.25 | 7.25 |

For pie slice labels the sampled surface is the outline white (the 2px outline dominates the rect), so the "painted" and "fill-vs-surface" columns for that row are outline-confounded. The honest numbers are the fill against the real panel surface: `#333` on dark `#1a1816` = **1.40:1 FAIL** (the ticket's 1.40 is confirmed, analytically and from the rendered fill), `#333` on light `#fdfcfa` = 12.32:1 PASS (already passing).

## Findings

- Pie slice labels (label Text style read directly from the rendered element): `fill: #333`, `stroke: rgba(255,255,255,1)`, `lineWidth: 2`. Dark: without the outline 1.40:1 FAIL; with it they only read because of a heavy white ring (visible in `before-dark-pie*.png`). Light: 12.32:1 PASS.
- Task 1.4, outline mechanism: it is not an ECharts option. ECharts sets no label colour for pie (`PieSeries` default colour commented out), so zrender's `Element.js:159-166` takes `getOutsideFill()` (`#333`, a transparent canvas is not dark mode) and `getOutsideStroke()` with `autoStroke = true` (white). `Text.js:226-234` only applies that default stroke when the fill is the default; an explicit `fill` yields a null stroke. The rendered style confirms it (above, and the after measurement shows `stroke: null`).
- Admin `UsageChart`: every axis tick label and legend entry has `fill: #54555a` (ECharts' own built-in text colour, not a DESIGN.md token) in both themes: dark `#1a1816` **2.38:1 FAIL**, light `#fdfcfa` 7.25:1 PASS (already passing). Axis names are empty strings so none render. All four usage charts render; DAU/WAU and TTFD show legends.
- Pie legends already pass (HEL-1263: `#f2efe9` 15.43 / `#211d19` 16.33).

## Cycle 2 correction (percent-label pie)

The cycle-1 percent-label pie was never a real percent pie: `chartOptions` was put on the panel config, but it belongs on the Output config, and the locator matched the same card twice. Re-measured with two separate Outputs (percent labels on the second Output's `config.chartOptions.pie`), panel titles that cannot substring-match ("HEL-1342 Alpha pie" / "HEL-1342 Bravo pie"), and the main code (2c1884ac5) in `buildChartOption.ts` and `UsageChart.tsx` for the measurement, restored afterwards. The percent pie renders "East: 19.23%", "West: 28.84%", ... with `#333` fill and a 2px white outline: dark 1.40:1 against the surface (rows whose sampled background is the real surface show 1.4; rows sampled inside the outline show the outline-confounded 12.63), light 12.32:1. The `pie-default` and `pie-percent` screenshots have distinct checksums.
