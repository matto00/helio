export function PipelineEmptyState() {
  return (
    <div className="pipeline-empty-state">
      <p className="pipeline-empty-state__message">
        No pipelines yet. Create one to start transforming your data.
      </p>
      <button type="button" className="pipeline-empty-state__cta">
        Create pipeline
      </button>
    </div>
  );
}
