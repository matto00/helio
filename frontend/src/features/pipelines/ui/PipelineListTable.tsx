import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import { StatusChip } from "../../../shared/ui/StatusChip";
import { useSortedRows, type SortColumn } from "../../../shared/ui/useSortedRows";
import { SortableTable, type SortableTableColumn } from "../../../shared/ui/SortableTable";
import type { PipelineSummary, PipelineRoot } from "../types/pipelineStep";
import { TruncatedRowCountBadge } from "./TruncatedRowCountBadge";
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

// HEL-1022: a pipeline root is a "source" in user-facing copy (never "root");
// the table renders every root's name, not just roots[0], truncated to the
// first two with a "+N" affordance so a 5-source pipeline can't blow out the
// row height. The full list always lives in the cell's `title` tooltip.
const MAX_VISIBLE_ROOTS = 2;

function SourcesCell({ roots }: { roots: PipelineRoot[] }) {
  if (roots.length === 0) return <span className="pipeline-list-table__dash">—</span>;
  const names = roots.map((r) => r.dataSourceName);
  const visible = names.slice(0, MAX_VISIBLE_ROOTS);
  const hiddenCount = names.length - visible.length;
  return (
    <span title={names.join(", ")}>
      {visible.join(", ")}
      {hiddenCount > 0 && ` +${hiddenCount}`}
    </span>
  );
}

type SortKey = "name" | "sources" | "lastRunStatus" | "lastRunAt" | "lastRunRowCount" | "updatedAt";

// HEL-1022: the Sources column sorts on the first root's name (falling back
// to null, which sorts last) -- a pipeline's roots are already
// position-ordered, so the first root is the stable, meaningful "primary
// source" to key on, and it matches what the truncated cell shows first.
const SORT_COLUMNS: readonly SortColumn<PipelineSummary, SortKey>[] = [
  { key: "name", getValue: (p) => p.name },
  { key: "sources", getValue: (p) => p.roots[0]?.dataSourceName ?? null },
  { key: "lastRunStatus", getValue: (p) => p.lastRunStatus },
  { key: "lastRunAt", getValue: (p) => p.lastRunAt },
  { key: "lastRunRowCount", getValue: (p) => p.lastRunRowCount },
  { key: "updatedAt", getValue: (p) => p.updatedAt },
];

// HEL-1022 follow-up: "Last run status" wrapped onto two lines against this
// column's narrow content width (26px tall vs. 13px for every other header),
// stretching the whole header row. Shortened to "Status" -- unambiguous next
// to "Last run at" immediately to its right.
//
// The table's default sort key (`updatedAt desc`) must be a visible, sortable
// column, or nothing on first paint shows the user what order they're
// looking at, and sorting away from it leaves no way back. Matches
// `SourceListTable`'s "Updated" column exactly (same relative-time
// formatter, same trailing position).
const HEADER_COLUMNS: readonly SortableTableColumn<SortKey>[] = [
  { key: "name", header: "Name", className: "eyebrow pipeline-list-table__th" },
  { key: "sources", header: "Sources", className: "eyebrow pipeline-list-table__th" },
  { key: "lastRunStatus", header: "Status", className: "eyebrow pipeline-list-table__th" },
  { key: "lastRunAt", header: "Last run at", className: "eyebrow pipeline-list-table__th" },
  { key: "lastRunRowCount", header: "Rows written", className: "eyebrow pipeline-list-table__th" },
  { key: "updatedAt", header: "Updated", className: "eyebrow pipeline-list-table__th" },
];

export function PipelineListTable({ pipelines, currentUserId, onShare }: Props) {
  const showActions = currentUserId != null && onShare != null;
  const navigate = useNavigate();

  // HEL-1022: defaults to most-recently-edited first, matching the backend's
  // own default ordering for first paint.
  const {
    sortedRows: sortedPipelines,
    sortState,
    toggleSort,
  } = useSortedRows(pipelines, SORT_COLUMNS, {
    key: "updatedAt",
    direction: "desc",
  });

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

  return (
    <SortableTable
      tableClassName="pipeline-list-table"
      columns={HEADER_COLUMNS}
      sortState={sortState}
      onSort={toggleSort}
      trailingHeaderCells={
        showActions && (
          <th className="eyebrow pipeline-list-table__th pipeline-list-table__th--actions">
            <span className="sr-only">Actions</span>
          </th>
        )
      }
      scrollClassNames={{
        // Scroll-shadow affordance (HEL a11y/ux sweep F-164) — this table has
        // its own scroll container rather than relying on the page-level
        // `.app-content` scroll region, so the shadow only appears when this
        // table itself actually overflows.
        container: "pipeline-list-table__scroll",
        left: "pipeline-list-table__scroll--left",
        right: "pipeline-list-table__scroll--right",
      }}
    >
      <tbody>
        {sortedPipelines.map((pipeline) => {
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
              <td className="pipeline-list-table__td">
                <SourcesCell roots={pipeline.roots} />
              </td>
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
                  <>
                    {pipeline.lastRunRowCount.toLocaleString() +
                      (pipeline.lastRunRowCount === 1 ? " row" : " rows")}
                    {/* HEL-873 (design.md Decision 4): icon + text, never colour alone.
                          `null`/`false` (not-recorded / complete) both render nothing extra. */}
                    {pipeline.lastRunTruncated === true && <TruncatedRowCountBadge />}
                  </>
                ) : (
                  <span className="pipeline-list-table__dash">—</span>
                )}
              </td>
              <td className="pipeline-list-table__td">
                {/* HEL-1022 (adversarial review finding 3): guard against `""`, not just
                    `null`/`undefined` -- an empty string is truthy for `!= null` and reached
                    `formatRelativeTime("")` -> "NaN years ago" before every backend
                    `PipelineSummaryResponse` construction site guaranteed a real timestamp. */}
                {pipeline.updatedAt ? (
                  formatRelativeTime(pipeline.updatedAt)
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
    </SortableTable>
  );
}
