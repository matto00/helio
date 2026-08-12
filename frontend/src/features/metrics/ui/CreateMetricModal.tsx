// "New metric" flow, reachable from MetricsPage — mirrors CreatePipelineModal's
// modal-driven create precedent (design.md D1's "genuinely mirrors Pipelines'
// own create flow"). Wraps the shared `MetricEditorForm` (design.md D2/D3) so
// create and edit never diverge in field set or validation-error handling.

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

  function handleSaved(metric: Metric) {
    void dispatch(fetchMetrics());
    onClose();
    void navigate(`/metrics/${metric.id}`);
  }

  return (
    <Modal open title="Create metric" size="lg" ariaLabel="Create metric" onClose={onClose}>
      <MetricEditorForm mode="create" onSaved={handleSaved} onCancel={onClose} />
    </Modal>
  );
}
