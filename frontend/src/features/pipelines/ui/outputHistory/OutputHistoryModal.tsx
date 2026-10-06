import { History } from "lucide-react";

import "./OutputHistoryModal.css";
import { EmptyState, Modal, Spinner } from "../../../../shared/ui";
import { InlineError } from "../../../../shared/chrome/InlineError";
import type { Output } from "../../types/output";
import { HistoryChart } from "./HistoryChart";
import { HistoryRows } from "./HistoryRows";
import { HistoryScrubber } from "./HistoryScrubber";
import { HistorySummary } from "./HistorySummary";
import { HISTORY_VIEW_LIMIT, useOutputHistoryView } from "./useOutputHistoryView";

interface OutputHistoryModalProps {
  output: Output;
  onClose: () => void;
}

/** HEL-1277 — one Output's recorded runs: a scrubber over the retained points, the selected point's
 *  summary (and chart, for a chart Output), and its stored rows with a changed-rows highlight
 *  against the next-older retained point when both runs stored them. */
export function OutputHistoryModal({ output, onClose }: OutputHistoryModalProps) {
  const view = useOutputHistoryView(output.id);
  const { loadState, points, selectedIndex, selected, comparison, rowsOf } = view;

  return (
    <Modal
      open
      title={`${output.name} — history`}
      size="xl"
      ariaLabel={`${output.name} history`}
      onClose={onClose}
    >
      <div className="output-history">
        {loadState === "loading" && (
          <div className="output-history__loading" aria-busy="true">
            <Spinner size="sm" /> Loading history…
          </div>
        )}
        {loadState === "error" && (
          <InlineError error="Couldn't load this Output's history." variant="banner" />
        )}
        {loadState === "ready" && points.length === 0 && (
          <EmptyState
            variant="sidebar"
            icon={<History />}
            title="No runs recorded for this Output yet"
            description="Run the pipeline to start recording this Output's history."
          />
        )}
        {loadState === "ready" && selected && (
          <>
            <HistoryScrubber
              points={points}
              selectedIndex={selectedIndex}
              onSelect={view.setSelectedIndex}
            />
            {points.length >= HISTORY_VIEW_LIMIT && (
              <p className="output-history__muted">
                Showing the newest {HISTORY_VIEW_LIMIT} recorded runs
              </p>
            )}
            <HistorySummary output={output} selected={selected} comparison={comparison} />
            {output.kind === "chart" && (
              <HistoryChart output={output} selected={selected} comparison={comparison} />
            )}
            <HistoryRows
              outputId={output.id}
              selected={selected}
              comparison={comparison}
              selectedRows={rowsOf(selected)}
              comparisonRows={rowsOf(comparison)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
