// BranchAffordance — HEL-912 (evaluation-1.md non-blocking suggestion,
// issue 8). Extracts the "+ lane" ("Branch") button + hint + step palette
// wiring that was duplicated near-verbatim between `PipelineRiverView.tsx`
// and `LaneColumn.tsx` (two copies of the same affordance drift). Fully
// controlled — the caller owns which step's palette is open (each caller
// coordinates that against its OWN other open pickers, e.g.
// `PipelineRiverView` also closes the gap/bottom-add pickers), this
// component only renders the button/hint/palette for ONE step.
//
// HEL-1136: `StepPalette` renders on the shared `Modal` (centered, not
// anchored to the trigger), so unlike the old `OpDropdown` this affordance
// no longer needs to capture/thread the trigger's DOM node.

import { StepPalette } from "./StepPalette";
import type { OpType } from "../types/step";
import { GitBranch } from "lucide-react";
import { ICON_SIZE } from "../../../shared/ui/iconSize";

interface BranchAffordanceProps {
  isOpen: boolean;
  onOpen: () => void;
  onSelect: (opType: OpType) => void;
  onClose: () => void;
}

export function BranchAffordance({ isOpen, onOpen, onSelect, onClose }: BranchAffordanceProps) {
  return (
    <div className="pipeline-detail-page__add-tail-row">
      <button
        type="button"
        className="pipeline-detail-page__add-tail-btn tap-expand-44"
        aria-label="Branch this step into a new lane, without changing the rest of the pipeline"
        title="Branch this step into a new lane, without changing the rest of the pipeline"
        onClick={onOpen}
      >
        <GitBranch aria-hidden="true" size={ICON_SIZE.sm} /> Branch
      </button>
      {/* HEL-1136 evaluation-1.md CR1 — `open` is the real boolean, not a conditional-mount
       * `{isOpen && <StepPalette open .../>}`: `Modal`'s focus-restore effect only runs on a
       * true->false `open` transition, never on unmount, so unmounting on close silently drops
       * focus to `<body>` on Escape instead of restoring it to this trigger button. */}
      <StepPalette open={isOpen} onSelect={onSelect} onClose={onClose} />
    </div>
  );
}
