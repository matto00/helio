import { render, screen } from "@testing-library/react";

import { defaultChartAppearance, defaultPanelAppearance } from "../../../theme/appearance";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import type { ChartType } from "../../../utils/chartAppearance";
import { ChartPanel } from "./ChartPanel";

// HEL-1584 D10 -- a refresh that changes only the data updates the chart in place (merge, series replaced by id) so it
// morphs; any change of shape fully replaces it, so no stale nested option survives.
jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ notMerge, replaceMerge }: { notMerge?: boolean; replaceMerge?: string[] }) => (
    <div
      data-testid="echarts"
      data-not-merge={String(notMerge)}
      data-replace-merge={JSON.stringify(replaceMerge ?? null)}
    />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

const headers = ["day", "amount"];
const rows = (n: number) => Array.from({ length: n }, (_, i) => [`d${i}`, String(10 + i)]);
const mapping = { xAxis: "day", yAxis: "amount" };

type Appearance = NonNullable<Parameters<typeof ChartPanel>[0]>["appearance"];
const appearanceOf = (chartType: ChartType, chart: Record<string, unknown> = {}): Appearance => ({
  ...defaultPanelAppearance,
  chart: { ...defaultChartAppearance, chartType, ...chart },
});

function view(appearance: Appearance, rawRows = rows(3)) {
  return (
    <ThemeProvider>
      <ChartPanel
        appearance={appearance}
        headers={headers}
        rawRows={rawRows}
        fieldMapping={mapping}
      />
    </ThemeProvider>
  );
}
const merging = () => {
  const node = screen.getByTestId("echarts");
  return {
    notMerge: node.getAttribute("data-not-merge"),
    replaceMerge: node.getAttribute("data-replace-merge"),
  };
};
const REPLACE = { notMerge: "true", replaceMerge: "null" };
const MERGE = { notMerge: "false", replaceMerge: '["series"]' };

describe("ChartPanel refresh morph (HEL-1584 D10)", () => {
  it("the first render replaces (nothing is committed yet)", () => {
    render(view(appearanceOf("line")));
    expect(merging()).toEqual(REPLACE);
  });

  it("a data-only refresh merges, replacing the series by id", () => {
    const { rerender } = render(view(appearanceOf("line"), rows(3)));
    rerender(view(appearanceOf("line"), rows(5)));
    expect(merging()).toEqual(MERGE);
  });

  it("an equal-but-rebuilt option (new formatter closures, identical source) still merges", () => {
    const { rerender } = render(view(appearanceOf("line"), rows(3)));
    rerender(view(appearanceOf("line"), rows(3)));
    expect(merging()).toEqual(MERGE);
  });

  it.each([
    ["line", "bar"],
    ["bar", "pie"],
    ["pie", "bar"],
    ["line", "heatmap"],
    ["bar", "histogram"],
    ["histogram", "scatter"],
    ["scatter", "line"],
  ] as const)("switching %s -> %s fully replaces", (from, to) => {
    const { rerender } = render(view(appearanceOf(from)));
    rerender(view(appearanceOf(to)));
    expect(merging()).toEqual(REPLACE);
  });

  it("removing an axis name (same chart type) fully replaces, so the stale name cannot survive", () => {
    const named = {
      axisLabels: { x: { show: true, label: "Day" }, y: { show: true, label: "Amount" } },
    };
    const unnamed = { axisLabels: { x: { show: true, label: "" }, y: { show: true, label: "" } } };
    const { rerender } = render(view(appearanceOf("line", named)));
    rerender(view(appearanceOf("line", unnamed)));
    expect(merging()).toEqual(REPLACE);
  });

  it("removing a configured chart option (same chart type) fully replaces", () => {
    const withOptions = (
      chartOptions: NonNullable<Parameters<typeof ChartPanel>[0]>["chartOptions"],
    ) => (
      <ThemeProvider>
        <ChartPanel
          appearance={appearanceOf("line")}
          headers={headers}
          rawRows={rows(3)}
          fieldMapping={mapping}
          chartOptions={chartOptions}
        />
      </ThemeProvider>
    );
    const { rerender } = render(withOptions({ line: { smooth: true } }));
    rerender(withOptions(undefined));
    expect(merging()).toEqual(REPLACE);
  });

  it("merges again after a replace once the new shape is committed", () => {
    const { rerender } = render(view(appearanceOf("line")));
    rerender(view(appearanceOf("bar")));
    expect(merging()).toEqual(REPLACE);
    rerender(view(appearanceOf("bar"), rows(6)));
    expect(merging()).toEqual(MERGE);
  });
});
