# HEL-1342 measure-after

Same method, same running app and user, after the change (hot-reloaded by Vite). Raw: `measure-after-raw.txt` (per-element JSON not committed); screenshots `after-{light,dark}-{pie-default,pie-percent,usage-0..3}.png`.

| theme | chart | text kind | zrender fill | outline | surface | painted | painted ratio | fill-vs-surface ratio |
|---|---|---|---|---|---|---|---|---|
| dark | pie (default) | legend | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | pie (default) | slice label | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | pie (percent labels) | legend | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | pie (percent labels) | slice label | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | usage-0 | axis | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | usage-1 | axis | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | usage-2 | axis | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | usage-2 | legend | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| dark | usage-3 | axis | #f2efe9 | none | #1a1816 | #f2efe9 | 15.43-15.43 | 15.43 |
| light | pie (default) | legend | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | pie (default) | slice label | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | pie (percent labels) | legend | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | pie (percent labels) | slice label | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | usage-0 | axis | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | usage-1 | axis | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | usage-2 | axis | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | usage-2 | legend | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |
| light | usage-3 | axis | #211d19 | none | #fdfcfa | #211d19 | 16.33-16.33 | 16.33 |

Every text element (pie slice labels, pie legend, usage axis ticks, usage legends) now has `fill` equal to the live `--app-text` token and **no outline** (`stroke: null`): dark `#f2efe9` on `#1a1816` 15.43:1, light `#211d19` on `#fdfcfa` 16.33:1. Everything >= 4.5:1. Visual comparison in both themes: slice labels read as the same text as the adjacent legend (same colour, no ring); label position is unchanged (outside, with leader lines); no label overlaps a slice in the 5-slice default or percent pie.

## 4.3 Other ECharts call sites

grep for `ReactECharts|echarts.init|echarts-for-react` outside tests finds only: `ChartPanel.tsx` / `renderers/ChartRenderer.tsx` (the panel path through `buildChartOption`, covered), `UsageChart.tsx` (fixed here), `echartsCore.ts` (registration), and type/helper modules (`chartAppearance.ts`, `chartClickSelection.ts`, `useChartClickHandler.ts`). No new follow-up candidates. Follow-up candidate noted: a shared `applyChartTextColor` helper if a third option-builder appears.

## Cycle 2 correction (percent-label pie)

The percent-label pie is now a real one (labels "East: 19.23%" etc., formatter `{b}: {d}%` present in the rendered option): fill `#f2efe9` (dark, 15.43:1) / `#211d19` (light, 16.33:1), `stroke: null`. The `pie-default` and `pie-percent` screenshots have distinct checksums.
