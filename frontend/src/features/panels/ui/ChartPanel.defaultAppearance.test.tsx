import { screen } from "@testing-library/react";

import { defaultChartAppearance } from "../../../theme/appearance";
import { resolveChartTheme } from "../../../utils/chartAppearance";
import type { ChartThemeTokens } from "../../../utils/chartAppearance";
import { buildChartOption } from "./buildChartOption";
import { ChartPanel } from "./ChartPanel";
import { baseAppearance, getOption, renderChart } from "./chartPanelTestHelpers";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

// HEL-1178 — a chart panel with no stored `appearance.chart` renders with the
// default chart appearance's theming (render-time fallback, nothing written).
describe("chart panel with no stored appearance.chart (HEL-1178)", () => {
  const rows = [
    ["2024-01-01", "100"],
    ["2024-01-02", "120"],
  ];

  it("carries the themed tooltip on a single-series chart", () => {
    renderChart(
      <ChartPanel
        appearance={baseAppearance}
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={rows}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      tooltip?: {
        show?: boolean;
        backgroundColor?: string;
        extraCssText?: string;
        textStyle?: { fontFamily?: string };
      };
    };
    const theme = resolveChartTheme();
    expect(option.tooltip?.show).toBe(true);
    expect(option.tooltip?.backgroundColor).toBe(theme.surfaceStrong);
    expect(option.tooltip?.extraCssText).toContain(theme.shadowSoft);
    expect(option.tooltip?.extraCssText).toContain(theme.radiusMd);
    expect(option.tooltip?.textStyle?.fontFamily).toBe(theme.fontMono);
  });
});

describe("buildChartOption chart-less vs explicitly-defaulted (HEL-1178)", () => {
  const lightTokens: ChartThemeTokens = {
    surfaceStrong: "#ffffff",
    borderSubtle: "#d0d5dd",
    text: "#101828",
    fontSans: "Inter, sans-serif",
    fontMono: "ui-monospace, monospace",
    shadowSoft: "0 1px 2px rgba(0,0,0,0.1)",
    radiusMd: "8px",
    accentStrong: "#ea580c",
  };
  const darkTokens: ChartThemeTokens = {
    ...lightTokens,
    surfaceStrong: "#1a1d24",
    text: "#f2f4f7",
  };
  const params = {
    rawRows: [
      ["2020", "10", "A"],
      ["2020", "30", "B"],
      ["2021", "20", "A"],
      ["2021", "40", "B"],
    ],
    headers: ["year", "value", "team"],
    fieldMapping: { xAxis: "year", yAxis: "value", series: "team" },
    effectiveCompact: false,
    measuredPieLegendOverlap: false,
  };

  it.each([
    ["dark", darkTokens],
    ["light", lightTokens],
  ])("matches the explicit default option under %s tokens", (_name, themeTokens) => {
    const absent = buildChartOption({ ...params, appearance: baseAppearance, themeTokens });
    const explicit = buildChartOption({
      ...params,
      appearance: { ...baseAppearance, chart: defaultChartAppearance },
      themeTokens,
    });
    expect(absent).toEqual(explicit);
    expect((absent.tooltip as { backgroundColor?: string }).backgroundColor).toBe(
      themeTokens.surfaceStrong,
    );
  });

  it("matches when appearance itself is undefined", () => {
    const absent = buildChartOption({ ...params, themeTokens: darkTokens });
    const explicit = buildChartOption({
      ...params,
      appearance: {
        ...baseAppearance,
        color: undefined as unknown as string,
        chart: defaultChartAppearance,
      },
      themeTokens: darkTokens,
    });
    expect(absent).toEqual(explicit);
  });

  it("still hides the tooltip when a stored chart sets tooltip.enabled false", () => {
    const option = buildChartOption({
      ...params,
      appearance: {
        ...baseAppearance,
        chart: { ...defaultChartAppearance, tooltip: { enabled: false } },
      },
      themeTokens: darkTokens,
    });
    expect((option.tooltip as { show?: boolean }).show).toBe(false);
  });
});
