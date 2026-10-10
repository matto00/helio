// StepCardProps — the prop contract of `StepCard` (HEL-1465 split out of StepCard.tsx).

import type { Output } from "../types/output";
import type { AnalyzeWarning, PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";

export interface StepCardProps {
  step: Step;
  /** HEL-912 task 5.3 — every step in the pipeline (across every lane), so
   *  `union`/`lookup`'s `SecondaryInputPicker` can offer "other lane" node
   *  options. Not filtered/derived per-card — the picker itself computes
   *  eligibility (design.md Decision 3). Optional/defaults to `[]` so every
   *  pre-existing non-union/lookup test site (which never exercises this
   *  path) doesn't need updating just to satisfy this prop. */
  allSteps?: Step[];
  /** HEL-1102 (design.md Decision 2) — true only for the pipeline's owner;
   *  passed straight through to `StepOpEditor`'s `UpsertSourceConfig`.
   *  Optional/defaults to `true` so every pre-existing non-upsertsource test
   *  site (which never exercises this path) doesn't need updating just to
   *  satisfy this prop. */
  isOwner?: boolean;
  /** HEL-407 — this step's index in the editor's step list. Threaded down so
   *  the Move up/down buttons know when to disable (design.md Decision 6),
   *  the drag handle can report which step is being dragged (Decision 5),
   *  and the preview-refresh fingerprint can pick up a reorder even though
   *  the UI `Step` type has no persisted `position` field (Decision 9). */
  stepIndex: number;
  pipelineId: string;
  onRemove: (id: string) => void;
  /** Column names from the analyze endpoint's inputSchema for this step — used by SelectFieldsConfig/RenameFieldsConfig/CastFieldsConfig. */
  analyzeColumns: string[];
  /** Full schema fields from the analyze endpoint's inputSchema — used by FilterConfig for type-aware value input. */
  analyzeSchema: SchemaField[];
  /** HEL-404 — this step's output schema (name + type) from the analyze endpoint,
   *  rendered inline in the preview tray alongside the sample rows. Empty when
   *  analyze data for the step is unavailable (pending/failed/unknown step id). */
  analyzeOutputSchema: SchemaField[];
  /** HEL-1340 — whether `analyzeSchema` comes from this step's OWN analyze entry. False while an
   *  already-created draft is still on the anchor-derived fallback schema (no output schema yet),
   *  where a diff would falsely report every field as dropped. Defaults to true. */
  hasOwnAnalyze?: boolean;
  /** This step's analyze-time `validationError`, if any. Rendered generically via
   *  `InlineError` in the expanded card body (skeptic-final-1.md CR1) for every op
   *  except `compute`, which renders it itself inline below the expression input
   *  (`ComputeFieldConfig`) — kept there for its more specific placement, not
   *  double-rendered. */
  validationError?: string;
  /** HEL-1414 — this step's schema-only, NON-BLOCKING analyze warnings. Shown as a header indicator
   *  and, when expanded, a "Check before running" region; never marks the card errored. */
  warnings?: AnalyzeWarning[];
  /** Called after a successful config PATCH so the parent can keep step.config in sync. */
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  /** Output row count from the last run, if available. Null hides the chip. */
  rowCount: number | null;
  /** HEL-407 — the drag handle is the SOLE draggable element (design.md
   *  Decision 5); RiverView owns drop targeting on its own card wrapper. */
  onStepDragStart: (index: number, stepId: string) => void;
  onStepDragEnd: () => void;
  /** Undefined disables the button — RiverView omits the handler at the
   *  first/last position rather than StepCard reasoning about bounds.
   *  F-146 — id-keyed (not `() => void`) so RiverView can hand every
   *  StepCard the *same* stable callback reference instead of allocating a
   *  fresh index-closing arrow per card per render (see
   *  `PipelineRiverView.handleMoveUp`/`handleMoveDown`); StepCard supplies
   *  its own `step.id` at the call site below. */
  onMoveUp?: (stepId: string) => void;
  onMoveDown?: (stepId: string) => void;
  /** HEL-1007 — the lane this card sits in (a root trunk lane's source name). Appended to the Move
   *  buttons' accessible name/title ("Move step up in <lane>") so the controls of different roots'
   *  lanes are distinguishable. Absent keeps the bare "Move step up" name. */
  laneLabel?: string;
  /** HEL-1007 — `false` renders NO drag handle and NO Move buttons (a branch lane: the reorder
   *  endpoint permutes trunk ids only, so a permanently-disabled control there would only mislead).
   *  Defaults to `true`. Independent of `isTail`, which also hides them. */
  reorderable?: boolean;
  /** HEL-412 — persists the disable/enable toggle; the page owns the
   *  optimistic flip + revert-on-failure convention. */
  onToggleEnabled: (stepId: string, enabled: boolean) => void;
  /** HEL-412 — invokes the duplicate endpoint; the page owns splicing the
   *  clone in after the original. */
  onDuplicate: (stepId: string) => void;
  /** HEL-706 — true while this step's own duplicate request is in flight;
   *  disables the "Duplicate step" button only (not the unrelated step
   *  enable/disable toggle, which already overloads `disabled`/`enabled`
   *  vocabulary on this card -- see the CSS `--disabled` modifier below). */
  isDuplicating: boolean;
  /** HEL-412 — the join of every step's enabled flag (design.md Decision 8),
   *  folded into the preview fingerprint so a toggle anywhere refreshes every
   *  open preview tray, not just this card's own. */
  enabledBits: string;
  /** task 3.3 — this step's own Outputs (already filtered/grouped by the
   *  parent's `selectOutputsByStepId`); rendered as an `OutputsRail` chip row
   *  in the card body. */
  outputs: Output[];
  previewRowCountByOutputId: Record<string, number>;
  onOpenOutput: (output: Output) => void;
  onAddOutput: (stepId: string) => void;
  /** HEL-908 task 3.4 — `true` renders this card as an indented, dashed tail
   *  item (`TailChain`'s sole consumer) instead of a top-level trunk card;
   *  hides the Move up/down buttons and drag handle, since tail-internal
   *  reorder shares the same backend `PUT /steps/order` sibling-scoped
   *  primitive that trunk-to-trunk reorder already relies on (untouched by
   *  this ticket — see `execution-progress.md` Cycle 6 for why building new
   *  reorder UI on top of it isn't attempted here). */
  isTail?: boolean;
  /** HEL-1109 (design.md D5) — the pipeline's own estimated row count,
   *  threaded to `StepOpEditor`'s AI-card cost disclosure. */
  estimatedRows?: number;
  /** HEL-1109 (pipeline-ai-step-authoring spec) — this draft's rejected
   *  create message, if its most recent create attempt failed. `undefined`
   *  for a persisted step or a draft with no outstanding failure. */
  draftError?: string;
  /** HEL-1294 — true while this step's optimistic create (POST + resync) is in flight. The resync
   *  swaps the temp id for the persisted one, which remounts this keyed card collapsed, so the
   *  expand toggle is disabled until then (an open editor would be lost, and an edit made on the
   *  temp id is a no-op). Cleared on failure so the kept local step stays openable. */
  isCreating?: boolean;
}
