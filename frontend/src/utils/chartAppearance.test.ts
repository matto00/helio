import type { EChartsOption } from "echarts";

import {
  appearanceToEChartsOption,
  applyAxisTriggerTooltip,
  applyHoverEmphasis,
  formatChartNumber,
  prefersReducedMotion,
  resolveChartTheme,
} from "./chartAppearance";
import type { ChartAppearance } from "../features/panels/types/panel";
const baseChart: ChartAppearance = {
  seriesColors: [],
  legend: { show: true, position: "top" },
  tooltip: { enabled: true },
  axisLabels: {
    x: { show: true, label: "X" },
    y: { show: true, label: "Y" },
  },
};

describe("appearanceToEChartsOption", () => {
  it("sets color array when seriesColors is non-empty", () => {
    const chart = { ...baseChart, seriesColors: ["#ff0000", "#00ff00"] };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.color).toEqual(["#ff0000", "#00ff00"]);
  });

  it("omits color key when seriesColors is empty", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.color).toBeUndefined();
  });

  it("maps legend show=true and position=top to horizontal orient at top", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.legend).toMatchObject({ show: true, orient: "horizontal", top: 0 });
  });

  it("maps legend show=false to hidden legend", () => {
    const chart = { ...baseChart, legend: { show: false, position: "top" as const } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.legend).toMatchObject({ show: false });
  });

  it("maps legend position=bottom to bottom orient", () => {
    const chart = { ...baseChart, legend: { show: true, position: "bottom" as const } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.legend).toMatchObject({ orient: "horizontal", bottom: 0 });
  });

  it("maps legend position=left to vertical orient", () => {
    const chart = { ...baseChart, legend: { show: true, position: "left" as const } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.legend).toMatchObject({ orient: "vertical", left: 0 });
  });

  it("maps legend position=right to vertical orient", () => {
    const chart = { ...baseChart, legend: { show: true, position: "right" as const } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.legend).toMatchObject({ orient: "vertical", right: 0 });
  });

  it("maps tooltip.enabled=true to show:true", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.tooltip).toMatchObject({ show: true });
  });

  it("maps tooltip.enabled=false to show:false", () => {
    const chart = { ...baseChart, tooltip: { enabled: false } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.tooltip).toMatchObject({ show: false });
  });

  it("maps axisLabels.x.show=true and label to xAxis", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.xAxis).toMatchObject({ axisLabel: { show: true }, name: "X" });
  });

  it("maps axisLabels.x.show=false to xAxis axisLabel.show false", () => {
    const chart = {
      ...baseChart,
      axisLabels: { ...baseChart.axisLabels, x: { show: false, label: "X" } },
    };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.xAxis).toMatchObject({ axisLabel: { show: false } });
  });

  it("maps axisLabels.y.show and label to yAxis", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.yAxis).toMatchObject({ axisLabel: { show: true }, name: "Y" });
  });

  it("omits the axis name entirely when label is undefined (F-095 — never a placeholder-looking empty title)", () => {
    const chart = {
      ...baseChart,
      axisLabels: {
        x: { show: true },
        y: { show: true },
      },
    };
    const { option } = appearanceToEChartsOption(chart);
    expect((option.xAxis as { name?: string }).name).toBeUndefined();
    expect((option.yAxis as { name?: string }).name).toBeUndefined();
  });

  it("omits the axis name when label is an empty string (F-095)", () => {
    const chart = {
      ...baseChart,
      axisLabels: {
        x: { show: true, label: "" },
        y: { show: true, label: "" },
      },
    };
    const { option } = appearanceToEChartsOption(chart);
    expect((option.xAxis as { name?: string }).name).toBeUndefined();
    expect((option.yAxis as { name?: string }).name).toBeUndefined();
  });

  describe("chartType propagation", () => {
    it('returns chartType="line" when chartType is undefined', () => {
      const { chartType } = appearanceToEChartsOption(baseChart);
      expect(chartType).toBe("line");
    });

    it('returns chartType="bar" when chartType is bar', () => {
      const chart = { ...baseChart, chartType: "bar" as const };
      const { chartType } = appearanceToEChartsOption(chart);
      expect(chartType).toBe("bar");
    });

    it('returns chartType="pie" when chartType is pie', () => {
      const chart = { ...baseChart, chartType: "pie" as const };
      const { chartType } = appearanceToEChartsOption(chart);
      expect(chartType).toBe("pie");
    });

    it('returns chartType="scatter" when chartType is scatter', () => {
      const chart = { ...baseChart, chartType: "scatter" as const };
      const { chartType } = appearanceToEChartsOption(chart);
      expect(chartType).toBe("scatter");
    });
  });

  // F-024/F-025/F-196 — gridlines, tooltip chrome, and canvas text were never
  // theme-aware (no color/backgroundColor/fontFamily set anywhere), so dark
  // theme rendered ECharts' own defaults: bright white gridlines and a stark
  // unstyled white tooltip box. jsdom never loads `theme.css`, so
  // `resolveChartTheme()` resolves through to its documented dark-theme
  // fallback here — this still asserts the wiring is real (every value comes
  // from the same `themeTokens` object, not a second hand-rolled palette).
  describe("theme wiring (F-024/F-025/F-196)", () => {
    const theme = resolveChartTheme();

    it("styles the tooltip from theme tokens", () => {
      const { option } = appearanceToEChartsOption(baseChart);
      expect(option.tooltip).toMatchObject({
        backgroundColor: theme.surfaceStrong,
        borderColor: theme.borderSubtle,
        // HEL-566: mono, not sans — unlike the rest of the chart's chrome,
        // the tooltip's values are tabular numerals (Decision 2).
        textStyle: { color: theme.text, fontFamily: theme.fontMono },
      });
    });

    // HEL-566 — the tooltip's DOM box (shadow/radius) isn't reachable through
    // ECharts' typed tooltip props; it has to go through `extraCssText`
    // (Decision 1).
    it("carries the tooltip's shadow/radius tokens in extraCssText", () => {
      const { option } = appearanceToEChartsOption(baseChart);
      const extraCssText = (option.tooltip as { extraCssText?: string }).extraCssText ?? "";
      expect(extraCssText).toContain(theme.shadowSoft);
      expect(extraCssText).toContain(theme.radiusMd);
    });

    it("colors axisLine/axisTick/splitLine from the border-subtle token", () => {
      const { option } = appearanceToEChartsOption(baseChart);
      const lineStyle = { lineStyle: { color: theme.borderSubtle } };
      expect(option.xAxis).toMatchObject({
        axisLine: lineStyle,
        axisTick: lineStyle,
        splitLine: lineStyle,
      });
      expect(option.yAxis).toMatchObject({
        axisLine: lineStyle,
        axisTick: lineStyle,
        splitLine: lineStyle,
      });
    });

    it("sets fontFamily on the global textStyle and axis labels", () => {
      const { option } = appearanceToEChartsOption(baseChart);
      expect(option.textStyle).toMatchObject({ fontFamily: theme.fontSans });
      expect((option.xAxis as { axisLabel?: { fontFamily?: string } }).axisLabel).toMatchObject({
        fontFamily: theme.fontMono,
      });
      expect((option.yAxis as { axisLabel?: { fontFamily?: string } }).axisLabel).toMatchObject({
        fontFamily: theme.fontMono,
      });
    });
  });

  // F-195 — the Y axis and tooltip previously fell through to ECharts' own
  // comma-grouped default, inconsistent with MetricRenderer's deliberate
  // no-grouping convention for the same underlying numeric field.
  describe("number formatting (F-195)", () => {
    it("formats large numbers without thousands grouping, matching MetricRenderer", () => {
      expect(formatChartNumber(1000000)).toBe("1000000");
      expect(formatChartNumber(1234.5)).toBe("1234.5");
    });

    it("caps fraction digits at 2", () => {
      expect(formatChartNumber(1.23456)).toBe("1.23");
    });

    it("wires the yAxis axisLabel formatter to the shared numeric formatter", () => {
      const { option } = appearanceToEChartsOption(baseChart);
      const formatter = (option.yAxis as { axisLabel?: { formatter?: (v: number) => string } })
        .axisLabel?.formatter;
      expect(formatter?.(1000000)).toBe("1000000");
    });

    it("wires tooltip.valueFormatter to the shared numeric formatter", () => {
      const { option } = appearanceToEChartsOption(baseChart);
      const valueFormatter = (option.tooltip as { valueFormatter?: (v: unknown) => string })
        .valueFormatter;
      expect(valueFormatter?.(2000000)).toBe("2000000");
    });
  });
});

// HEL-566 — `shadowSoft`/`radiusMd`/`accentStrong` read with the same
// live/fallback pattern as the existing five `ChartThemeTokens`.
describe("resolveChartTheme — new tokens (HEL-566)", () => {
  it("resolves shadowSoft, radiusMd, and accentStrong (falling back off jsdom, same as the existing tokens)", () => {
    const theme = resolveChartTheme();
    expect(theme.shadowSoft).toBeTruthy();
    expect(theme.radiusMd).toBeTruthy();
    expect(theme.accentStrong).toBeTruthy();
  });
});

describe("prefersReducedMotion", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("returns true when the media query matches", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("returns false when the media query does not match", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });
});

// HEL-566 D3 — axis-trigger tooltip fires only for a bar/line chart with more
// than one series; pie/scatter and single-series bar/line keep the existing
// item-trigger tooltip unchanged.
describe("applyAxisTriggerTooltip", () => {
  function optionWithSeries(count: number, type: string): EChartsOption {
    return {
      tooltip: { show: true, trigger: "item" },
      series: Array.from({ length: count }, (_, i) => ({ type, name: `s${i}`, data: [] })),
    } as unknown as EChartsOption;
  }

  it("sets axis trigger with a shadow pointer for a multi-series bar chart", () => {
    const option = applyAxisTriggerTooltip(optionWithSeries(2, "bar"), "bar");
    expect(option.tooltip).toMatchObject({ trigger: "axis", axisPointer: { type: "shadow" } });
  });

  it("sets axis trigger with a line pointer for a multi-series line chart", () => {
    const option = applyAxisTriggerTooltip(optionWithSeries(2, "line"), "line");
    expect(option.tooltip).toMatchObject({ trigger: "axis", axisPointer: { type: "line" } });
  });

  it("keeps item trigger for a single-series bar chart", () => {
    const option = applyAxisTriggerTooltip(optionWithSeries(1, "bar"), "bar");
    expect((option.tooltip as { trigger?: string }).trigger).toBe("item");
    expect((option.tooltip as { axisPointer?: unknown }).axisPointer).toBeUndefined();
  });

  it("keeps item trigger for a single-series line chart", () => {
    const option = applyAxisTriggerTooltip(optionWithSeries(1, "line"), "line");
    expect((option.tooltip as { trigger?: string }).trigger).toBe("item");
  });

  it("keeps item trigger for a pie chart regardless of series count", () => {
    const option = applyAxisTriggerTooltip(optionWithSeries(1, "pie"), "pie");
    expect((option.tooltip as { trigger?: string }).trigger).toBe("item");
  });

  it("keeps item trigger for a scatter chart regardless of series count", () => {
    const option = applyAxisTriggerTooltip(optionWithSeries(2, "scatter"), "scatter");
    expect((option.tooltip as { trigger?: string }).trigger).toBe("item");
    expect((option.tooltip as { axisPointer?: unknown }).axisPointer).toBeUndefined();
  });

  it("preserves the rest of the tooltip config it did not set", () => {
    const option = applyAxisTriggerTooltip(optionWithSeries(2, "bar"), "bar");
    expect((option.tooltip as { show?: boolean }).show).toBe(true);
  });
});

// HEL-566 D4 — subtle, accent-strong-colored hover emphasis on every series;
// reduced motion makes the state change instant instead of omitting it.
describe("applyHoverEmphasis", () => {
  const themeTokens = resolveChartTheme();
  const optionWithSeries = (): EChartsOption => ({
    series: [
      { type: "bar", data: [1, 2] },
      { type: "line", data: [3, 4] },
    ],
  });

  it("adds accent-strong-colored emphasis with focus:series to every series (animated case)", () => {
    const option = applyHoverEmphasis(optionWithSeries(), themeTokens, false);
    const series = option.series as Array<{ emphasis?: Record<string, unknown> }>;
    for (const s of series) {
      expect(s.emphasis).toMatchObject({
        focus: "series",
        itemStyle: { borderColor: themeTokens.accentStrong },
      });
    }
  });

  it("does not set animation:false when motion is not reduced", () => {
    const option = applyHoverEmphasis(optionWithSeries(), themeTokens, false);
    const series = option.series as Array<{ animation?: boolean }>;
    for (const s of series) {
      expect(s.animation).toBeUndefined();
    }
  });

  it("sets animation:false on every series when reduced motion is requested, while keeping emphasis", () => {
    const option = applyHoverEmphasis(optionWithSeries(), themeTokens, true);
    const series = option.series as Array<{
      animation?: boolean;
      emphasis?: Record<string, unknown>;
    }>;
    for (const s of series) {
      expect(s.animation).toBe(false);
      expect(s.emphasis).toMatchObject({ focus: "series" });
    }
  });

  it("returns the option unchanged when there is no series", () => {
    const option = applyHoverEmphasis({ tooltip: { show: true } }, themeTokens, false);
    expect(option.series).toBeUndefined();
  });
});
