import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import "./MetricDetailPage.css";
import { fetchMetricUsage } from "../services/metricService";
import { clearCurrentMetric, deleteMetric, fetchMetricById } from "../state/metricsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { ConfirmInline } from "../../../shared/ui/ConfirmInline";
import { MetricEditorForm } from "./MetricEditorForm";

/** `"loading"` while the usage fetch is in flight; `"error"` when it failed
 *  (impact unknown — never silently reported as zero); a number is the
 *  resolved bound-panel count. Mirrors `MetricListTable.tsx`'s own inline
 *  delete-confirm usage state (HEL-560). */
type UsageState = "loading" | "error" | number;

function usageCopy(usage: UsageState): string {
  if (usage === "loading") return "Checking how many panels are bound to this metric…";
  if (usage === "error")
    return "Couldn't check usage — panels bound to it will lose their resolved binding.";
  if (usage === 0) return "This metric is not bound to any panels.";
  return `${usage} panel${usage === 1 ? "" : "s"} bound to this metric will lose their resolved binding.`;
}

/** Metric edit page (`/metrics/:id`) — mirrors `PipelineDetailPage.tsx`'s
 *  fetch-on-mount + loading/error-guard shape (design.md D1), scaled down to
 *  what a flat CRUD resource needs (no steps/river view). */
export function MetricDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const { currentMetric, currentMetricStatus, currentMetricError } = useAppSelector(
    (state) => state.metrics,
  );

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [usage, setUsage] = useState<UsageState>("loading");

  useEffect(() => {
    if (id) {
      void dispatch(fetchMetricById(id));
    }
    return () => {
      dispatch(clearCurrentMetric());
    };
  }, [dispatch, id]);

  function handleSaved() {
    void navigate("/metrics");
  }

  function startDelete() {
    if (!id) return;
    setIsConfirmingDelete(true);
    setUsage("loading");
    void fetchMetricUsage(id)
      .then((result) => setUsage(result.count))
      .catch(() => setUsage("error"));
  }

  async function handleDelete() {
    if (!id) return;
    await dispatch(deleteMetric(id));
    void navigate("/metrics");
  }

  if (currentMetric === null && currentMetricError !== null) {
    return (
      <div className="metric-detail-page">
        <div className="metric-detail-page__error" role="alert">
          {currentMetricError}
        </div>
      </div>
    );
  }

  if (currentMetric === null || currentMetricStatus === "loading") {
    return (
      <div className="metric-detail-page">
        <div className="metric-detail-page__loading" aria-label="Loading metric">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="metric-detail-page">
      <h1 className="metric-detail-page__title">{currentMetric.name}</h1>

      <MetricEditorForm
        mode="edit"
        metric={currentMetric}
        onSaved={handleSaved}
        onCancel={() => void navigate("/metrics")}
      />

      <div className="metric-detail-page__danger-zone">
        {isConfirmingDelete ? (
          // F-015: was two identically-styled `ui-modal-btn--secondary`
          // buttons, giving the one truly destructive click no danger
          // styling. Reuses the shared `ConfirmInline` primitive — the same
          // canonical danger-at-rest recipe `MetricListTable.tsx` already
          // uses for its own delete-confirm affordance.
          <ConfirmInline
            label={usageCopy(usage)}
            confirmLabel="Confirm delete"
            onConfirm={() => void handleDelete()}
            onCancel={() => setIsConfirmingDelete(false)}
          />
        ) : (
          <button type="button" className="metric-detail-page__delete-btn" onClick={startDelete}>
            Delete metric
          </button>
        )}
      </div>
    </div>
  );
}
