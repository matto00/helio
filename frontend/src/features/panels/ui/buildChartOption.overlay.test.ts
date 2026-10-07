import { defaultChartAppearance } from "../../../theme/appearance";
import type { ChartThemeTokens } from "../../../utils/chartAppearance";
import type { ChartTypeOptionsMap, PanelAppearance } from "../types/panel";
import type { ChartOverlay } from "../history/chartOverlay";
import {
  buildChartOption,
  COMPACT_AXIS_LABEL_FONT_SIZE,
  COMPACT_GRID_INSET_PX,
  COMPACT_LEGEND_CLEARANCE_HORIZONTAL_PX,
  COMPACT_LEGEND_CLEARANCE_VERTICAL_PX,
} from "./buildChartOption";

const themeTokens: ChartThemeTokens = {
  surfaceStrong: "#1a1d24",
  borderSubtle: "#d0d5dd",
  text: "#abcdef",
  fontSans: "Inter, sans-serif",
  fontMono: "ui-monospace, monospace",
  shadowSoft: "0 1px 2px rgba(0,0,0,0.1)",
  radiusMd: "8px",
  accentStrong: "#ea580c",
  textMuted: "#778899",
};

const rows = [
  ["Mon", "10", "east"],
  ["Tue", "20", "west"],
  ["Wed", "30", "east"],
];

function appearanceFor(
  chartType: "line" | "bar" | "pie" | "scatter",
  legend: Partial<typeof defaultChartAppearance.legend> = {},
): PanelAppearance {
  return {
    background: "transparent",
    color: "inherit",
    transparency: 0,
    chart: {
      ...defaultChartAppearance,
      chartType,
      legend: { ...defaultChartAppearance.legend, ...legend },
    },
  };
}

function build(
  chartType: "line" | "bar" | "pie" | "scatter",
  overlay: ChartOverlay | null,
  extra: {
    chartOptions?: ChartTypeOptionsMap;
    fieldMapping?: Record<string, string>;
    compact?: boolean;
    legendPosition?: "top" | "bottom" | "left" | "right";
    legendShow?: boolean;
  } = {},
) {
  return buildChartOption({
    appearance: appearanceFor(chartType, {
      ...(extra.legendPosition ? { position: extra.legendPosition } : {}),
      ...(extra.legendShow !== undefined ? { show: extra.legendShow } : {}),
    }),
    rawRows: rows,
    headers: ["day", "amount", "region"],
    fieldMapping: extra.fieldMapping ?? { xAxis: "day", yAxis: "amount" },
    chartOptions: extra.chartOptions,
    overlay,
    effectiveCompact: extra.compact ?? false,
    measuredPieLegendOverlap: false,
    themeTokens,
    theme: "dark",
  });
}

type SeriesLike = {
  name?: string;
  type?: string;
  data?: unknown[];
  stack?: string;
  z?: number;
  lineStyle?: { type?: string; color?: string };
  itemStyle?: { color?: string; opacity?: number };
};
const seriesOf = (o: { series?: unknown }) => (o.series as SeriesLike[]) ?? [];

const overlay: ChartOverlay = {
  label: "vs 7d",
  points: [
    ["Mon", 3],
    ["Wed", 5],
  ],
};

describe("buildChartOption overlay (HEL-1277)", () => {
  it("line: appends a dashed, muted, subordinate series aligned to the primary categories", () => {
    const series = seriesOf(build("line", overlay));
    expect(series).toHaveLength(2);
    expect(series[1]).toMatchObject({
      type: "line",
      name: "vs 7d",
      data: [3, null, 5],
      z: 1,
      lineStyle: { type: "dashed", color: "#778899" },
    });
    expect(series[1].stack).toBeUndefined();
  });

  it("bar: appends a muted translucent series, not stacked", () => {
    const series = seriesOf(
      build("bar", overlay, { chartOptions: { bar: { stacking: "stacked" } } }),
    );
    expect(series).toHaveLength(2);
    expect(series[1].name).toBe("vs 7d");
    // Translucent fill inside an OPAQUE boundary (the boundary carries the 3:1 non-text contrast;
    // `itemStyle.opacity` would fade it too).
    expect(series[1].itemStyle).toMatchObject({
      color: "rgba(119, 136, 153, 0.45)",
      borderColor: "#778899",
      borderWidth: 1,
    });
    expect((series[1].itemStyle as { opacity?: number }).opacity).toBeUndefined();
    expect(series[1].stack).toBeUndefined();
  });

  it("lists the overlay in the legend (the data option names its legend entries)", () => {
    const legend = build("line", overlay).legend as { data?: string[]; show?: boolean };
    expect(legend.data).toEqual(["amount", "vs 7d"]);
  });

  it("makes the tooltip axis-triggered so the overlay appears in it", () => {
    expect((build("line", overlay).tooltip as { trigger?: string }).trigger).toBe("axis");
  });

  it("hover emphasis passes see the overlay series", () => {
    const series = seriesOf(build("line", overlay)) as Array<SeriesLike & { emphasis?: unknown }>;
    expect(series[1].emphasis).toBeDefined();
  });

  it("gives a null / over-256-char-truncated x a null overlay value (pinned behaviour)", () => {
    const nullX: ChartOverlay = {
      label: "vs 7d",
      points: [
        [null, 9],
        ["Tue", 4],
      ],
    };
    expect(seriesOf(build("line", nullX))[1].data).toEqual([null, 4, null]);
    const longX = "x".repeat(300);
    const truncated: ChartOverlay = {
      label: "vs 7d",
      points: [
        [longX, 9],
        ["Wed", 1],
      ],
    };
    expect(seriesOf(build("line", truncated))[1].data).toEqual([null, null, 1]);
  });

  it("keeps null y values as gaps", () => {
    const o: ChartOverlay = {
      label: "vs 7d",
      points: [
        ["Mon", null],
        ["Tue", 2],
      ],
    };
    expect(seriesOf(build("line", o))[1].data).toEqual([null, 2, null]);
  });

  it.each([
    ["pie", () => build("pie", overlay)],
    ["scatter", () => build("scatter", overlay)],
    [
      "multi-series primary",
      () =>
        build("line", overlay, {
          fieldMapping: { xAxis: "day", yAxis: "amount", series: "region" },
        }),
    ],
    [
      "normalized stacking",
      () => build("bar", overlay, { chartOptions: { bar: { stacking: "normalized" } } }),
    ],
    [
      "horizontal bars",
      () => build("bar", overlay, { chartOptions: { bar: { orientation: "horizontal" } } }),
    ],
    ["no matching category", () => build("line", { label: "vs 7d", points: [["Sun", 1]] })],
    ["no overlay", () => build("line", null)],
  ])("ignores the overlay: %s", (_name, make) => {
    const names = seriesOf(make()).map((s) => s.name);
    expect(names).not.toContain("vs 7d");
  });

  it("compact with no drawn overlay keeps the legend hidden (F-026/F-028 unchanged)", () => {
    const o = build("line", null, { compact: true });
    expect((o.legend as { show?: boolean }).show).toBe(false);
    const noMatch = build("line", { label: "vs 7d", points: [["Sun", 1]] }, { compact: true });
    expect((noMatch.legend as { show?: boolean }).show).toBe(false);
    expect((o.grid as { top: number }).top).toBe(COMPACT_GRID_INSET_PX);
  });

  describe("compact legend with a drawn overlay (HEL-1351)", () => {
    it("keeps a compact, scrolling legend that lists the overlay", () => {
      const o = build("line", overlay, { compact: true });
      const legend = o.legend as {
        show?: boolean;
        type?: string;
        itemHeight?: number;
        textStyle?: { fontSize?: number };
      };
      expect(legend.show).toBe(true);
      expect(legend.type).toBe("scroll");
      expect(legend.itemHeight).toBeLessThan(14);
      expect(legend.textStyle?.fontSize).toBe(COMPACT_AXIS_LABEL_FONT_SIZE);
      expect(seriesOf(o).map((s) => s.name)).toContain("vs 7d");
    });

    it("enlarges the grid inset on the legend's side only (top by default)", () => {
      const o = build("bar", overlay, { compact: true });
      const grid = o.grid as { top: number; bottom: number; left: number; right: number };
      expect(grid.top).toBe(COMPACT_GRID_INSET_PX + COMPACT_LEGEND_CLEARANCE_HORIZONTAL_PX);
      expect(grid.bottom).toBe(COMPACT_GRID_INSET_PX);
      expect(grid.left).toBe(COMPACT_GRID_INSET_PX);
      expect(grid.right).toBe(COMPACT_GRID_INSET_PX);
    });

    it("honours a stored legend position", () => {
      const o = build("bar", overlay, { compact: true, legendPosition: "bottom" });
      const grid = o.grid as { top: number; bottom: number };
      expect(grid.bottom).toBe(COMPACT_GRID_INSET_PX + COMPACT_LEGEND_CLEARANCE_HORIZONTAL_PX);
      expect(grid.top).toBe(COMPACT_GRID_INSET_PX);
      const right = build("bar", overlay, { compact: true, legendPosition: "right" });
      expect((right.grid as { right: number }).right).toBe(
        COMPACT_GRID_INSET_PX + COMPACT_LEGEND_CLEARANCE_VERTICAL_PX,
      );
    });

    it("an explicitly hidden legend stays hidden and the grid is not enlarged", () => {
      const o = build("line", overlay, { compact: true, legendShow: false });
      expect((o.legend as { show?: boolean }).show).toBe(false);
      expect((o.grid as { top: number }).top).toBe(COMPACT_GRID_INSET_PX);
      expect(seriesOf(o).map((s) => s.name)).toContain("vs 7d");
    });
  });
});
