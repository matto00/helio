// MobileStepSheet -- HEL-1582 (design.md D5): a step's focused editor in a full-height bottom sheet, above that
// step's preview table, with a "Step actions" menu. The editor is keyed by the step's RENDER key (stable through an
// AI draft's temp -> server id swap), so a re-key never replays the sheet's entrance: only the editor remounts. Every
// step kind is editable through the same `StepCardFocused` the desktop uses; an edit goes into the page's client-only
// draft (HEL-1631), so closing the sheet loses nothing.

import { ActionsMenu } from "../../../../shared/chrome/ActionsMenu";
import { BottomSheet } from "../../../../shared/motion/BottomSheet";
import type { usePipelineDraftPresentation } from "../../hooks/usePipelineDraftPresentation";
import type { InFlightDedupe } from "../../state/inFlightDedupe";
import { stepRenderKey } from "../../state/stepTree";
import type { Lane } from "../../state/stepTree";
import type { Step } from "../../types/step";
import { StepCardFocused } from "../StepCardFocused";
import type { PipelinePageState } from "../spine/PipelineSpineLayout";
import { StepPreviewTable } from "../spine/StepPreviewTable";
import type { SpineStepActions } from "../spine/useSpineStepActions";

export interface OpenStep {
  step: Step;
  lane: Lane;
  /** 0-based index within its lane. */
  index: number;
}

/** After a Move from the sheet's menu the menu has closed and the moved row behind the modal is inert, so focus goes
 *  back to the sheet's own "Step actions" trigger rather than dropping to the body. */
function focusSheetActionsTrigger() {
  document
    .querySelector<HTMLElement>(
      "dialog.mobile-step-sheet[open] .ui-modal__header .actions-menu__trigger",
    )
    ?.focus();
}

export function MobileStepSheet({
  open,
  onClosed,
  page,
  actions,
  dedupe,
  beforeFetch,
  stepSaveErrors,
  onToggleEnabled,
  presentation,
}: {
  /** The open step, or `undefined` when closed. */
  open: OpenStep | undefined;
  onClosed: () => void;
  page: PipelinePageState;
  actions: SpineStepActions;
  dedupe: InFlightDedupe;
  beforeFetch: () => Promise<void>;
  stepSaveErrors: Record<string, string>;
  onToggleEnabled: (stepId: string, enabled: boolean) => void;
  presentation: ReturnType<typeof usePipelineDraftPresentation>;
}) {
  const step = open?.step;
  const draftSchema = step ? presentation.inputSchemaFor(step) : null;
  return (
    <BottomSheet
      open={open !== undefined}
      title="Edit step"
      ariaLabel="Step editor"
      className="mobile-step-sheet"
      onClosed={onClosed}
      headerActions={
        open ? (
          <ActionsMenu
            label={`Step actions for ${open.step.label}`}
            items={actions.menuItemsFor(open.step, open.lane, open.index, focusSheetActionsTrigger)}
          />
        ) : null
      }
    >
      {open && step && (
        <div className="mobile-step-sheet__content">
          <StepCardFocused
            key={`editor:${stepRenderKey(step)}`}
            step={step}
            allSteps={page.steps}
            isOwner={page.isOwner}
            stepNumber={open.index + 1}
            onRemove={page.handleRemoveStep}
            analyzeColumns={draftSchema?.map((f) => f.name) ?? page.getAnalyzeColumns(step.id)}
            analyzeSchema={draftSchema ?? page.getAnalyzeSchema(step.id)}
            validationError={page.getAnalyzeValidationError(step.id)}
            warnings={page.getAnalyzeWarnings(step.id)}
            onConfigChange={page.handleStepConfigChange}
            onToggleEnabled={onToggleEnabled}
            onDuplicate={page.handleDuplicateStep}
            isDuplicating={page.duplicatingStepIds.has(step.id)}
            estimatedRows={page.estimatedRows}
            draftError={page.draftCreateErrors[step.id]}
            isCreating={page.creatingStepIds.has(step.id)}
            savedError={stepSaveErrors[step.id]}
            structuralBlockedReason={presentation.structuralBlockedReason}
            draftPreviewError={presentation.previewErrorFor(step.id)}
          />
          <StepPreviewTable
            key={`preview:${step.id}`}
            pipelineId={page.id ?? ""}
            step={step}
            stepNumber={open.index + 1}
            stepIndex={open.index}
            enabledBits={presentation.savedEnabledBits}
            analyzeSchema={draftSchema ?? page.getAnalyzeSchema(step.id)}
            analyzeOutputSchema={page.getAnalyzeOutputSchema(step.id)}
            hasOwnAnalyze={page.hasOwnAnalyzeEntry(step.id)}
            isCreating={page.creatingStepIds.has(step.id)}
            dedupe={dedupe}
            beforeFetch={beforeFetch}
            draft={presentation.previewDraftFor(step.id)}
          />
        </div>
      )}
    </BottomSheet>
  );
}
