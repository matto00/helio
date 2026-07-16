import { act, renderHook } from "@testing-library/react";

import { normalizeChartOptions, useChartDisplayState } from "./useChartDisplayState";
import type { ChartPanel, ChartPanelConfig } from "../../types/panel";

function chartPanel(config: Partial<ChartPanelConfig>): ChartPanel {
  return {
    id: "panel-1",
    dashboardId: "d-1",
    title: "Trend",
    meta: { createdBy: "u", createdAt: "", lastUpdated: "" },
    appearance: { background: "transparent", color: "inherit", transparency: 0 },
    type: "chart",
    config: { dataTypeId: "dt1", fieldMapping: {}, ...config },
  };
}

describe("normalizeChartOptions (HEL-248)", () => {
  it("drops default-equivalent values so an untouched map normalizes to empty", () => {
    expect(
      normalizeChartOptions({
        line: { smooth: false, showPoints: true, areaFill: false },
        bar: { orientation: "vertical", stacking: "none" },
        pie: { donutHolePct: 0, showPercentLabels: false },
        scatter: { sizeField: "", colorField: "" },
      }),
    ).toEqual({});
  });

  it("keeps the non-default 'markers off' line state and true toggles", () => {
    expect(
      normalizeChartOptions({ line: { smooth: true, showPoints: false, areaFill: true } }),
    ).toEqual({ line: { smooth: true, showPoints: false, areaFill: true } });
  });

  it("keeps horizontal orientation, non-none stacking, and a set gap", () => {
    expect(
      normalizeChartOptions({
        bar: { orientation: "horizontal", stacking: "normalized", barGapPct: 30 },
      }),
    ).toEqual({ bar: { orientation: "horizontal", stacking: "normalized", barGapPct: 30 } });
  });
});

describe("useChartDisplayState (HEL-248)", () => {
  it("starts clean with an undefined patch when the panel has no options", () => {
    const { result } = renderHook(() => useChartDisplayState(chartPanel({})));
    expect(result.current.dirty).toBe(false);
    expect(result.current.patch).toBeUndefined();
  });

  it("seeds the working values from stored options and stays clean", () => {
    const panel = chartPanel({ chartOptions: { bar: { stacking: "stacked", barGapPct: 10 } } });
    const { result } = renderHook(() => useChartDisplayState(panel));
    expect(result.current.bar.stacking).toBe("stacked");
    expect(result.current.bar.barGapPct).toBe(10);
    expect(result.current.dirty).toBe(false);
    expect(result.current.patch).toBeUndefined();
  });

  it("editing a type marks dirty and produces a patch carrying that type's entry", () => {
    const { result } = renderHook(() => useChartDisplayState(chartPanel({})));
    act(() => result.current.setLine({ smooth: true }));
    expect(result.current.dirty).toBe(true);
    expect(result.current.patch).toEqual({ line: { smooth: true } });
  });

  it("editing one type preserves the other types' stored entries in the patch", () => {
    const panel = chartPanel({
      chartOptions: {
        line: { smooth: true },
        pie: { donutHolePct: 50 },
      },
    });
    const { result } = renderHook(() => useChartDisplayState(panel));

    // Edit only the bar entry; line + pie must pass through untouched.
    act(() => result.current.setBar({ stacking: "normalized" }));

    expect(result.current.patch).toEqual({
      line: { smooth: true },
      pie: { donutHolePct: 50 },
      bar: { stacking: "normalized" },
    });
  });

  it("clears to null when the last option is removed (edit back to default)", () => {
    const panel = chartPanel({ chartOptions: { line: { smooth: true } } });
    const { result } = renderHook(() => useChartDisplayState(panel));

    act(() => result.current.setLine({ smooth: false }));

    expect(result.current.dirty).toBe(true);
    expect(result.current.patch).toBeNull();
  });

  it("reset() restores the stored options and clears dirty", () => {
    const panel = chartPanel({ chartOptions: { bar: { stacking: "stacked" } } });
    const { result } = renderHook(() => useChartDisplayState(panel));

    act(() => result.current.setBar({ stacking: "normalized" }));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.reset());
    expect(result.current.dirty).toBe(false);
    expect(result.current.bar.stacking).toBe("stacked");
    expect(result.current.patch).toBeUndefined();
  });

  it("toggling a value on then back off returns to not-dirty (default-equivalent)", () => {
    const { result } = renderHook(() => useChartDisplayState(chartPanel({})));
    act(() => result.current.setPie({ showPercentLabels: true }));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setPie({ showPercentLabels: false }));
    expect(result.current.dirty).toBe(false);
    expect(result.current.patch).toBeUndefined();
  });
});
