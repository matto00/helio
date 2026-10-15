import { render, screen } from "@testing-library/react";

import { defaultChartAppearance, defaultPanelAppearance } from "../../../../theme/appearance";
import { ThemeProvider } from "../../../../theme/ThemeProvider";
import { settleChartMount } from "../../../../test/settleChartMount";
import type { GroupedAggregate } from "../../../../utils/aggregate";
import { ChartRenderer } from "./ChartRenderer";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: () => <div data-testid="echarts" />,
}));

const headers = ["day", "amount"];
const rows = [
  ["2026-10-01", "1"],
  ["n/a", "2"],
  ["", "3"],
  ["2026-10-03", "4"],
];

function renderChart(
  chartType: "line" | "bar" | "histogram",
  props: {
    fieldTypes?: Record<string, string>;
    rawRows?: string[][];
    chartAggregate?: GroupedAggregate;
    truncationNote?: string;
  } = {},
) {
  return render(
    <ThemeProvider>
      <ChartRenderer
        appearance={{ ...defaultPanelAppearance, chart: { ...defaultChartAppearance, chartType } }}
        headers={headers}
        rawRows={props.rawRows ?? rows}
        fieldMapping={{ xAxis: "day", yAxis: "amount" }}
        fieldTypes={props.fieldTypes}
        chartAggregate={props.chartAggregate}
        truncationNote={props.truncationNote}
      />
    </ThemeProvider>,
  );
}

describe("ChartRenderer omitted-x note (HEL-1508)", () => {
  it("states how many rows a time axis left out", async () => {
    renderChart("line", { fieldTypes: { day: "timestamp" } });
    await settleChartMount();
    screen.getByTestId("echarts");
    expect(screen.getByText("2 rows with no readable date not shown.")).toBeInTheDocument();
  });

  it("uses the histogram note's classes and sits after the truncation note", async () => {
    const { container } = renderChart("line", {
      fieldTypes: { day: "timestamp" },
      truncationNote: "Based on the first 200 of 1,000 rows.",
    });
    await settleChartMount();
    screen.getByTestId("echarts");
    const notes = [...container.querySelectorAll(".chart-panel__skipped-note")];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveClass("chart-panel__truncation-note");
    expect(notes[0].previousElementSibling?.textContent).toBe(
      "Based on the first 200 of 1,000 rows.",
    );
  });

  it("states how many aggregate groups had no readable date", async () => {
    renderChart("bar", {
      fieldTypes: { day: "timestamp" },
      chartAggregate: {
        categories: ["2026-10-01", "null"],
        values: [1, 2],
        groupBy: "day",
        seriesName: "sum",
      },
    });
    await settleChartMount();
    screen.getByTestId("echarts");
    expect(screen.getByText("1 group with no readable date not shown.")).toBeInTheDocument();
  });

  it("shows no note on a category chart", async () => {
    renderChart("line", { fieldTypes: { day: "string" } });
    await settleChartMount();
    screen.getByTestId("echarts");
    expect(screen.queryByText(/no readable date/)).not.toBeInTheDocument();
  });

  it("shows no note when nothing was left out", async () => {
    renderChart("line", {
      fieldTypes: { day: "timestamp" },
      rawRows: [
        ["2026-10-01", "1"],
        ["2026-10-02", "2"],
      ],
    });
    await settleChartMount();
    screen.getByTestId("echarts");
    expect(screen.queryByText(/no readable date/)).not.toBeInTheDocument();
  });

  it("shows no note for a repeated-instant bar that falls back to categories", async () => {
    renderChart("bar", {
      fieldTypes: { day: "timestamp" },
      rawRows: [
        ["2026-10-01", "1"],
        ["2026-10-01", "2"],
        ["n/a", "3"],
      ],
    });
    await settleChartMount();
    screen.getByTestId("echarts");
    expect(screen.queryByText(/no readable date/)).not.toBeInTheDocument();
  });
});
