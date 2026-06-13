import { Link } from "react-router-dom";

import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import type { PipelineSummary } from "../types/pipelineStep";

interface Props {
  pipelines: PipelineSummary[];
  /** Current authenticated user's ID. When provided, owners see a Share button. */
  currentUserId?: string | null;
  /** Called when the owner clicks Share on a row. */
  onShare?: (pipeline: PipelineSummary) => void;
}

function StatusBadge({ status }: { status: PipelineSummary["lastRunStatus"] }) {
  if (status === null) {
    return <span className="pipeline-status pipeline-status--never">never run</span>;
  }
  return <span className={`pipeline-status pipeline-status--${status}`}>{status}</span>;
}

export function PipelineListTable({ pipelines, currentUserId, onShare }: Props) {
  const showActions = currentUserId != null && onShare != null;

  return (
    <table className="pipeline-list-table">
      <thead>
        <tr>
          <th className="pipeline-list-table__th">Name</th>
          <th className="pipeline-list-table__th">Source</th>
          <th className="pipeline-list-table__th">Output Type</th>
          <th className="pipeline-list-table__th">Last Run Status</th>
          <th className="pipeline-list-table__th">Last Run At</th>
          <th className="pipeline-list-table__th">Rows Written</th>
          {showActions && (
            <th className="pipeline-list-table__th pipeline-list-table__th--actions" />
          )}
        </tr>
      </thead>
      <tbody>
        {pipelines.map((pipeline) => {
          const isOwner = pipeline.ownerId != null && pipeline.ownerId === currentUserId;
          return (
            <tr key={pipeline.id} className="pipeline-list-table__row">
              <td className="pipeline-list-table__td">
                <Link to={`/pipelines/${pipeline.id}`} className="pipeline-list-table__link">
                  {pipeline.name}
                </Link>
              </td>
              <td className="pipeline-list-table__td">{pipeline.sourceDataSourceName}</td>
              <td className="pipeline-list-table__td">{pipeline.outputDataTypeName}</td>
              <td className="pipeline-list-table__td">
                {pipeline.lastRunStatus === null ? (
                  <span className="pipeline-list-table__never-run">Never run</span>
                ) : (
                  <StatusBadge status={pipeline.lastRunStatus} />
                )}
              </td>
              <td className="pipeline-list-table__td">
                {pipeline.lastRunAt !== null ? (
                  formatRelativeTime(pipeline.lastRunAt)
                ) : (
                  <span className="pipeline-list-table__dash">—</span>
                )}
              </td>
              <td className="pipeline-list-table__td">
                {pipeline.lastRunRowCount != null ? (
                  pipeline.lastRunRowCount.toLocaleString() + " rows"
                ) : (
                  <span className="pipeline-list-table__dash">—</span>
                )}
              </td>
              {showActions && (
                <td className="pipeline-list-table__td pipeline-list-table__td--actions">
                  {isOwner && (
                    <button
                      type="button"
                      className="pipeline-list-table__share-btn"
                      onClick={() => onShare(pipeline)}
                    >
                      Share
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
