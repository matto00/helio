import { faCodeBranch, faPlus } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "./ui/EmptyState";

interface PipelineEmptyStateProps {
  onCreateClick: () => void;
}

export function PipelineEmptyState({ onCreateClick }: PipelineEmptyStateProps) {
  return (
    <EmptyState
      variant="main"
      icon={faCodeBranch}
      title="Build your first pipeline"
      description="Pipelines transform raw source data into typed rows you can chart. Chain filter, select, compute, and aggregate steps to shape your data."
      cta={{
        label: "New pipeline",
        icon: faPlus,
        onClick: onCreateClick,
      }}
    />
  );
}
