import { faGaugeHigh, faPlus } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";

interface MetricEmptyStateProps {
  onCreateClick: () => void;
}

export function MetricEmptyState({ onCreateClick }: MetricEmptyStateProps) {
  return (
    <EmptyState
      variant="main"
      icon={faGaugeHigh}
      title="Define your first metric"
      description="Metrics reuse a pipeline-output data type's measure field, aggregation, and format so panels can bind to one shared definition instead of hand-specifying it every time."
      cta={{
        label: "New metric",
        icon: faPlus,
        onClick: onCreateClick,
      }}
    />
  );
}
