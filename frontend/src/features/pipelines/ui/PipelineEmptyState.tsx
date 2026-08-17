import { faCodeBranch, faPlus } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";

interface PipelineEmptyStateProps {
  onCreateClick: () => void;
}

export function PipelineEmptyState({ onCreateClick }: PipelineEmptyStateProps) {
  // F-102: this CTA is fully functional on mobile even though a non-empty pipeline list is
  // view-only there by design — deliberately blessed, not an oversight, same resolution as
  // SourcesPage.tsx's identical carve-out (which itself mirrors F-003's zero-dashboards case): a
  // user with zero pipelines must have a way to create their first one from a phone.
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
