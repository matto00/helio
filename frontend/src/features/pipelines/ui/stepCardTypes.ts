// FocusedStepCardProps — the prop contract of `StepCardFocused` (the desktop spine's centre editor and the phone's
// step sheet). The river card's `StepCardProps` was retired with the river view (HEL-1582).

import type { AnalyzeWarning, PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";

/** HEL-1579 (design.md D7): the focused step editor -- always expanded, one editor at a time, no expand
 *  toggle/chevron/Outputs rail/Preview tray/drag handle/Move buttons (those live on the spine row, the preview
 *  table and, on the phone, the step sheet's "Step actions" menu). Disable/Duplicate/Remove are quiet text
 *  actions. */
export interface FocusedStepCardProps {
  step: Step;
  allSteps?: Step[];
  isOwner?: boolean;
  /** The step's 1-based number within its lane, as shown on the spine. */
  stepNumber: number;
  onRemove: (id: string) => void;
  analyzeColumns: string[];
  analyzeSchema: SchemaField[];
  validationError?: string;
  warnings?: AnalyzeWarning[];
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  onToggleEnabled: (stepId: string, enabled: boolean) => void;
  onDuplicate: (stepId: string) => void;
  isDuplicating: boolean;
  estimatedRows?: number;
  draftError?: string;
  /** True while this step's optimistic create is in flight: the editor is shown disabled
   *  ("Saving step…") because an edit made on the temp id would be a no-op. */
  isCreating?: boolean;
  /** HEL-1579 (design.md D7): the message of a flushed save that failed after this editor had
   *  unmounted (page-level `stepSaveErrors`), shown in the `InlineError` position on re-select. */
  savedError?: string;
}
