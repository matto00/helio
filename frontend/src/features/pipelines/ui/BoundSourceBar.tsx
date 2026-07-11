// BoundSourceBar — read-only display of the pipeline's single bound data
// source (name + kind), shown above the river view on PipelineDetailPage.
//
// Replaces the mock `SourceSelectorBar`/`SourceChip` scaffolding, which
// rendered every registered source as a togglable chip with a dead "+
// Connect source" button and a mock preview table — implying a multi-source
// composition model that contradicts the actual one-input flow
// (DataSource → Pipeline → DataType → Panel).

import type { DataSource, DataSourceKind } from "../../sources/types/dataSource";

function labelForKind(kind: DataSourceKind): string {
  switch (kind) {
    case "rest_api":
      return "REST API";
    case "csv":
      return "CSV";
    case "static":
      return "Static";
    case "sql":
      return "SQL";
    case "text":
      return "Text/Markdown";
    case "pdf":
      return "PDF";
  }
}

interface BoundSourceBarProps {
  /** The pipeline's bound source name (`Pipeline.sourceDataSourceName`), for display. */
  sourceName: string;
  /** The matching DataSource record, resolved by `Pipeline.sourceDataSourceId`,
   *  for its kind badge. */
  source: DataSource | undefined;
  /** Whether the current user owns the bound source (i.e. `source` is
   *  resolvable in their own owner-scoped `sources.items`). Gates the "Edit
   *  Source" button — see `pipeline-editor-page` spec. */
  canEditSource: boolean;
  /** Navigates to the source's detail view. Only invoked when `canEditSource`
   *  is true (the button is not rendered otherwise). */
  onEditSource: () => void;
}

export function BoundSourceBar({
  sourceName,
  source,
  canEditSource,
  onEditSource,
}: BoundSourceBarProps) {
  return (
    <div className="pipeline-detail-page__source-bar">
      <span className="pipeline-detail-page__source-bar-label">DATA SOURCE</span>
      <div className="pipeline-detail-page__bound-source">
        <span className="pipeline-detail-page__bound-source-name">{sourceName}</span>
        {source && (
          <span className="pipeline-detail-page__bound-source-kind">
            {labelForKind(source.type)}
          </span>
        )}
      </div>
      {canEditSource && (
        <button className="pipeline-detail-page__edit-btn" onClick={onEditSource} type="button">
          Edit Source
        </button>
      )}
    </div>
  );
}
