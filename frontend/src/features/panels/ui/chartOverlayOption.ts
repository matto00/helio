import type { EChartsOption } from "echarts";

import type { ChartTypeOptionsMap } from "../types/panel";
import { toSeriesArray } from "../../../utils/chartAppearance";
import type { ChartThemeTokens, ChartType } from "../../../utils/chartAppearance";
import type { ChartOverlay } from "../history/chartOverlay";
import { parseChartInstant } from "../../../utils/chartTimeAxis";

/** Overlay bar fill opacity — subordinate to the primary series, same token colour in both themes. */
export const OVERLAY_BAR_OPACITY = 0.45;

/** `#rgb`/`#rrggbb`/`rgb()`/`rgba()` with its alpha replaced; any other form is returned as is. */
export function withAlpha(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(colour.trim());
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})` : colour;
}

interface TimePoint {
  name?: string;
  value: [number, unknown];
}

function alignByCategory(
  categories: unknown[],
  overlay: ChartOverlay,
): Array<number | null> | null {
  const byCategory = new Map<string, number | null>();
  for (const [x, y] of overlay.points) {
    if (x === null || x === undefined) continue;
    const key = String(x);
    if (!byCategory.has(key)) byCategory.set(key, y);
  }
  let matched = false;
  const data = categories.map((c) => {
    const key = String(c);
    if (!byCategory.has(key)) return null;
    matched = true;
    return byCategory.get(key) ?? null;
  });
  return matched ? data : null;
}

/** One overlay value per primary `{name, value: [t, y]}` point, matched by instant (first overlay
 *  occurrence wins); `null` when no primary instant matches any overlay point. */
function alignByInstant(primary: TimePoint[], overlay: ChartOverlay): TimePoint[] | null {
  const byInstant = new Map<number, number | null>();
  for (const [x, y] of overlay.points) {
    if (x === null || x === undefined) continue;
    const t = parseChartInstant(String(x));
    if (t !== null && !byInstant.has(t)) byInstant.set(t, y);
  }
  let matched = false;
  const data = primary.map((p) => {
    const t = p.value[0];
    const hit = byInstant.has(t);
    if (hit) matched = true;
    return {
      name: p.name,
      value: [t, hit ? (byInstant.get(t) ?? null) : null] as [number, unknown],
    };
  });
  return matched ? data : null;
}

/** HEL-1277 design D8 — appends the labelled "vs" series to a built single-series line/bar option.
 *  Ignored (option returned unchanged) for any chart type other than line/bar (pie, scatter, heatmap, histogram), a multi-series primary, a non-category x
 *  or time x axis (horizontal bars move the category axis to y), normalized stacking (the primary
 *  became percent shares on a 0-100 axis), or when no primary x matches an overlay point. Overlay
 *  values align to the primary categories by `String(x)` (first occurrence); on a time axis (HEL-1305)
 *  by the instant each x denotes, so `2026-10-01` meets `2026-10-01T00:00:00Z`. A null x never matches. */
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
  if (!xAxis || Array.isArray(xAxis)) return option;
  const primary = toSeriesArray(option);
  if (primary.length !== 1) return option;

  let data: unknown[] | null = null;
  if (xAxis.type === "category" && Array.isArray(xAxis.data)) {
    data = alignByCategory(xAxis.data, overlay);
  } else if (xAxis.type === "time" && Array.isArray(primary[0].data)) {
    data = alignByInstant(primary[0].data as TimePoint[], overlay);
  }
  if (!data) return option;

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
