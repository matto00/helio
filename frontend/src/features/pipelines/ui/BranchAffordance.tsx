// BranchAffordance — HEL-912 (evaluation-1.md non-blocking suggestion,
// issue 8). Extracts the "+ lane" ("Branch") button + hint + `OpDropdown`
// wiring that was duplicated near-verbatim between `PipelineRiverView.tsx`
// and `LaneColumn.tsx` (two copies of the same affordance drift). Fully
// controlled — the caller owns which step's dropdown is open (each caller
// coordinates that against its OWN other open dropdowns, e.g.
// `PipelineRiverView` also closes the gap/bottom-add pickers), this
// component only renders the button/hint/menu for ONE step.

import { OpDropdown } from "./OpDropdown";
import type { OpType } from "../types/step";
import { GitBranch } from "lucide-react";
import { ICON_SIZE } from "../../../shared/ui/iconSize";

interface BranchAffordanceProps {
  isOpen: boolean;
  anchorEl: HTMLButtonElement | null;
  onOpen: (anchorEl: HTMLButtonElement) => void;
  onSelect: (opType: OpType) => void;
  onClose: () => void;
}

export function BranchAffordance({
  isOpen,
  anchorEl,
  onOpen,
  onSelect,
  onClose,
}: BranchAffordanceProps) {
  return (
    <div className="pipeline-detail-page__add-tail-row">
      <button
        type="button"
        className="pipeline-detail-page__add-tail-btn tap-expand-44"
        aria-label="Branch this step into a new lane, without changing the rest of the pipeline"
        title="Branch this step into a new lane, without changing the rest of the pipeline"
        onClick={(e) => onOpen(e.currentTarget)}
      >
        <GitBranch aria-hidden="true" size={ICON_SIZE.sm} /> Branch
      </button>
      {isOpen && (
        <OpDropdown anchorRef={{ current: anchorEl }} onSelect={onSelect} onClose={onClose} />
      )}
    </div>
  );
}
