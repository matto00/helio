interface PipelineEmptyStateProps {
  onCreateClick: () => void;
}

export function PipelineEmptyState({ onCreateClick }: PipelineEmptyStateProps) {
  return (
    <div className="pipeline-empty-state">
      <p className="pipeline-empty-state__message">
        No pipelines yet. Create one to start transforming your data.
      </p>
      <button type="button" className="pipeline-empty-state__cta" onClick={onCreateClick}>
        Create pipeline
      </button>
    </div>
  );
}
