// HEL-1306 D5. The layout claims (axis extent, bar width) are measured on a REAL ECharts instance
// (SSR, so no canvas) -- an option-shape assertion would not prove what ECharts actually does.
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

import { defaultChartAppearance } from "../../../theme/appearance";
import type { ChartThemeTokens, ChartType } from "../../../utils/chartAppearance";
import type { ReferenceMarks } from "../../../utils/referenceMarks";
import type { ChartOverlay } from "../history/chartOverlay";
import type { ChartTypeOptionsMap } from "../types/panel";
import { buildChartOption } from "./buildChartOption";
import {
  BAND_LABEL_Z,
  REFERENCE_BAND_OPACITY,
  REFERENCE_CARRIER_ID,
  REFERENCE_LABEL_CARRIER_ID,
} from "./referenceMarksOption";

// zrender measures text through a canvas 2D context, which jsdom does not provide: a fixed-width stub keeps
// layout deterministic (the extent and bar-width claims below do not depend on text size).
beforeAll(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(
      () => ({ measureText: (t: string) => ({ width: t.length * 6 }), font: "" }) as never,
    );
});

const tokens: ChartThemeTokens = {
  surfaceStrong: "#1a1d24",
  borderSubtle: "#d0d5dd",
  text: "#abcdef",
  fontSans: "Inter, sans-serif",
  fontMono: "ui-monospace, monospace",
  shadowSoft: "0 1px 2px rgba(0,0,0,0.1)",
  radiusMd: "8px",
  accentEmphasis: "#ea580c",
  accent: "#ea580c",
  textMuted: "#778899",
  success: "#4cc38a",
  warning: "#f5b944",
  error: "#f17b67",
};

const rows = [
  ["Mon", "5", "east"],
  ["Tue", "37.3", "west"],
  ["Wed", "20", "east"],
];

interface Opts {
  chartOptions?: ChartTypeOptionsMap;
  overlay?: ChartOverlay | null;
  fieldMapping?: Record<string, string>;
  data?: string[][];
}

function build(
  chartType: ChartType,
  marks: ReferenceMarks | null,
  opts: Opts & { compact?: boolean } = {},
): EChartsOption {
  return buildChartOption({
    appearance: {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...defaultChartAppearance, chartType },
    },
    rawRows: opts.data ?? rows,
    headers: ["day", "amount", "region"],
    fieldMapping: opts.fieldMapping ?? { xAxis: "day", yAxis: "amount" },
    chartOptions: opts.chartOptions,
    overlay: opts.overlay,
    referenceMarks: marks,
    effectiveCompact: opts.compact ?? false,
    measuredPieLegendOverlap: false,
    themeTokens: tokens,
    theme: "dark",
  });
}

const lines = (...values: number[]): ReferenceMarks => ({
  lines: values.map((value) => ({ value })),
  bands: [],
});

/** The value axis's resolved extent and the first bar's width, as ECharts laid them out. */
function measure(option: EChartsOption, axis: "yAxis" | "xAxis" = "yAxis") {
  const chart = echarts.init(null as never, undefined, {
    renderer: "svg",
    ssr: true,
    width: 600,
    height: 400,
  });
  chart.setOption(option);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (chart as any).getModel();
  const extent = model.getComponent(axis).axis.scale.getExtent() as [number, number];
  const bar = model.getSeriesByIndex(0).getData().getItemLayout(0) as
    | { width?: number; height?: number }
    | undefined;
  chart.dispose();
  return { extent, barSize: axis === "yAxis" ? bar?.width : Math.abs(bar?.height ?? NaN) };
}

type SeriesLike = Record<string, unknown> & {
  id?: string;
  name?: string;
  type?: string;
  markLine?: { data: Array<Record<string, unknown>>; blur: unknown; silent: boolean };
  markArea?: {
    data: Array<Array<Record<string, unknown>>>;
    blur: unknown;
    silent: boolean;
    z?: number;
  };
};
const seriesOf = (o: EChartsOption) => (o.series as SeriesLike[]) ?? [];
const carrierOf = (o: EChartsOption) => seriesOf(o).find((s) => s.id === REFERENCE_CARRIER_ID);

describe("applyReferenceMarks value-axis extent (probed on real ECharts)", () => {
  it("a mark inside the data range leaves the extent identical, zero kept", () => {
    const without = measure(build("bar", null)).extent;
    expect(without).toEqual([0, 40]);
    expect(measure(build("bar", lines(20))).extent).toEqual(without);
  });

  it("a mark above the data widens the extent to include it, zero still kept", () => {
    const [lo, hi] = measure(build("bar", lines(95))).extent;
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThanOrEqual(95);
  });

  it("a band above the data widens the extent to its upper end", () => {
    const marks: ReferenceMarks = { lines: [], bands: [{ from: 60, to: 120 }] };
    expect(measure(build("line", marks)).extent[1]).toBeGreaterThanOrEqual(120);
  });

  it("a mark below the data extends a line chart's extent down to it", () => {
    expect(measure(build("line", lines(-30))).extent[0]).toBeLessThanOrEqual(-30);
  });
});

describe("applyReferenceMarks carrier does not disturb the chart", () => {
  it("bar width is unchanged with marks (bar)", () => {
    const base = measure(build("bar", null)).barSize;
    expect(base).toBeGreaterThan(0);
    expect(measure(build("bar", lines(20))).barSize).toBe(base);
  });

  it("bar width is unchanged with marks (histogram, count axis)", () => {
    const opts: Opts = {
      fieldMapping: { xAxis: "amount" },
      data: [
        ["a", "1", ""],
        ["b", "2", ""],
        ["c", "9", ""],
        ["d", "9", ""],
      ],
    };
    const base = measure(build("histogram", null, opts)).barSize;
    expect(base).toBeGreaterThan(0);
    expect(measure(build("histogram", lines(1), opts)).barSize).toBe(base);
  });

  it("the overlay is still drawn, and the single-series tooltip trigger is unchanged", () => {
    const overlay: ChartOverlay = { label: "vs 7d", points: [["Mon", 3]] };
    const withMarks = build("line", lines(20), { overlay });
    const without = build("line", null, { overlay });
    expect(seriesOf(withMarks).map((s) => s.name)).toContain("vs 7d");
    expect(seriesOf(withMarks)).toHaveLength(seriesOf(without).length + 1);
    expect(withMarks.tooltip).toEqual(without.tooltip);
  });

  it("the carrier is a nameless line series outside the legend, silent with no tooltip", () => {
    const option = build("bar", { lines: [{ value: 20 }], bands: [{ from: 0, to: 10 }] });
    const carrier = carrierOf(option) as SeriesLike;
    expect(carrier.type).toBe("line");
    expect(carrier.name).toBeUndefined();
    expect(carrier).toMatchObject({
      silent: true,
      data: [],
      tooltip: { show: false },
      emphasis: { disabled: true },
    });
    const legend = option.legend as { data?: unknown[] };
    expect(JSON.stringify(legend.data ?? [])).not.toContain(REFERENCE_CARRIER_ID);
  });

  it("pins blur opacities so hovering a data series does not fade the marks", () => {
    const option = build("bar", { lines: [{ value: 20 }], bands: [{ from: 0, to: 10 }] });
    const carrier = carrierOf(option) as SeriesLike;
    expect(carrier.markLine?.blur).toEqual({ lineStyle: { opacity: 1 }, label: { opacity: 1 } });
    expect(carrier.markArea?.blur).toEqual({
      itemStyle: { opacity: REFERENCE_BAND_OPACITY },
      label: { opacity: 1 },
    });
    expect(carrier.markLine?.silent).toBe(true);
    expect(carrier.markArea?.silent).toBe(true);
    expect(REFERENCE_BAND_OPACITY).toBe(0.12);
  });

  it("a multi-series chart keeps its axis tooltip and a real series first", () => {
    const option = build("bar", lines(20), {
      fieldMapping: { xAxis: "day", yAxis: "amount", series: "region" },
    });
    expect(seriesOf(option).length).toBeGreaterThan(2);
    expect((option.tooltip as { trigger?: string }).trigger).toBe("axis");
    expect(seriesOf(option)[0].id).not.toBe(REFERENCE_CARRIER_ID);
  });
});

describe("applyReferenceMarks axis and chart-type rules", () => {
  it("a horizontal bar puts the marks on the x (value) axis", () => {
    const option = build("bar", lines(95), {
      chartOptions: { bar: { orientation: "horizontal" } },
    });
    const line = (carrierOf(option) as SeriesLike).markLine?.data[0] as Record<string, unknown>;
    expect(line).toMatchObject({ xAxis: 95 });
    expect(line.yAxis).toBeUndefined();
    expect((option.xAxis as { dataMax?: number }).dataMax).toBe(95);
    expect((option.yAxis as { dataMax?: number }).dataMax).toBeUndefined();
    expect(measure(option, "xAxis").extent[1]).toBeGreaterThanOrEqual(95);
  });

  it("a vertical chart puts the marks on the y axis", () => {
    const option = build("line", lines(95));
    expect((carrierOf(option) as SeriesLike).markLine?.data[0]).toMatchObject({ yAxis: 95 });
    expect((option.yAxis as { dataMax?: number }).dataMax).toBe(95);
  });

  it("is not applied to pie, heatmap or a normalized stacked bar, and not without marks", () => {
    const heat = { fieldMapping: { xAxis: "day", series: "region", yAxis: "amount" } };
    for (const [type, opts] of [
      ["pie", {}],
      ["heatmap", heat],
      ["bar", { chartOptions: { bar: { stacking: "normalized" } } }],
    ] as const) {
      const option = build(type, lines(95), opts as Opts);
      expect(carrierOf(option)).toBeUndefined();
      expect(JSON.stringify(option)).not.toContain("dataMax");
    }
    expect(carrierOf(build("bar", { lines: [], bands: [] }))).toBeUndefined();
    expect(carrierOf(build("bar", null))).toBeUndefined();
  });

  it("draws on scatter, line and histogram too", () => {
    expect(
      carrierOf(
        build("scatter", lines(10), { fieldMapping: { xAxis: "amount", yAxis: "amount" } }),
      ),
    ).toBeDefined();
    expect(carrierOf(build("line", lines(10)))).toBeDefined();
    expect(
      carrierOf(build("histogram", lines(10), { fieldMapping: { xAxis: "amount" } })),
    ).toBeDefined();
  });
});

describe("applyReferenceMarks styling", () => {
  it("maps each tone to its theme hex token, neutral to the muted text token", () => {
    const marks: ReferenceMarks = {
      lines: [
        { value: 1 },
        { value: 2, tone: "neutral" },
        { value: 3, tone: "success" },
        { value: 4, tone: "warning" },
        { value: 5, tone: "error" },
      ],
      bands: [],
    };
    const data = (carrierOf(build("line", marks)) as SeriesLike).markLine?.data as Array<{
      lineStyle: { color: string; type: string; width: number };
      label: { color: string };
    }>;
    expect(data.map((d) => d.lineStyle.color)).toEqual([
      "#778899",
      "#778899",
      "#4cc38a",
      "#f5b944",
      "#f17b67",
    ]);
    expect(data.map((d) => d.label.color)).toEqual(data.map((d) => d.lineStyle.color));
    expect(data.every((d) => d.lineStyle.type === "solid" && d.lineStyle.width === 1.5)).toBe(true);
  });

  it("labels a line with its label, else the formatted value; a band shows only its own label", () => {
    const marks: ReferenceMarks = {
      lines: [{ value: 95, label: "SLO" }, { value: 12.345 }],
      bands: [
        { from: 0, to: 5, label: "OK", tone: "success" },
        { from: 5, to: 9 },
      ],
    };
    const carrier = carrierOf(build("bar", marks)) as SeriesLike;
    const formatters = (carrier.markLine?.data ?? []).map(
      (d) => (d.label as { formatter: string }).formatter,
    );
    expect(formatters).toEqual(["SLO", "12.35"]);
    const [first, second] = carrier.markArea?.data ?? [];
    expect(first[0]).toMatchObject({ itemStyle: { color: "#4cc38a", opacity: 0.12 } });
    expect(second[0]).not.toHaveProperty("label");
    expect(first[1]).toMatchObject({ yAxis: 5 });
    const labelled = seriesOf(build("bar", marks)).find((s) => s.id === REFERENCE_LABEL_CARRIER_ID);
    expect(labelled?.markArea?.data).toHaveLength(1);
    expect(labelled?.markArea?.data[0][0]).toMatchObject({
      label: { show: true, formatter: "OK" },
    });
  });

  it("never emits a color-mix or surface colour (C1)", () => {
    const marks: ReferenceMarks = {
      lines: [{ value: 1, tone: "warning" }],
      bands: [{ from: 0, to: 1, tone: "error" }],
    };
    expect(JSON.stringify(carrierOf(build("bar", marks)))).not.toMatch(/color-mix|var\(|surface/i);
  });
});

describe("band labels paint above the data (HEL-1306 cycle 2)", () => {
  const banded: ReferenceMarks = { lines: [], bands: [{ from: 0, to: 20, label: "Healthy" }] };

  /** z of the rendered band-label text and of every bar rect, from the real zrender display list. */
  function zOrder(option: EChartsOption) {
    const chart = echarts.init(null as never, undefined, {
      renderer: "svg",
      ssr: true,
      width: 600,
      height: 400,
    });
    chart.setOption(option);
    const list = chart.getZr().storage.getDisplayList(true) as Array<{
      type?: string;
      z?: number;
      style?: { text?: string };
    }>;
    const label = list.find((e) => e.style?.text === "Healthy");
    const bars = list.filter((e) => e.type === "rect" && e.z === 2);
    chart.dispose();
    return { labelZ: label?.z, barZ: bars.length > 0 ? 2 : undefined };
  }

  it("the label element's z is above the bars' z (display list)", () => {
    const { labelZ, barZ } = zOrder(build("bar", banded));
    expect(barZ).toBe(2);
    expect(labelZ).toBe(BAND_LABEL_Z);
    expect(labelZ).toBeGreaterThan(barZ as number);
  });

  it("the fill markArea stays under the bars and carries no label", () => {
    const fill = carrierOf(build("bar", banded)) as SeriesLike;
    expect(fill.markArea?.z).toBeUndefined();
    expect(JSON.stringify(fill.markArea?.data)).not.toContain("Healthy");
    const labels = seriesOf(build("bar", banded)).find((s) => s.id === REFERENCE_LABEL_CARRIER_ID);
    expect(labels).toBeDefined();
  });

  it("compact mode hides band labels but keeps line labels", () => {
    const marks: ReferenceMarks = { lines: [{ value: 5, label: "SLO" }], bands: banded.bands };
    const option = build("bar", marks, { compact: true });
    expect(seriesOf(option).find((s) => s.id === REFERENCE_LABEL_CARRIER_ID)).toBeUndefined();
    expect(JSON.stringify(option.series)).not.toContain("Healthy");
    expect(JSON.stringify(carrierOf(option))).toContain("SLO");
  });

  it("a band without a label adds no label carrier", () => {
    const option = build("bar", { lines: [], bands: [{ from: 0, to: 5 }] });
    expect(seriesOf(option).find((s) => s.id === REFERENCE_LABEL_CARRIER_ID)).toBeUndefined();
  });
});

describe("line labels carry a legibility halo (HEL-1306 final gate)", () => {
  it("every line label has the surface text halo, like band labels", () => {
    const option = build("bar", {
      lines: [{ value: 25 }, { value: 5, label: "SLO" }],
      bands: [{ from: 0, to: 9, label: "OK" }],
    });
    const lineLabels = (carrierOf(option) as SeriesLike).markLine?.data.map(
      (d) => d.label,
    ) as Array<Record<string, unknown>>;
    expect(lineLabels).toHaveLength(2);
    for (const l of lineLabels) {
      expect(l).toMatchObject({ textBorderColor: tokens.surfaceStrong, textBorderWidth: 3 });
    }
    const bandLabel = seriesOf(option).find((s) => s.id === REFERENCE_LABEL_CARRIER_ID)?.markArea
      ?.data[0][0].label;
    expect(bandLabel).toMatchObject({ textBorderColor: tokens.surfaceStrong, textBorderWidth: 3 });
  });
});
