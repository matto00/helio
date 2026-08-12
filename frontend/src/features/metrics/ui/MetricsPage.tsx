import { useEffect } from "react";

import "./MetricsPage.css";
import { fetchDataTypes } from "../../dataTypes/state/dataTypesSlice";
import { deleteMetric, fetchMetrics, setCreateMetricModalOpen } from "../state/metricsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import type { MetricSummary } from "../types/metric";
import { CreateMetricModal } from "./CreateMetricModal";
import { MetricEmptyState } from "./MetricEmptyState";
import { MetricListTable } from "./MetricListTable";

/** Metrics list page (`/metrics`) — mirrors `PipelinesPage.tsx`'s fetch-on-
 *  mount + loading/empty/error + list-table + "New" modal shape (design.md
 *  D1). */
export function MetricsPage() {
  const dispatch = useAppDispatch();
  const { items, status, error, createModalOpen } = useAppSelector((state) => state.metrics);
  const dataTypes = useAppSelector((state) => state.dataTypes.items);
  const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);

  useEffect(() => {
    void dispatch(fetchMetrics());
  }, [dispatch]);

  useEffect(() => {
    if (dataTypesStatus === "idle") {
      void dispatch(fetchDataTypes());
    }
  }, [dataTypesStatus, dispatch]);

  const dataTypeNameById = new Map(dataTypes.map((dt) => [dt.id, dt.name]));

  function handleDelete(metric: MetricSummary) {
    void dispatch(deleteMetric(metric.id));
  }

  return (
    <div className="metrics-page">
      <div className="metrics-page__section">
        {status === "loading" && <p className="metrics-page__loading">Loading metrics…</p>}

        {status === "failed" && error && (
          <p className="metrics-page__error" role="alert">
            {error}
          </p>
        )}

        {(status === "succeeded" || status === "idle") && items.length === 0 && (
          <MetricEmptyState onCreateClick={() => dispatch(setCreateMetricModalOpen(true))} />
        )}

        {status === "succeeded" && items.length > 0 && (
          <>
            <div className="metrics-page__toolbar">
              <button
                type="button"
                className="metrics-page__create-btn"
                onClick={() => dispatch(setCreateMetricModalOpen(true))}
              >
                New metric
              </button>
            </div>
            <MetricListTable
              metrics={items}
              dataTypeNameById={dataTypeNameById}
              onDelete={handleDelete}
            />
          </>
        )}
      </div>

      {createModalOpen && (
        <CreateMetricModal onClose={() => dispatch(setCreateMetricModalOpen(false))} />
      )}
    </div>
  );
}
