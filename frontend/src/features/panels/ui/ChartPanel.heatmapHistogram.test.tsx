import { render, renderHook, screen } from "@testing-library/react";

import { defaultChartAppearance, defaultPanelAppearance } from "../../../theme/appearance";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import type { ChartType } from "../../../utils/chartAppearance";
import { ChartPanel } from "./ChartPanel";
import { useHeatmapDefaultCursor } from "./useHeatmapDefaultCursor";

// HEL-1311 -- a heatmap cell / histogram bar is not clickable: a click selects nothing but is still
// swallowed (it must not fall through to the panel's open-Customize handler), and the heatmap
// canvas cursor is forced back to default (its view ignores a series `cursor`).
type MockClickHandlers = Record<string, (params: unknown) => void>;
interface MockChartNode extends HTMLDivElement {
  __onEvents?: MockClickHandlers;
}

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ onEvents }: { onEvents?: MockClickHandlers }) => (
    <div
      ref={(el) => {
        if (el) (el as MockChartNode).__onEvents = onEvents;
      }}
      data-testid="echarts"
    />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

const headers = ["day", "test", "n"];
const rawRows = [["Mon", "a", "1"]];

function chartNode(chartType: ChartType, onDataPointSelect: jest.Mock) {
  render(
    <ThemeProvider>
      <ChartPanel
        appearance={{
          ...defaultPanelAppearance,
          chart: { ...defaultChartAppearance, chartType },
        }}
        headers={headers}
        rawRows={rawRows}
        fieldMapping={{ xAxis: "day", series: "test", yAxis: "n" }}
        onDataPointSelect={onDataPointSelect}
      />
    </ThemeProvider>,
  );
  return screen.getByTestId("echarts") as MockChartNode;
}

describe("ChartPanel clicks on heatmap/histogram (HEL-1311)", () => {
  it.each(["heatmap", "histogram"] as const)(
    "stores no selection for a %s element but still stops propagation",
    (type) => {
      const select = jest.fn();
      const stop = jest.fn();
      chartNode(type, select).__onEvents?.click({
        componentType: "series",
        name: "Mon",
        value: [0, 0, 1],
        event: { event: { stopPropagation: stop } },
      });
      expect(select).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalled();
    },
  );

  it("control: a bar click still selects", () => {
    const select = jest.fn();
    chartNode("bar", select).__onEvents?.click({
      componentType: "series",
      name: "Mon",
      seriesName: "n",
    });
    expect(select).toHaveBeenCalled();
  });
});

describe("useHeatmapDefaultCursor", () => {
  function fakeChart() {
    const zr = { on: jest.fn(), setCursorStyle: jest.fn() };
    return { zr, chart: { getZr: () => zr } };
  }
  function moveOver(zr: ReturnType<typeof fakeChart>["zr"]) {
    expect(zr.on).toHaveBeenCalledWith("mousemove", expect.any(Function));
    (zr.on.mock.calls[0][1] as () => void)();
  }

  it("resets the canvas cursor on mousemove while the type is heatmap", () => {
    const { zr, chart } = fakeChart();
    const { result } = renderHook(() => useHeatmapDefaultCursor(true));
    result.current(chart);
    moveOver(zr);
    expect(zr.setCursorStyle).toHaveBeenCalledWith("default");
  });

  it("leaves the cursor alone for any other chart type", () => {
    const { zr, chart } = fakeChart();
    const { result } = renderHook(() => useHeatmapDefaultCursor(false));
    result.current(chart);
    moveOver(zr);
    expect(zr.setCursorStyle).not.toHaveBeenCalled();
  });

  it("follows a type change without re-registering (the callback stays stable)", () => {
    const { zr, chart } = fakeChart();
    const { result, rerender } = renderHook(({ heat }) => useHeatmapDefaultCursor(heat), {
      initialProps: { heat: false },
    });
    const first = result.current;
    first(chart);
    rerender({ heat: true });
    expect(result.current).toBe(first);
    moveOver(zr);
    expect(zr.setCursorStyle).toHaveBeenCalledWith("default");
  });
});
