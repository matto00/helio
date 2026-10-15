// PipelineDetailDialogs -- HEL-1579: the dialogs the pipeline detail page opens (Output editor sheet, Output
// History view, run history, share, schedule), rendered as a SIBLING of whichever layout is showing (the phone's
// river view or the desktop step spine) rather than inside it. A layout that is swapped by crossing the 768px
// phone boundary (a window resize, a device rotation) therefore does not unmount an open dialog and lose its
// state (a History scrubber position, a half-typed Output name). All state lives in `usePipelineDetailPage`.

import type { usePipelineDetailPage } from "../hooks/usePipelineDetailPage";
import { OutputEditorSheet } from "./outputEditor/OutputEditorSheet";
import { OutputHistoryModal } from "./outputHistory/OutputHistoryModal";
import { PipelineScheduleDialog } from "./schedule/PipelineScheduleDialog";
import { PipelineShareDialog } from "./PipelineShareDialog";
import { RunHistoryModal } from "./RunHistoryModal";

type PipelinePageState = ReturnType<typeof usePipelineDetailPage>;

export function PipelineDetailDialogs({ page }: { page: PipelinePageState }) {
  const { id } = page;
  return (
    <>
      {/* ── Output editor sheet (task 5.1) ── */}
      {page.outputSheet && (
        <OutputEditorSheet
          // Remount per Output (create mode keyed by its target step) so a `?outputId=` swap
          // reseeds ALL of the sheet's state, not just name/kind/step.
          key={page.outputSheet.output?.id ?? `create:${page.outputSheet.createTargetStepId ?? ""}`}
          open
          onClose={page.handleCloseOutputSheet}
          pipelineId={id ?? ""}
          output={page.outputSheet.output}
          createTargetStepId={page.outputSheet.createTargetStepId}
          steps={page.steps}
          onAddAsTailWithAggregate={page.handleAddOutputViaAggregateTail}
          onRunPipeline={() => void page.handleRunPipeline()}
        />
      )}

      {/* ── Output history view (HEL-1277) ── */}
      {page.historyOutput && (
        <OutputHistoryModal
          key={page.historyOutput.id}
          output={page.historyOutput}
          onClose={page.handleCloseOutputHistory}
        />
      )}

      {/* ── Run history modal (opened from the header's actions menu) ── */}
      {page.historyOpen && (
        <RunHistoryModal
          runs={page.runs}
          view={page.runHistoryView}
          onRetry={page.retryRunHistory}
          onClose={page.closeRunHistory}
        />
      )}

      {/* ── Share dialog (owner-only) ── */}
      {id && (
        <PipelineShareDialog
          pipelineId={id}
          pipelineName={page.pipelineName}
          open={page.shareOpen}
          onClose={() => page.setShareOpen(false)}
        />
      )}

      {/* ── Schedule dialog ── */}
      {id && (
        <PipelineScheduleDialog
          pipelineId={id}
          schedule={page.pipelineSchedule}
          open={page.scheduleOpen}
          onClose={() => page.setScheduleOpen(false)}
        />
      )}
    </>
  );
}
