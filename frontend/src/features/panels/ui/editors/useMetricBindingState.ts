// State + dirty-tracking + patch-shaping for `BindingEditor`'s bind-to-metric
// mode (HEL-500/HEL-553 design.md D5). Extracted out of `BindingEditor` —
// mirroring `useBoundOrLiteralState.ts`'s shape — so the editor doesn't grow
// a fourth mode's state inline (it's already past the CONTRIBUTING.md
// ~400-line split threshold). Gated to metric/chart/table panels only,
// matching the backend's own `metricIdOf` scope
// (`PanelServiceHelpers.scala`) — `BindingEditor` is never mounted for
// collection/timeline panels in the first place.

import { useEffect, useState } from "react";

import { fetchMetrics } from "../../../metrics/state/metricsSlice";
import type { MetricSummary } from "../../../metrics/types/metric";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import type { ChartPanel, MetricPanel, TablePanel } from "../../types/panel";

export interface MetricBindingState {
  metrics: MetricSummary[];
  metricsStatus: "idle" | "loading" | "succeeded" | "failed";
  selectedMetricId: string | null;
  /** The full `MetricSummary` for `selectedMetricId`, once loaded — `null`
   *  while metrics are still loading or nothing is selected. */
  selectedMetric: MetricSummary | null;
  setSelectedMetricId: (id: string | null) => void;
  /** True when the selection differs from the panel's stored `metricId`. */
  dirty: boolean;
  reset: () => void;
  /** The `config.metricId` PATCH value: `undefined` when untouched (omit the
   *  key — leave unchanged), else the current selection (a metric id, or
   *  `null` to clear). Mirrors `BoundOrLiteralState.patchValue`'s
   *  absent/null/value convention (`useBoundOrLiteralState.ts`). */
  patchValue: string | null | undefined;
}

export function useMetricBindingState(
  panel: MetricPanel | ChartPanel | TablePanel,
): MetricBindingState {
  const dispatch = useAppDispatch();
  const metrics = useAppSelector((state) => state.metrics.items);
  const metricsStatus = useAppSelector((state) => state.metrics.status);

  const initialMetricId = panel.config.metricId ?? null;
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(initialMetricId);

  useEffect(() => {
    if (metricsStatus === "idle") {
      void dispatch(fetchMetrics());
    }
  }, [metricsStatus, dispatch]);

  const dirty = selectedMetricId !== initialMetricId;
  const patchValue: string | null | undefined = dirty ? selectedMetricId : undefined;
  const selectedMetric = metrics.find((m) => m.id === selectedMetricId) ?? null;

  return {
    metrics,
    metricsStatus,
    selectedMetricId,
    selectedMetric,
    setSelectedMetricId,
    dirty,
    reset: () => setSelectedMetricId(initialMetricId),
    patchValue,
  };
}
