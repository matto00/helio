// SourceSelectorBar — the top "DATA SOURCES" strip shown above the river
// view on the PipelineDetailPage. Extracted from PipelineDetailPage.tsx in
// CS3 cycle 2 to keep the parent under the 400L hard cap.

import { SourceChip } from "./SourceChip";
import type { DataSource } from "../../sources/types/dataSource";

interface SourceSelectorBarProps {
  sources: DataSource[];
  sourcesStatus: string;
}

export function SourceSelectorBar({ sources, sourcesStatus }: SourceSelectorBarProps) {
  return (
    <div className="pipeline-detail-page__source-bar">
      <span className="pipeline-detail-page__source-bar-label">DATA SOURCES</span>
      <div className="pipeline-detail-page__source-chips">
        {sourcesStatus === "loading" && (
          <span className="pipeline-detail-page__source-bar-loading">Loading…</span>
        )}
        {sources.map((source) => (
          <SourceChip key={source.id} source={source} />
        ))}
        <button type="button" className="pipeline-detail-page__connect-source-btn">
          + Connect source
        </button>
      </div>
    </div>
  );
}
