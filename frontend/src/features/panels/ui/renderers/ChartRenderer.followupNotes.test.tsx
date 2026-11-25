// HEL-1517 -- footnotes that apply together render on one line, in a fixed order.
import { render, screen } from "@testing-library/react";

import { defaultChartAppearance, defaultPanelAppearance } from "../../../../theme/appearance";
import { ThemeProvider } from "../../../../theme/ThemeProvider";
import { settleChartMount } from "../../../../test/settleChartMount";
import { ChartRenderer } from "./ChartRenderer";

jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: () => <div data-testid="echarts" />,
}));

function renderChart(
  chartType: "line" | "scatter",
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
  fieldTypes: Record<string, string>,
) {
  return render(
    <ThemeProvider>
      <ChartRenderer
        appearance={{ ...defaultPanelAppearance, chart: { ...defaultChartAppearance, chartType } }}
        headers={headers}
        rawRows={rows}
        fieldMapping={mapping}
        fieldTypes={fieldTypes}
      />
    </ThemeProvider>,
  );
}

describe("ChartRenderer chart footnotes (HEL-1517)", () => {
  it("joins the no-readable-date note and the summed-rows note on one line", async () => {
    const { container } = renderChart(
      "line",
      ["day", "amount", "region"],
      [
        ["2026-10-01", "2", "A"],
        ["2026-10-01T00:00:00Z", "5", "A"],
        ["n/a", "1", "A"],
      ],
      { xAxis: "day", yAxis: "amount", series: "region" },
      { day: "timestamp" },
    );
    await settleChartMount();
    screen.getByTestId("echarts");
    const notes = container.querySelectorAll(".chart-panel__skipped-note");
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe(
      "1 row with no readable date not shown. 2 rows with the same time and series were added together.",
    );
    expect(notes[0].getAttribute("title")).toBe(notes[0].textContent);
  });

  it("shows the summed-rows note alone on a category chart", async () => {
    renderChart(
      "line",
      ["day", "amount", "region"],
      [
        ["Mon", "3", "A"],
        ["Mon", "4", "A"],
      ],
      { xAxis: "day", yAxis: "amount", series: "region" },
      { day: "string" },
    );
    await settleChartMount();
    screen.getByTestId("echarts");
    expect(
      screen.getByText("2 rows with the same x value and series were added together."),
    ).toBeInTheDocument();
  });

  it("shows the no-numeric-x note for a scatter", async () => {
    renderChart(
      "scatter",
      ["x", "y"],
      [
        ["1", "10"],
        ["abc", "20"],
      ],
      { xAxis: "x", yAxis: "y" },
      { x: "string" },
    );
    await settleChartMount();
    screen.getByTestId("echarts");
    expect(screen.getByText("1 row with no numeric x value not shown.")).toBeInTheDocument();
  });
});
