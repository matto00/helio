// F-022 — `echarts-for-react`'s default export (`echarts-for-react/index`)
// does `import * as echarts from 'echarts'`: the full library (1.12 MB min /
// 369 KB gzip), auto-registering every chart type and component it ships as
// a side effect, so bundlers can't tree-shake any of it away even though
// `ChartPanel` only ever renders every `ChartType` value (`CHART_TYPES` in
// `utils/chartAppearance.ts`) with a plain category/value grid, legend, and
// tooltip (`appearanceToEChartsOption`) — no dataZoom, toolbox, geo, etc.
//
// `echarts/core` + selective `.use()` registration is ECharts' own
// documented tree-shaking path: import only the pieces actually used and
// pair with `echarts-for-react`'s `/core` entry point (which takes the
// registered `echarts` instance as a prop instead of importing the full
// package itself). Kept as its own module — rather than inlined into
// `ChartPanel.tsx` — so the registration side effect runs exactly once and
// the chart-type/component list lives next to a comment explaining why each
// entry is there, instead of buried in the component file.
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  // Chart types — every `ChartType` value (`utils/chartAppearance.ts`).
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  // HEL-1311: `heatmap` (a category x category matrix). `histogram` renders as a BarChart series.
  HeatmapChart,
  // Cartesian grid (xAxis/yAxis) — `appearanceToEChartsOption` always sets both.
  GridComponent,
  // `chart.legend` (`appearanceToEChartsOption`).
  LegendComponent,
  // `chart.tooltip` (`appearanceToEChartsOption`).
  TooltipComponent,
  // HEL-1311: the heatmap's colour-scale legend (`visualMap`, continuous).
  VisualMapComponent,
  // HEL-1306: `markLine` / `markArea`, the reference lines and bands (`referenceMarksOption.ts`).
  MarkLineComponent,
  MarkAreaComponent,
  // Only renderer `ChartPanel` needs; SVGRenderer is never opted into.
  CanvasRenderer,
]);

export default echarts;
