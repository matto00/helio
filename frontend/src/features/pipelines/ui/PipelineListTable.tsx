import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import { useScrollEdges } from "../../../shared/ui/useScrollEdges";
import { StatusChip } from "../../../shared/ui/StatusChip";
import type { PipelineSummary } from "../types/pipelineStep";
import "./PipelineListTable.css";

interface Props {
  pipelines: PipelineSummary[];
  /** Current authenticated user's ID. When provided, owners see a Share button. */
  currentUserId?: string | null;
  /** Called when the owner clicks Share on a row. */
  onShare?: (pipeline: PipelineSummary) => void;
}

// F-137: the third (and last) of three independently-drifted status-pill
// recipes in this feature now reuses the shared `StatusChip` primitive —
// `RunHistoryModal.tsx`/`PipelineDetailPage.tsx` already migrated. The old
// `.pipeline-status*` rules in PipelinesPage.css are now dead.
const RUN_STATUS_LABELS: Record<"succeeded" | "failed", string> = {
  succeeded: "Succeeded",
  failed: "Failed",
};

const RUN_STATUS_INTENTS: Record<"succeeded" | "failed", "success" | "error"> = {
  succeeded: "success",
  failed: "error",
};

function StatusBadge({ status }: { status: PipelineSummary["lastRunStatus"] }) {
  if (status === null) {
    return (
      <StatusChip intent="neutral" dashed>
        Never run
      </StatusChip>
    );
  }
  return <StatusChip intent={RUN_STATUS_INTENTS[status]}>{RUN_STATUS_LABELS[status]}</StatusChip>;
}

export function PipelineListTable({ pipelines, currentUserId, onShare }: Props) {
  const showActions = currentUserId != null && onShare != null;
  const navigate = useNavigate();
  // Scroll-shadow affordance (HEL a11y/ux sweep F-164) — this table has its
  // own scroll container (below) rather than relying on the page-level
  // `.app-content` scroll region, so the shadow only appears when this
  // table itself actually overflows.
  const { ref: scrollRef, edges: scrollEdges } = useScrollEdges<HTMLDivElement>();

  // Makes the whole row clickable to match the row-level hover affordance
  // (`.pipeline-list-table__row:hover`) — previously only the Name cell's
  // <Link> actually navigated (HEL UI-sweep F-069). Interactive descendants
  // (the Name link, the Share button) handle their own click; the row
  // handler is skipped when the click originated from one of them so it
  // never double-navigates or fires alongside Share.
  function handleRowClick(pipelineId: string) {
    return (event: MouseEvent<HTMLTableRowElement>) => {
      if ((event.target as HTMLElement).closest("a, button")) return;
      navigate(`/pipelines/${pipelineId}`);
    };
  }

  const scrollClasses = [
    "pipeline-list-table__scroll",
    scrollEdges.left ? "pipeline-list-table__scroll--left" : null,
    scrollEdges.right ? "pipeline-list-table__scroll--right" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={scrollClasses} ref={scrollRef}>
      <table className="pipeline-list-table">
        <thead>
          <tr>
            <th className="pipeline-list-table__th">Name</th>
            <th className="pipeline-list-table__th">Source</th>
            <th className="pipeline-list-table__th">Output type</th>
            <th className="pipeline-list-table__th">Last run status</th>
            <th className="pipeline-list-table__th">Last run at</th>
            <th className="pipeline-list-table__th">Rows written</th>
            {showActions && (
              <th className="pipeline-list-table__th pipeline-list-table__th--actions">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {pipelines.map((pipeline) => {
            const isOwner = pipeline.ownerId != null && pipeline.ownerId === currentUserId;
            return (
              <tr
                key={pipeline.id}
                className="pipeline-list-table__row"
                onClick={handleRowClick(pipeline.id)}
              >
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
                    pipeline.lastRunRowCount.toLocaleString() +
                    (pipeline.lastRunRowCount === 1 ? " row" : " rows")
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
                        aria-label={`Share ${pipeline.name}`}
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
    </div>
  );
}
