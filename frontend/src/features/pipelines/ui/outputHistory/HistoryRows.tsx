import { useMemo } from "react";

import { Spinner } from "../../../../shared/ui";
import type { ColumnDef } from "../../../../shared/ui";
import { formatCapturePair } from "../../../panels/history/formatCaptureTime";
import type { HistoryPoint } from "../../../panels/history/outputHistoryService";
import { TableRenderer } from "../../../panels/ui/renderers/TableRenderer";
import { diffRows, type HistoryRow } from "../../utils/diffRows";
import type { PointRowsState } from "./useOutputHistoryView";

interface HistoryRowsProps {
  outputId: string;
  selected: HistoryPoint;
  comparison: HistoryPoint | null;
  selectedRows: PointRowsState | undefined;
  comparisonRows: PointRowsState | undefined;
}

const CHANGE_COLUMN: ColumnDef = {
  key: "__history_change__",
  header: "Change",
  width: 150,
};

/** HEL-1277 design D6/D7 — the stored rows of the selected point, with the whole-row multiset diff
 *  against the comparison point. The diff exists ONLY when both payloads are loaded: a payload that
 *  is absent, loading or failed disables it and never reads as removed rows. */
export function HistoryRows({
  outputId,
  selected,
  comparison,
  selectedRows,
  comparisonRows,
}: HistoryRowsProps) {
  const rows: HistoryRow[] | null = selectedRows?.status === "ready" ? selectedRows.rows : null;
  const diff = useMemo(
    () => (rows && comparisonRows?.status === "ready" ? diffRows(rows, comparisonRows.rows) : null),
    [rows, comparisonRows],
  );
  const leadingColumns = useMemo<ColumnDef[] | undefined>(
    () =>
      diff
        ? [
            {
              ...CHANGE_COLUMN,
              render: (row) => (diff.changed.has(row) ? "New or changed" : ""),
            },
          ]
        : undefined,
    [diff],
  );
  const rowClassName = useMemo(
    () =>
      diff
        ? (row: HistoryRow) => (diff.changed.has(row) ? "output-history__row--changed" : undefined)
        : undefined,
    [diff],
  );

  if (selected.hasPayload !== true) {
    return (
      <p className="output-history__note">Rows weren&rsquo;t stored for this run — summary only.</p>
    );
  }
  if (selectedRows?.status === "error") {
    return (
      <p className="output-history__error" role="alert">
        Couldn&rsquo;t load the stored rows for this run.
      </p>
    );
  }
  if (!rows) {
    return (
      <div className="output-history__loading" aria-busy="true">
        <Spinner size="sm" /> Loading stored rows…
      </div>
    );
  }

  let comparisonNote: string | null = null;
  let comparisonError: string | null = null;
  if (comparison) {
    const when = formatCapturePair(selected.capturedAt, comparison.capturedAt).comparison;
    if (comparisonRows?.status === "error") {
      comparisonError = `Couldn’t load the stored rows from ${when} to compare.`;
    } else if (diff) {
      comparisonNote =
        diff.noLongerPresent > 0
          ? `${diff.noLongerPresent.toLocaleString()} ${diff.noLongerPresent === 1 ? "row" : "rows"} from ${when} no longer present`
          : diff.changed.size === 0
            ? `No row changes vs ${when}`
            : null;
    } else if (comparisonRows?.status === "loading") {
      comparisonNote = "Comparing rows…";
    } else {
      comparisonNote = "Row comparison unavailable — rows weren’t stored for one of these runs.";
    }
  }

  return (
    <div className="output-history__rows">
      <p className="output-history__caption">All columns stored for this run</p>
      <div className="output-history__table">
        <TableRenderer
          outputId={outputId}
          paginationRows={rows}
          rowsTruncated={false}
          leadingColumns={leadingColumns}
          rowClassName={rowClassName}
          disablePinning
        />
      </div>
      {comparisonError && (
        <p className="output-history__error" role="alert">
          {comparisonError}
        </p>
      )}
      {comparisonNote && <p className="output-history__note">{comparisonNote}</p>}
    </div>
  );
}
