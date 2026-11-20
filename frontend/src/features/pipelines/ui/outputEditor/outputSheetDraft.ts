// outputSheetDraft -- HEL-1733 (design.md D3/D5): what the Output editor sheet needs from the page while a pipeline draft exists. The
// sheet then records its Save/Delete as draft entries through these handlers (never a thunk), reads its node's columns from the
// draft, and renders its preview from the draft frames. With no draft the sheet is given none and keeps its immediate path.

import type { DraftFrames } from "../../hooks/usePipelineDraftFrames";
import { frameToRecords } from "../../state/liveOutput/frameRecords";
import type { SelectOption } from "../../../../shared/ui/index";
import { isTempStepId } from "../../state/stepNarrowing";
import type { Step } from "../../types/step";
import type { DraftTyping } from "../../hooks/useDraftNodeCapabilities";
import type { RunResult } from "../../types/output";
import type { PipelineRoot } from "../../types/pipelineStep";

export const DRAFT_SHEET_HINT = "Saved with the draft on Save & run";
export const CHECKING_TYPES_HINT = "Checking column types…";
export const TYPES_UNAVAILABLE_HINT =
  "Column types could not be checked; Save & run the draft first";
export const PICK_STEP_HINT = "Pick a step: this pipeline has several sources";

export interface OutputSheetDraft {
  pipelineName: string;
  roots: PipelineRoot[];
  /** The draft frames the active layout last published for the sheet's node (`null` before the first publish). */
  frames: DraftFrames | null;
  onNodeChange: (stepId: string | undefined) => void;
}

/** The kinds with a Numeric or Orderable slot: the only ones the sheet cannot save without the server's typed schema. */
export const TYPE_RESTRICTED_KINDS: ReadonlySet<string> = new Set([
  "chart",
  "metric",
  "collection",
  "timeline",
]);

/** The draft's rows for the sheet's node: a step's displayed frame (else the saved pipeline's over the same sample), or the root's
 *  sample frame for a node-less Output. */
export function draftNodeFrame(
  frames: DraftFrames | null,
  nodeStepId: string | undefined,
  rootId: string | undefined,
) {
  if (frames === null) return null;
  if (nodeStepId === undefined)
    return rootId === undefined ? null : (frames.rootRows.get(rootId) ?? null);
  return frames.views?.get(nodeStepId)?.rows ?? frames.baseRows?.get(nodeStepId) ?? null;
}

/** A preview result for the sheet's pane, from a draft frame (the same shape the server preview returns). */
export function runResultFromFrame(
  frame: NonNullable<ReturnType<typeof draftNodeFrame>>,
): RunResult {
  const rows = frameToRecords(frame, []);
  return {
    rows,
    rowCount: rows.length,
    stepRowCounts: {},
    sourceRowCount: rows.length,
    blocked: false,
    sourceTruncated: false,
    truncatedReads: [],
    // The draft frame is uncut: `rows` is every row, so `rowCount` is exact.
    rowsTruncated: false,
  };
}

/** What the sheet derives from the draft: the step picker (a not-yet-created `step-N` step has no row to bind to, and with several
 *  sources "Pipeline source" names none of them), whether Save waits for a step pick or for the column types, and the footer hint. */
export function draftSheetState(args: {
  draft: OutputSheetDraft | undefined;
  steps: readonly Step[];
  isCreate: boolean;
  nodeStepId: string | undefined;
  kind: string;
  typing: DraftTyping;
}) {
  const { draft, steps, isCreate, nodeStepId, kind, typing } = args;
  const inDraft = draft !== undefined;
  const severalRoots = (draft?.roots.length ?? 0) > 1;
  const restricted = TYPE_RESTRICTED_KINDS.has(kind);
  const stepOptions: SelectOption[] = [
    { value: "", label: "Pipeline source", disabled: inDraft && severalRoots },
    ...steps
      .filter((s) => !(inDraft && isTempStepId(s.id)))
      .map((s) => ({ value: s.id, label: s.label })),
  ];
  const needsStepPick = inDraft && isCreate && nodeStepId === undefined && severalRoots;
  const typeBlocked =
    inDraft && (typing === "checking" || (typing === "unavailable" && restricted));
  const hint = !inDraft
    ? null
    : typing === "checking"
      ? CHECKING_TYPES_HINT
      : typing === "unavailable" && restricted
        ? TYPES_UNAVAILABLE_HINT
        : DRAFT_SHEET_HINT;
  return { stepOptions, needsStepPick, saveWaits: typeBlocked || needsStepPick, hint };
}
