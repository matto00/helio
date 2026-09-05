// LaneColumn — HEL-912 task 3.1. Renders ONE lane (design.md Decision 1) as
// a vertical mini-river of `StepCard`s with its own Outputs rail, plus a
// "+ lane" affordance and a "rejoin" affordance on the lane's terminal
// step. Generalizes HEL-908's `TailChain`: a one-step lane whose step
// carries an Output renders its `.pipeline-detail-page__tail-chain-item`
// ROW (the connector `<span>` + the `<StepCard>` only, nothing else) via
// the SAME markup `TailChain` used (task 3.3/3.5 — the one machine-checked
// DOM contract this design leans on) — skeptic-final-1 CR1/CR2: the "+
// lane" affordance and any child lanes render as SIBLINGS of that row, not
// additional children inside it, so the byte-identity claim is exact, not
// approximate.

import { useState } from "react";

import { BranchAffordance } from "./BranchAffordance";
import { StepCard } from "./StepCard";
import type { OpType, Step } from "../types/step";
import type { PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { Output } from "../types/output";
import type { Lane, LaneGraph } from "../state/stepTree";
import { childLanesOf } from "../state/stepTree";

const EMPTY_OUTPUTS: Output[] = [];
const NOOP_MOVE = undefined;

interface LaneColumnProps {
  lane: Lane;
  laneGraph: LaneGraph;
  allSteps: Step[];
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
  /** "+ lane" affordance (task 4) — offered on every step, not just the
   *  lane's terminal one (design.md Decision 1 removed the single-tail gate
   *  entirely). */
  onAddLaneStep: (opType: OpType, parentStepId: string) => void;
  /** A one-step lane (a tail) renders via the compact
   *  `.pipeline-detail-page__tail-chain-item` markup. Any other lane
   *  (including the primary lane, threaded in as `isCompact={false}`)
   *  renders as full `StepCard`s. */
  isCompact: boolean;
  /** task 7.1 — this lane's 1-based position among its own siblings (the
   *  primary lane never renders one, since it isn't itself a "lane" in the
   *  mobile-header sense). Rendered as a `.pipeline-detail-page__lane-header`
   *  that's hidden at desktop widths (position alone communicates lane
   *  identity there) and revealed once lanes stack at phone widths, where
   *  position no longer does. */
  laneNumber: number;
  /** HEL-968 D3/task 5.3 — per-step R5 runtime path (`root:<rootId> > s1 > s4`),
   *  rendered as each step's `title` tooltip. Computed once by the top-level
   *  `PipelineRiverView` and threaded straight through (mirrors
   *  `outputsByStepId`'s convention). */
  nodePathByStepId: Record<string, string>;
}

export function LaneColumn({
  lane,
  laneGraph,
  allSteps,
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
  onAddLaneStep,
  isCompact,
  laneNumber,
  nodePathByStepId,
}: LaneColumnProps) {
  const [laneDropdownForStepId, setLaneDropdownForStepId] = useState<string | null>(null);
  const [laneAnchorEl, setLaneAnchorEl] = useState<HTMLButtonElement | null>(null);

  if (lane.steps.length === 0) return null;

  function renderAddLaneAffordance(step: Step) {
    return (
      <BranchAffordance
        isOpen={laneDropdownForStepId === step.id}
        anchorEl={laneAnchorEl}
        onOpen={(anchorEl) => {
          setLaneDropdownForStepId(step.id);
          setLaneAnchorEl(anchorEl);
        }}
        onSelect={(opType) => {
          onAddLaneStep(opType, step.id);
          setLaneDropdownForStepId(null);
        }}
        onClose={() => setLaneDropdownForStepId(null)}
      />
    );
  }

  const laneHeader = <div className="pipeline-detail-page__lane-header">Lane {laneNumber}</div>;

  function renderChildLanes(step: Step) {
    const childLanes = childLanesOf(laneGraph, step.id);
    if (childLanes.length === 0) return null;
    return (
      <div className="pipeline-detail-page__lane-row" role="group" aria-label="Lanes">
        {childLanes.map((childLane, index) => (
          <LaneColumn
            key={childLane.id}
            lane={childLane}
            laneGraph={laneGraph}
            allSteps={allSteps}
            pipelineId={pipelineId}
            onRemove={onRemove}
            getAnalyzeColumns={getAnalyzeColumns}
            getAnalyzeSchema={getAnalyzeSchema}
            getAnalyzeOutputSchema={getAnalyzeOutputSchema}
            getAnalyzeValidationError={getAnalyzeValidationError}
            onConfigChange={onConfigChange}
            runStepRowCounts={runStepRowCounts}
            onToggleStepEnabled={onToggleStepEnabled}
            onDuplicateStep={onDuplicateStep}
            enabledBits={enabledBits}
            outputsByStepId={outputsByStepId}
            previewRowCountByOutputId={previewRowCountByOutputId}
            onOpenOutput={onOpenOutput}
            onAddOutput={onAddOutput}
            onAddLaneStep={onAddLaneStep}
            isCompact={childLane.steps.length === 1}
            laneNumber={index + 1}
            nodePathByStepId={nodePathByStepId}
          />
        ))}
      </div>
    );
  }

  if (isCompact) {
    // task 3.1/3.3/skeptic-final-1 CR1 — the `.tail-chain-item` row itself
    // stays BYTE-IDENTICAL to `TailChain`'s markup (just the connector
    // `<span>` and the `<StepCard>` — the one machine-checked DOM contract
    // this design leans on). `renderAddLaneAffordance`/`renderChildLanes`
    // are rendered as SIBLINGS of that row, inside the enclosing
    // `.tail-chain` column (`display: flex; flex-direction: column`), not
    // as additional children of the row itself — the row is
    // `flex-direction: row`, so nesting them there squeezed the card's
    // label into the same horizontal track as its own action icons and
    // floated "Branch" beside the connector instead of beneath the card.
    return (
      <div className="pipeline-detail-page__tail-chain" aria-label="Tail steps">
        {laneHeader}
        {lane.steps.map((step) => (
          <div
            className="pipeline-detail-page__tail-chain-step"
            key={step.id}
            title={nodePathByStepId[step.id]}
          >
            <div className="pipeline-detail-page__tail-chain-item">
              <span className="pipeline-detail-page__tail-chain-connector" aria-hidden="true" />
              <StepCard
                step={step}
                allSteps={allSteps}
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
            {renderAddLaneAffordance(step)}
            {renderChildLanes(step)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="pipeline-detail-page__lane-column" aria-label="Lane">
      {laneHeader}
      {lane.steps.map((step) => (
        <div
          className="pipeline-detail-page__step-section"
          key={step.id}
          title={nodePathByStepId[step.id]}
        >
          <StepCard
            step={step}
            allSteps={allSteps}
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
          />
          {renderAddLaneAffordance(step)}
          {renderChildLanes(step)}
        </div>
      ))}
    </div>
  );
}
