import { render, screen } from "@testing-library/react";

import { ThemeProvider } from "../../../theme/ThemeProvider";
import { ChartPanel } from "./ChartPanel";

// Same stash-the-onEvents mock as `ChartPanel.click.test.tsx`: the click handler is invoked with
// constructed ECharts params, which is what a real mark click reports (componentType markLine/markArea).
type MockClickHandlers = Record<string, (params: unknown) => void>;
interface MockChartNode extends HTMLDivElement {
  __onEvents?: MockClickHandlers;
}

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option, onEvents }: { option: unknown; onEvents?: MockClickHandlers }) => (
    <div
      ref={(el) => {
        if (el) (el as MockChartNode).__onEvents = onEvents;
      }}
      data-testid="echarts"
      data-option={JSON.stringify(option)}
    />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

const headers = ["quarter", "revenue"];
const rawRows = [
  ["Q1", "100"],
  ["Q2", "200"],
];
const fieldMapping = { xAxis: "quarter", yAxis: "revenue" };

function renderChart(props: Parameters<typeof ChartPanel>[0]) {
  render(
    <ThemeProvider>
      <ChartPanel {...props} />
    </ThemeProvider>,
  );
  return screen.getByTestId("echarts") as MockChartNode;
}

describe("ChartPanel reference marks (HEL-1306)", () => {
  it("threads referenceMarks into the built option as a carrier series", () => {
    const node = renderChart({
      rawRows,
      headers,
      fieldMapping,
      referenceMarks: { lines: [{ value: 95, label: "SLO" }], bands: [] },
    });
    const option = JSON.parse(node.getAttribute("data-option") ?? "{}") as {
      series: Array<{ id?: string; markLine?: { data: unknown[] } }>;
    };
    const carrier = option.series.find((s) => s.id === "__helio_reference_marks__");
    expect(carrier?.markLine?.data).toHaveLength(1);
  });

  it.each(["markLine", "markArea"])(
    "a %s click makes no selection and does not stop the panel-body handler",
    (componentType) => {
      const onDataPointSelect = jest.fn();
      const stopPropagation = jest.fn();
      const node = renderChart({
        rawRows,
        headers,
        fieldMapping,
        onDataPointSelect,
        referenceMarks: { lines: [{ value: 95 }], bands: [{ from: 0, to: 10 }] },
      });
      node.__onEvents?.click({ componentType, event: { event: { stopPropagation } } });
      expect(onDataPointSelect).not.toHaveBeenCalled();
      expect(stopPropagation).not.toHaveBeenCalled();
    },
  );
});
