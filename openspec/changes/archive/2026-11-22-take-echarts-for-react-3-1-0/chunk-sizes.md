# Chunk sizes, before and after (HEL-1824)

`npm run build` in `frontend/` (Vite 8.1.6). Before = base commit, echarts-for-react 3.0.6, `echarts-for-react/esm/core`.
After = echarts-for-react 3.1.0, `echarts-for-react/lib/core`. Sizes from Vite's output; gzip as Vite reports it.

| Chunk                              | Before raw / gzip   | After raw / gzip    | Change |
| ---------------------------------- | ------------------- | ------------------- | ------ |
| `useChartEntranceMotion` (chart, holds echarts + echarts-for-react core) | 651.30 kB / 218.39 kB | 651.30 kB / 218.39 kB | 0 %    |
| `ChartPanel`                       | 20.90 kB / 7.46 kB  | 20.90 kB / 7.46 kB  | 0 %    |
| `AdminUsagePage`                   | 12.18 kB / 4.00 kB  | 12.18 kB / 4.00 kB  | 0 % (file hash only changed) |

Exact bytes of the chart chunk: 651301 raw, 215657 gzip -9, in both builds. The chunk file name carries the same content
hash (`useChartEntranceMotion-CSmy2lrY.js`) before and after and `cmp` of the two is identical, so Vite resolved
`lib/core` through the `module` condition to the same `esm/core.js` the old import loaded, not the CommonJS build.

Full `echarts` is not bundled: the chart chunk is 651 kB against 1.12 MB / 369 KB gzip for the full package (the figure in
`ChartPanel.tsx`'s comment), and it is byte-identical to the tree-shaken pre-change chunk.
