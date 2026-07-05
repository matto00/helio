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
  }
}

interface BoundSourceBarProps {
  /** The pipeline's bound source name (`Pipeline.sourceDataSourceName`), for display. */
  sourceName: string;
  /** The matching DataSource record, resolved by `Pipeline.sourceDataSourceId`,
   *  for its kind badge. */
  source: DataSource | undefined;
}

export function BoundSourceBar({ sourceName, source }: BoundSourceBarProps) {
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
    </div>
  );
}
