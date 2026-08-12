// Metrics list table — mirrors `PipelineListTable.tsx`'s raw-<table>
// structure/class-naming precedent, with an inline delete-confirm affordance
// (HEL-553 task 2.5) since no `window.confirm` is used anywhere else in this
// codebase (see `PipelineDetailPage.tsx`'s own inline discard-confirm).
//
// HEL-560: the confirm affordance calls GET /api/metrics/:id/usage when a
// delete is first initiated, so the real bound-panel count is shown before
// the user confirms — replacing the previous generic "Delete?" copy.

import { useState } from "react";
import { Link } from "react-router-dom";

import { fetchMetricUsage } from "../services/metricService";
import type { MetricSummary } from "../types/metric";

interface MetricListTableProps {
  metrics: MetricSummary[];
  dataTypeNameById: Map<string, string>;
  onDelete: (metric: MetricSummary) => void;
}

/** `"loading"` while the usage fetch is in flight; `"error"` when it failed
 *  (impact unknown — never silently reported as zero); a number is the
 *  resolved bound-panel count. */
type UsageState = "loading" | "error" | number;

function usageLabel(usage: UsageState): string {
  if (usage === "loading") return "Checking usage…";
  if (usage === "error") return "Delete? (couldn't check usage)";
  if (usage === 0) return "Delete? Not bound to any panels.";
  return `Delete? ${usage} panel${usage === 1 ? "" : "s"} will lose this binding.`;
}

export function MetricListTable({ metrics, dataTypeNameById, onDelete }: MetricListTableProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageState>("loading");

  function startDelete(metric: MetricSummary) {
    setConfirmDeleteId(metric.id);
    setUsage("loading");
    void fetchMetricUsage(metric.id)
      .then((result) => setUsage(result.count))
      .catch(() => setUsage("error"));
  }

  return (
    <table className="metric-list-table">
      <thead>
        <tr>
          <th className="metric-list-table__th">Name</th>
          <th className="metric-list-table__th">Data type</th>
          <th className="metric-list-table__th">Measure field</th>
          <th className="metric-list-table__th">Aggregation</th>
          <th className="metric-list-table__th">Status</th>
          <th className="metric-list-table__th metric-list-table__th--actions" />
        </tr>
      </thead>
      <tbody>
        {metrics.map((metric) => {
          const isConfirming = confirmDeleteId === metric.id;
          return (
            <tr key={metric.id} className="metric-list-table__row">
              <td className="metric-list-table__td">
                <Link to={`/metrics/${metric.id}`} className="metric-list-table__link">
                  {metric.name}
                </Link>
              </td>
              <td className="metric-list-table__td">
                {dataTypeNameById.get(metric.dataTypeId) ?? metric.dataTypeId}
              </td>
              <td className="metric-list-table__td">{metric.measureField}</td>
              <td className="metric-list-table__td">{metric.aggregation}</td>
              <td className="metric-list-table__td">
                {metric.deprecated ? (
                  <span className="metric-status metric-status--deprecated">deprecated</span>
                ) : (
                  <span className="metric-status metric-status--active">active</span>
                )}
              </td>
              <td className="metric-list-table__td metric-list-table__td--actions">
                {isConfirming ? (
                  <div className="metric-list-table__confirm">
                    <span className="metric-list-table__confirm-label">{usageLabel(usage)}</span>
                    <button
                      type="button"
                      className="metric-list-table__confirm-btn"
                      aria-label={`Confirm delete ${metric.name}`}
                      onClick={() => {
                        onDelete(metric);
                        setConfirmDeleteId(null);
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="metric-list-table__cancel-btn"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="metric-list-table__delete-btn"
                    aria-label={`Delete ${metric.name}`}
                    onClick={() => startDelete(metric)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
