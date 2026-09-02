// TailChain — HEL-908 task 3.4. Renders one trunk node's tail (if any) as an
// indented, dashed-connector sub-list nested beneath that node's `StepCard`.
// Reuses `StepCard` itself for each tail step (`isTail` prop — hides the
// Move up/down buttons, drag handle, and "+ tail" affordance; see that
// prop's doc for why tail-internal reorder isn't wired up here) so a tail
// step gets the exact same expand/preview/duplicate/enable-disable
// behavior a trunk step gets, without duplicating that markup.

import type { PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { Output } from "../types/output";
import type { Step } from "../types/step";
import { StepCard } from "./StepCard";

interface TailChainProps {
  steps: Step[];
  pipelineId: string;
  onRemove: (id: string) => void;
  getAnalyzeColumns: (stepId: string) => string[];
  getAnalyzeSchema: (stepId: string) => SchemaField[];
  getAnalyzeOutputSchema: (stepId: string) => SchemaField[];
  getAnalyzeValidationError: (stepId: string) => string | undefined;
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  runStepRowCounts: Record<string, number> | null | undefined;
  onToggleStepEnabled: (stepId: string, enabled: boolean) => void;
  onDuplicateStep: (stepId: string) => void;
  enabledBits: string;
  outputsByStepId: Record<string, Output[]>;
  previewRowCountByOutputId: Record<string, number>;
  onOpenOutput: (output: Output) => void;
  onAddOutput: (stepId: string) => void;
}

// F-146 — same stable-empty-array/no-op precedent `PipelineRiverView` uses
// (`EMPTY_OUTPUTS`), since tail `StepCard`s are wrapped in the same `memo`.
const EMPTY_OUTPUTS: Output[] = [];
const NOOP_MOVE = undefined;

export function TailChain({
  steps,
  pipelineId,
  onRemove,
  getAnalyzeColumns,
  getAnalyzeSchema,
  getAnalyzeOutputSchema,
  getAnalyzeValidationError,
  onConfigChange,
  runStepRowCounts,
  onToggleStepEnabled,
  onDuplicateStep,
  enabledBits,
  outputsByStepId,
  previewRowCountByOutputId,
  onOpenOutput,
  onAddOutput,
}: TailChainProps) {
  if (steps.length === 0) return null;

  return (
    <div className="pipeline-detail-page__tail-chain" aria-label="Tail steps">
      {steps.map((step) => (
        <div className="pipeline-detail-page__tail-chain-item" key={step.id}>
          <span className="pipeline-detail-page__tail-chain-connector" aria-hidden="true" />
          <StepCard
            step={step}
            stepIndex={-1}
            pipelineId={pipelineId}
            onRemove={onRemove}
            analyzeColumns={getAnalyzeColumns(step.id)}
            analyzeSchema={getAnalyzeSchema(step.id)}
            analyzeOutputSchema={getAnalyzeOutputSchema(step.id)}
            validationError={getAnalyzeValidationError(step.id)}
            onConfigChange={onConfigChange}
            rowCount={runStepRowCounts?.[step.id] ?? null}
            onStepDragStart={() => {}}
            onStepDragEnd={() => {}}
            onMoveUp={NOOP_MOVE}
            onMoveDown={NOOP_MOVE}
            onToggleEnabled={onToggleStepEnabled}
            onDuplicate={onDuplicateStep}
            enabledBits={enabledBits}
            outputs={outputsByStepId[step.id] ?? EMPTY_OUTPUTS}
            previewRowCountByOutputId={previewRowCountByOutputId}
            onOpenOutput={onOpenOutput}
            onAddOutput={onAddOutput}
            isTail
          />
        </div>
      ))}
    </div>
  );
}
