import { render, screen } from "@testing-library/react";

import { ThemeProvider } from "../../../theme/ThemeProvider";
import { ChartPanel } from "./ChartPanel";

// HEL-572 — a dedicated test file (kept separate from the already
// oversized ChartPanel.test.tsx, ~1100 lines before this ticket — see
// files-modified.md's spinoff note) covering tasks.md 3.1-3.3: click
// wiring, the legend/series bail-out, stopPropagation, and the pointer
// cursor affordance.
//
// The mock below stashes the `onEvents` map ChartPanel passes to
// `ReactECharts` directly on the rendered DOM node (rather than trying to
// simulate a real ECharts canvas click through jsdom, which has no canvas
// hit-testing) — tests below invoke `chartNode.__onEvents.click(params)`
// directly with constructed params objects, exactly matching design.md's
// own risk mitigation ("unit-test the click handler directly against
// constructed params objects... not just through a full chart render").
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

function renderChart(props: Parameters<typeof ChartPanel>[0] = {}) {
  render(
    <ThemeProvider>
      <ChartPanel {...props} />
    </ThemeProvider>,
  );
  return screen.getByTestId("echarts") as MockChartNode;
}

function getOption(el: HTMLElement) {
  return JSON.parse(el.getAttribute("data-option") ?? "{}") as {
    series?: Array<Record<string, unknown>>;
  };
}

const headers = ["quarter", "revenue"];
const rawRows = [
  ["Q1", "100"],
  ["Q2", "200"],
];
const fieldMapping = { xAxis: "quarter", yAxis: "revenue" };

describe("ChartPanel click wiring — tasks.md 3.1 (componentType bail-out)", () => {
  it("does NOT invoke onDataPointSelect for a legend click (componentType !== 'series')", () => {
    const onDataPointSelect = jest.fn();
    const chart = renderChart({ headers, rawRows, fieldMapping, onDataPointSelect });

    chart.__onEvents?.click({ componentType: "legend", name: "revenue" });

    expect(onDataPointSelect).not.toHaveBeenCalled();
  });

  it("does NOT invoke onDataPointSelect for an empty-grid-area click (no componentType)", () => {
    const onDataPointSelect = jest.fn();
    const chart = renderChart({ headers, rawRows, fieldMapping, onDataPointSelect });

    chart.__onEvents?.click({});

    expect(onDataPointSelect).not.toHaveBeenCalled();
  });

  it("invokes onDataPointSelect with the mapped selection for a genuine series click", () => {
    const onDataPointSelect = jest.fn();
    const chart = renderChart({ headers, rawRows, fieldMapping, onDataPointSelect });

    chart.__onEvents?.click({ componentType: "series", name: "Q1", seriesName: "revenue" });

    expect(onDataPointSelect).toHaveBeenCalledWith({
      dimension: "quarter",
      value: "Q1",
      series: "revenue",
    });
  });
});

describe("ChartPanel click wiring — tasks.md 3.2 (stopPropagation, design.md D2)", () => {
  it("calls stopPropagation on the native event for a genuine series click", () => {
    const stopPropagation = jest.fn();
    const chart = renderChart({ headers, rawRows, fieldMapping, onDataPointSelect: jest.fn() });

    chart.__onEvents?.click({
      componentType: "series",
      name: "Q1",
      seriesName: "revenue",
      event: { event: { stopPropagation } },
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("does NOT call stopPropagation for a legend click", () => {
    const stopPropagation = jest.fn();
    const chart = renderChart({ headers, rawRows, fieldMapping, onDataPointSelect: jest.fn() });

    chart.__onEvents?.click({
      componentType: "legend",
      name: "revenue",
      event: { event: { stopPropagation } },
    });

    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it("stops propagation even when no mapping is possible (headers empty)", () => {
    // Red-first probe for design.md D2's "stopPropagation runs BEFORE
    // resolving whether a mapping is even possible": with `stopPropagation`
    // called only after a successful `mapChartClickToSelection`, this case
    // (a genuine series click that can't be mapped) would fall through to
    // DesktopPanelGrid's card-click handler and wrongly open Customize —
    // exactly the panel-body-click regression design.md D2 exists to
    // prevent. Confirmed here directly against the implementation rather
    // than only via the two passing cases above, which both have mappable
    // params and wouldn't catch an ordering regression.
    const stopPropagation = jest.fn();
    const chart = renderChart({ onDataPointSelect: jest.fn() });

    chart.__onEvents?.click({
      componentType: "series",
      name: "Q1",
      event: { event: { stopPropagation } },
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onDataPointSelect is omitted (no mount point wired it)", () => {
    const stopPropagation = jest.fn();
    const chart = renderChart({ headers, rawRows, fieldMapping });

    expect(() =>
      chart.__onEvents?.click({
        componentType: "series",
        name: "Q1",
        seriesName: "revenue",
        event: { event: { stopPropagation } },
      }),
    ).not.toThrow();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });
});

describe("ChartPanel cursor affordance — tasks.md 3.3 / design.md D6 (HEL-1178 hazard)", () => {
  it("applies cursor: pointer to series entries with a stored appearance.chart", () => {
    const chart = renderChart({
      headers,
      rawRows,
      fieldMapping,
      appearance: {
        background: "transparent",
        color: "inherit",
        transparency: 0,
        chart: {
          seriesColors: [],
          legend: { show: true, position: "top" },
          tooltip: { enabled: true },
          axisLabels: { x: { show: true }, y: { show: true } },
          chartType: "bar",
        },
      },
    });
    const option = getOption(chart);
    expect(option.series?.[0]?.cursor).toBe("pointer");
  });

  it("still applies cursor: pointer with NO stored appearance.chart (HEL-1178 regression probe)", () => {
    const chart = renderChart({ headers, rawRows, fieldMapping });
    const option = getOption(chart);
    expect(option.series?.[0]?.cursor).toBe("pointer");
  });

  it("applies cursor: pointer to every series in a multi-series chart", () => {
    const multiHeaders = ["quarter", "region", "revenue"];
    const multiRows = [
      ["Q1", "East", "100"],
      ["Q1", "West", "150"],
    ];
    const chart = renderChart({
      headers: multiHeaders,
      rawRows: multiRows,
      fieldMapping: { xAxis: "quarter", yAxis: "revenue", series: "region" },
    });
    const option = getOption(chart);
    expect(option.series?.length).toBeGreaterThan(1);
    for (const series of option.series ?? []) {
      expect(series.cursor).toBe("pointer");
    }
  });
});
