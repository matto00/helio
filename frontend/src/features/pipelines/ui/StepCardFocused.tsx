// StepCardFocused -- HEL-1579 (design.md D7): the desktop "focused" variant of `StepCard`. One step's
// editor at a time, always expanded: header "Step <n> <label>" with its markers, quiet text actions
// Disable/Enable, Duplicate and Remove, the warnings region, validation/draft errors, and the same
// `StepOpEditor` if-ladder every step kind already uses (so every kind stays editable).
//
// Persistence (HEL-1631): an edit goes into the page's client-only draft synchronously and nothing is sent to the
// server until Save & run, so selecting another step (which unmounts this editor, keyed by the step) never loses an
// edit and there is nothing to flush or cancel. Disable/Enable and Remove are draft edits too; Duplicate is a
// structural operation, unavailable while a draft exists.

import { useId } from "react";
import { TriangleAlert } from "lucide-react";

import { InlineError } from "../../../shared/chrome/InlineError";
import { StatusChip } from "../../../shared/ui/index";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { useStepCardState } from "../hooks/useStepCardState";
import { isTempStepId } from "../state/stepNarrowing";
import { StepCardWarnings } from "./StepCardWarnings";
import { StepOpEditor } from "./StepOpEditor";
import type { FocusedStepCardProps } from "./stepCardTypes";
import "./StepCardFocused.css";

const EMPTY_ALL_STEPS: FocusedStepCardProps["allSteps"] = [];

export function StepCardFocused({
  step,
  allSteps = EMPTY_ALL_STEPS,
  isOwner = true,
  stepNumber,
  onRemove,
  analyzeColumns,
  analyzeSchema,
  validationError,
  warnings,
  onConfigChange,
  onToggleEnabled,
  onDuplicate,
  isDuplicating,
  estimatedRows,
  draftError,
  isCreating = false,
  savedError,
  structuralBlockedReason = null,
  draftPreviewError = null,
}: FocusedStepCardProps) {
  const stepCardState = useStepCardState(step, onConfigChange);
  const warningsHeadingId = useId();
  const warningCount = warnings?.length ?? 0;
  const isDraft = isTempStepId(step.id);

  return (
    <section
      className={`step-focused${!step.enabled ? " step-focused--disabled" : ""}`}
      aria-label={`Step ${stepNumber} ${step.label}`}
    >
      <header className="step-focused__header">
        <h2 className="step-focused__title">
          <span className="step-focused__number">Step {stepNumber}</span>
          <span className="step-focused__label">{step.label}</span>
        </h2>
        {isDraft && (
          <StatusChip intent="neutral" dashed>
            Draft — not yet saved
          </StatusChip>
        )}
        {validationError && (
          <span
            className="step-focused__marker step-focused__marker--error"
            role="img"
            aria-label="Step has a validation error"
          >
            <TriangleAlert aria-hidden="true" size={ICON_SIZE.sm} />
          </span>
        )}
        {warningCount > 0 && (
          <span
            className="step-focused__marker step-focused__marker--warning"
            role="img"
            aria-label={`${warningCount} schema ${warningCount === 1 ? "warning" : "warnings"}`}
          >
            <TriangleAlert aria-hidden="true" size={ICON_SIZE.sm} />
            {warningCount > 1 && <span aria-hidden="true">{warningCount}</span>}
          </span>
        )}
        <div className="step-focused__actions">
          <button
            type="button"
            className="step-focused__action"
            aria-label={step.enabled ? "Disable step" : "Enable step"}
            aria-pressed={!step.enabled}
            onClick={() => onToggleEnabled(step.id, !step.enabled)}
          >
            {step.enabled ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            className="step-focused__action"
            aria-label="Duplicate step"
            disabled={isDuplicating || structuralBlockedReason !== null}
            title={structuralBlockedReason ?? undefined}
            onClick={() => onDuplicate(step.id)}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="step-focused__action step-focused__action--danger"
            aria-label="Remove step"
            onClick={() => onRemove(step.id)}
          >
            Remove
          </button>
        </div>
      </header>

      {warningCount > 0 && (
        <StepCardWarnings warnings={warnings} warningsHeadingId={warningsHeadingId} />
      )}

      <div className="step-focused__body">
        {step.opType.id !== "compute" && <InlineError error={validationError ?? null} />}
        <InlineError error={draftError ?? null} />
        <InlineError error={savedError ?? null} />
        <InlineError error={draftPreviewError} />
        {isCreating && (
          <p className="step-focused__saving" role="status">
            Saving step…
          </p>
        )}
        {/* A step being created has no server row yet: edits made on its temp id would be lost,
            so the editor is disabled until the create resolves (HEL-1294). */}
        <fieldset className="step-focused__fieldset" disabled={isCreating}>
          <StepOpEditor
            step={step}
            allSteps={allSteps}
            analyzeColumns={analyzeColumns}
            analyzeSchema={analyzeSchema}
            validationError={validationError}
            isOwner={isOwner}
            estimatedRows={estimatedRows}
            stepCardState={stepCardState}
          />
        </fieldset>
      </div>
    </section>
  );
}
