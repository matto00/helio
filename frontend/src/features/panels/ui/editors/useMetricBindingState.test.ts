// HEL-560 design.md D5 — the picker's offered options exclude deprecated
// metrics, except the panel's currently-bound metric stays visible/
// selectable even if it has since been deprecated. Mirrors
// `usePanelData.test.ts`'s configureStore + renderHook + Provider wrapper
// shape for a redux-connected hook.

import { configureStore } from "@reduxjs/toolkit";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { metricsReducer } from "../../../metrics/state/metricsSlice";
import type { MetricSummary } from "../../../metrics/types/metric";
import { makeMetricPanel } from "../../../../test/panelFixtures";
import { useMetricBindingState } from "./useMetricBindingState";

function makeMetric(overrides: Partial<MetricSummary> = {}): MetricSummary {
  return {
    id: "m-1",
    ownerId: "u-1",
    dataTypeId: "dt-1",
    name: "Metric",
    description: null,
    measureField: "value",
    aggregation: "sum",
    allowedDimensions: [],
    format: {},
    deprecated: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStore(metrics: MetricSummary[]) {
  return configureStore({
    reducer: { metrics: metricsReducer } as never,
    preloadedState: {
      metrics: {
        items: metrics,
        status: "succeeded",
        error: null,
        createStatus: "idle",
        createError: null,
        updateStatus: "idle",
        updateError: null,
        deleteStatus: "idle",
        deleteError: null,
        currentMetric: null,
        currentMetricStatus: "idle",
        currentMetricError: null,
        createModalOpen: false,
      },
    } as never,
  });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

describe("useMetricBindingState — deprecated filtering (HEL-560 design.md D5)", () => {
  it("excludes deprecated metrics from the offered options", () => {
    const active = makeMetric({ id: "m-active" });
    const deprecated = makeMetric({ id: "m-deprecated", deprecated: true });
    const store = makeStore([active, deprecated]);
    const panel = makeMetricPanel({ config: { dataTypeId: "", fieldMapping: {} } });

    const { result } = renderHook(() => useMetricBindingState(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current.metrics.map((m) => m.id)).toEqual(["m-active"]);
  });

  it("keeps the panel's currently-bound metric visible even if it has since been deprecated", () => {
    const boundNowDeprecated = makeMetric({ id: "m-bound", deprecated: true });
    const other = makeMetric({ id: "m-other" });
    const store = makeStore([boundNowDeprecated, other]);
    const panel = makeMetricPanel({
      config: { dataTypeId: "", fieldMapping: {}, metricId: "m-bound" },
    });

    const { result } = renderHook(() => useMetricBindingState(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current.metrics.map((m) => m.id).sort()).toEqual(["m-bound", "m-other"]);
    expect(result.current.selectedMetric?.id).toBe("m-bound");
  });

  it("still excludes a deprecated metric that is not the panel's currently-bound one", () => {
    const bound = makeMetric({ id: "m-bound" });
    const deprecatedOther = makeMetric({ id: "m-deprecated-other", deprecated: true });
    const store = makeStore([bound, deprecatedOther]);
    const panel = makeMetricPanel({
      config: { dataTypeId: "", fieldMapping: {}, metricId: "m-bound" },
    });

    const { result } = renderHook(() => useMetricBindingState(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current.metrics.map((m) => m.id)).toEqual(["m-bound"]);
  });
});
