import { act, screen } from "@testing-library/react";

import { ChartPanel } from "./ChartPanel";
import { baseChartConfig, getOption, renderChart } from "./chartPanelTestHelpers";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

describe("ChartPanel — compact (HEL-301, phone stack)", () => {
  it("hides the legend when compact is true", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChartConfig, legend: { show: true, position: "top" as const } },
    };
    renderChart(<ChartPanel appearance={appearance} compact />);
    const option = getOption(screen.getByTestId("echarts")) as { legend: { show: boolean } };
    expect(option.legend.show).toBe(false);
  });

  it("does not hide the legend when compact is omitted (desktop default)", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChartConfig, legend: { show: true, position: "top" as const } },
    };
    renderChart(<ChartPanel appearance={appearance} />);
    const option = getOption(screen.getByTestId("echarts")) as { legend: { show: boolean } };
    expect(option.legend.show).toBe(true);
  });

  it("shrinks axis label font size when compact is true", () => {
    const headers = ["date", "price"];
    const rawRows = [["2024-01-01", "100"]];
    renderChart(
      <ChartPanel
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={headers}
        rawRows={rawRows}
        compact
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      xAxis: { axisLabel: { fontSize: number } };
    };
    expect(option.xAxis.axisLabel.fontSize).toBe(10);
  });

  it("does not add axis overrides for a pie chart when compact is true", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChartConfig, chartType: "pie" as const },
    };
    renderChart(<ChartPanel appearance={appearance} compact />);
    const option = getOption(screen.getByTestId("echarts"));
    expect(option.xAxis).toBeUndefined();
    expect(option.yAxis).toBeUndefined();
  });
});

// F-028 — the mobile phone stack squashed the chart's plotted data into a
// near-invisible sliver: `compact` shrank the axisLabel font but the grid
// still used ECharts' own default percentage-based margins, which consumed
// nearly the whole ~140px-tall mobile canvas.
describe("ChartPanel — compact grid sizing (F-028 regression)", () => {
  it("gives the grid an explicit small inset with containLabel in compact mode", () => {
    renderChart(
      <ChartPanel
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
        compact
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      grid?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
        containLabel?: boolean;
      };
    };
    expect(option.grid).toMatchObject({ containLabel: true });
    expect(option.grid?.top).toBeLessThanOrEqual(12);
    expect(option.grid?.right).toBeLessThanOrEqual(12);
    expect(option.grid?.bottom).toBeLessThanOrEqual(12);
    expect(option.grid?.left).toBeLessThanOrEqual(12);
  });

  it("shrinks the axis name font size, not only the tick label font size", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: {
        ...baseChartConfig,
        axisLabels: { x: { show: true, label: "Date" }, y: { show: true, label: "Price" } },
      },
    };
    renderChart(
      <ChartPanel
        appearance={appearance}
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
        compact
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      xAxis: { nameTextStyle?: { fontSize?: number } };
      yAxis: { nameTextStyle?: { fontSize?: number } };
    };
    expect(option.xAxis.nameTextStyle?.fontSize).toBe(10);
    expect(option.yAxis.nameTextStyle?.fontSize).toBe(10);
  });

  it("does not add a grid override for a pie chart in compact mode", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChartConfig, chartType: "pie" as const },
    };
    renderChart(<ChartPanel appearance={appearance} compact />);
    const option = getOption(screen.getByTestId("echarts")) as { grid?: unknown };
    expect(option.grid).toBeUndefined();
  });
});

// F-094/F-026 — `compact` used to be wired only from the mobile-stack-only
// boolean (`MobilePanelStack.tsx` forwards `compact` unconditionally to
// every chart it renders, regardless of the panel's actual height). ECharts'
// canvas-rendered legend/axis chrome can't be reached by a CSS container
// query — it isn't DOM — so this is the JS-side equivalent, measured on the
// chart's own wrapper (not `.panel-card` itself) so a short *chart* inside a
// taller card (e.g. one with a footnote annotation) still triggers it.
describe("ChartPanel — measured compact from ResizeObserver (F-094/F-026)", () => {
  type ObserverCallback = (entries: Array<{ contentRect: { height: number } }>) => void;
  let observerCallback: ObserverCallback | null = null;
  const originalResizeObserver = (global as { ResizeObserver?: unknown }).ResizeObserver;

  beforeEach(() => {
    observerCallback = null;
    class FakeResizeObserver {
      constructor(cb: ObserverCallback) {
        observerCallback = cb;
      }
      observe() {
        /* no-op: the test triggers `observerCallback` manually */
      }
      disconnect() {}
    }
    (global as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  });

  afterEach(() => {
    (global as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
  });

  const appearance = {
    background: "transparent",
    color: "inherit",
    transparency: 0,
    chart: { ...baseChartConfig, legend: { show: true, position: "top" as const } },
  };

  it("hides the legend once the measured wrapper height drops to/below the compact threshold", () => {
    renderChart(<ChartPanel appearance={appearance} />);
    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });

    act(() => {
      observerCallback?.([{ contentRect: { height: 150 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: false } });
  });

  it("leaves the legend alone when the measured height is above the compact threshold", () => {
    renderChart(<ChartPanel appearance={appearance} />);

    act(() => {
      observerCallback?.([{ contentRect: { height: 400 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });
  });

  it("stays compact when the explicit `compact` prop is true regardless of measured size", () => {
    renderChart(<ChartPanel appearance={appearance} compact />);

    act(() => {
      observerCallback?.([{ contentRect: { height: 400 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: false } });
  });

  // F-026's own threshold is higher than the generic compact one: a pie's
  // outer data-labels collide with a top/bottom legend at heights well above
  // where a cartesian chart's axis labels start getting cramped (live-repro'd
  // at ~198px and ~227px canvas height on default-sized, `h: 4`, panels).
  it("hides a pie chart's legend at a measured height above the generic compact threshold but below the pie-specific one", () => {
    const pieAppearance = {
      ...appearance,
      chart: { ...appearance.chart, chartType: "pie" as const },
    };
    renderChart(<ChartPanel appearance={pieAppearance} />);
    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });

    act(() => {
      // Above CHART_COMPACT_HEIGHT_PX (179) but at/below PIE_LEGEND_HIDE_HEIGHT_PX (250).
      observerCallback?.([{ contentRect: { height: 220 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: false } });
  });

  it("leaves a non-pie chart's legend alone at that same in-between height", () => {
    renderChart(<ChartPanel appearance={appearance} />);

    act(() => {
      observerCallback?.([{ contentRect: { height: 220 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });
  });

  it("leaves a pie chart's legend alone once the measured height clears the pie-specific threshold", () => {
    const pieAppearance = {
      ...appearance,
      chart: { ...appearance.chart, chartType: "pie" as const },
    };
    renderChart(<ChartPanel appearance={pieAppearance} />);

    act(() => {
      observerCallback?.([{ contentRect: { height: 300 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });
  });
});
