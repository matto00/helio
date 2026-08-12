import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import "./MetricDetailPage.css";
import { clearCurrentMetric, deleteMetric, fetchMetricById } from "../state/metricsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { MetricEditorForm } from "./MetricEditorForm";

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
          <div className="metric-detail-page__delete-confirm">
            <span>Delete this metric? Panels bound to it will lose their resolved binding.</span>
            <button
              type="button"
              className="ui-modal-btn ui-modal-btn--secondary"
              onClick={() => void handleDelete()}
            >
              Confirm delete
            </button>
            <button
              type="button"
              className="ui-modal-btn ui-modal-btn--secondary"
              onClick={() => setIsConfirmingDelete(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="metric-detail-page__delete-btn"
            onClick={() => setIsConfirmingDelete(true)}
          >
            Delete metric
          </button>
        )}
      </div>
    </div>
  );
}
