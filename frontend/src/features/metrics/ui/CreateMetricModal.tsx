// "New metric" flow, reachable from MetricsPage — mirrors CreatePipelineModal's
// modal-driven create precedent (design.md D1's "genuinely mirrors Pipelines'
// own create flow"). Wraps the shared `MetricEditorForm` (design.md D2/D3) so
// create and edit never diverge in field set or validation-error handling.

import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Modal } from "../../../shared/ui/Modal";
import { fetchMetrics } from "../state/metricsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { Metric } from "../types/metric";
import { MetricEditorForm } from "./MetricEditorForm";

interface CreateMetricModalProps {
  onClose: () => void;
}

export function CreateMetricModal({ onClose }: CreateMetricModalProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  // F-057: lifted from MetricEditorForm (via onSubmittingChange) so the
  // footer's externally-rendered Create button can disable itself / show
  // "Creating…" in sync with the form's own submit-in-flight state.
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSaved(metric: Metric) {
    void dispatch(fetchMetrics());
    onClose();
    void navigate(`/metrics/${metric.id}`);
  }

  // F-057: pinned outside the modal's scrollable body via Modal's `footer`
  // prop — mirrors CreatePipelineModal's pattern (submit-by-form-id) so the
  // Cancel/Create actions stay visible on a long form at phone height,
  // instead of scrolling away with the field list.
  const footer = (
    <>
      <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={onClose}>
        Cancel
      </button>
      <button
        type="submit"
        form="metric-editor-form"
        className="ui-modal-btn ui-modal-btn--primary"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Creating…" : "Create metric"}
      </button>
    </>
  );

  return (
    <Modal
      open
      title="Create metric"
      // F-161: lg tracks this form's larger field set (name, description,
      // data type picker, measure field, aggregation, allowed dimensions,
      // 4 format fields) — cramping it to md/sm would squeeze the data-type
      // list and format rows. Not meant to match every other "create X"
      // modal; each one's size should track its own content.
      size="lg"
      ariaLabel="Create metric"
      onClose={onClose}
      footer={footer}
    >
      <MetricEditorForm
        mode="create"
        onSaved={handleSaved}
        onCancel={onClose}
        hideActions
        onSubmittingChange={setIsSubmitting}
      />
    </Modal>
  );
}
