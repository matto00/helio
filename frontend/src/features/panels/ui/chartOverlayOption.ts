import type { EChartsOption } from "echarts";

import type { ChartTypeOptionsMap } from "../types/panel";
import { toSeriesArray } from "../../../utils/chartAppearance";
import type { ChartThemeTokens, ChartType } from "../../../utils/chartAppearance";
import type { ChartOverlay } from "../history/chartOverlay";

/** Overlay bar fill opacity — subordinate to the primary series, same token colour in both themes. */
export const OVERLAY_BAR_OPACITY = 0.45;

/** `#rgb`/`#rrggbb`/`rgb()`/`rgba()` with its alpha replaced; any other form is returned as is. */
function withAlpha(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(colour.trim());
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})` : colour;
}

/** HEL-1277 design D8 — appends the labelled "vs" series to a built single-series line/bar option.
 *  Ignored (option returned unchanged) for pie/scatter, a multi-series primary, a non-category x
 *  axis (horizontal bars move the category axis to y), normalized stacking (the primary became
 *  percent shares on a 0-100 axis), or when no primary category matches an overlay point. Overlay
 *  values align to the primary categories by `String(x)` (first occurrence); a null x never matches. */
export function applyChartOverlay(
  option: EChartsOption,
  chartType: ChartType,
  chartOptions: ChartTypeOptionsMap | null | undefined,
  overlay: ChartOverlay | null | undefined,
  themeTokens: ChartThemeTokens,
): EChartsOption {
  if (!overlay || (chartType !== "line" && chartType !== "bar")) return option;
  if (chartType === "bar") {
    if (chartOptions?.bar?.stacking === "normalized") return option;
    if (chartOptions?.bar?.orientation === "horizontal") return option;
  }
  const xAxis = option.xAxis as { type?: string; data?: unknown[] } | undefined;
  if (!xAxis || Array.isArray(xAxis) || xAxis.type !== "category" || !Array.isArray(xAxis.data)) {
    return option;
  }
  const primary = toSeriesArray(option);
  if (primary.length !== 1) return option;

  const byCategory = new Map<string, number | null>();
  for (const [x, y] of overlay.points) {
    if (x === null || x === undefined) continue;
    const key = String(x);
    if (!byCategory.has(key)) byCategory.set(key, y);
  }
  let matched = false;
  const data = xAxis.data.map((c) => {
    const key = String(c);
    if (!byCategory.has(key)) return null;
    matched = true;
    return byCategory.get(key) ?? null;
  });
  if (!matched) return option;

  const colour = themeTokens.textMuted;
  const overlaySeries =
    chartType === "line"
      ? {
          type: "line",
          name: overlay.label,
          data,
          z: 1,
          symbol: "none",
          lineStyle: { type: "dashed", color: colour, width: 2 },
          itemStyle: { color: colour },
        }
      : {
          type: "bar",
          name: overlay.label,
          data,
          z: 1,
          // Translucent fill (subordinate) inside an OPAQUE boundary: the boundary carries the
          // WCAG 1.4.11 3:1 non-text contrast; `itemStyle.opacity` would fade it too, so the
          // fill alone is made translucent through its own alpha.
          itemStyle: {
            color: withAlpha(colour, OVERLAY_BAR_OPACITY),
            borderColor: colour,
            borderWidth: 1,
          },
        };

  // The data option names its legend entries explicitly, so the overlay must be listed too.
  const legend = option.legend as { data?: unknown[] } | undefined;
  const nextLegend =
    legend && Array.isArray(legend.data)
      ? { ...legend, data: [...legend.data, overlay.label] }
      : legend;

  return {
    ...option,
    ...(nextLegend ? { legend: nextLegend } : {}),
    series: [...primary, overlaySeries],
  } as EChartsOption;
}
