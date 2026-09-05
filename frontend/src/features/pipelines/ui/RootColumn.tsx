// RootColumn — HEL-968 task 6. Renders ONE non-primary root as its own lane
// column head, labelled with the root's `dataSourceName` (never styled or
// labelled "primary"/"trunk" -- R3), plus a remove-root affordance (task 9).
// Reuses `LaneColumn` for the root's own steps (if any) rather than a
// second step-rendering implementation -- an empty root (task 6.2) renders
// an empty-lane affordance instead of `LaneColumn`'s own
// `lane.steps.length === 0` early-return-null, so the column never vanishes.

import { LaneColumn } from "./LaneColumn";
import type { OpType, Step } from "../types/step";
import type { PipelineRoot, PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { Output } from "../types/output";
import type { Lane, LaneGraph } from "../state/stepTree";

interface RootColumnProps {
  root: PipelineRoot;
  /** This root's own root-level lane, or `undefined` if `buildLaneGraph`
   *  somehow omitted it (shouldn't happen -- task 3.3 guarantees an entry
   *  for every root). */
  lane: Lane | undefined;
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
  onAddLaneStep: (opType: OpType, parentStepId: string) => void;
  /** task 9 — root removal is refused server-side on the last root (R7); the
   *  affordance itself stays offered (the server's named refusal is what
   *  renders, design.md D5), but disabling it when there is nothing else to
   *  fall back to avoids a guaranteed-failing round trip for the common
   *  single-root case. */
  onRemoveRoot: (rootId: string) => void;
  canRemove: boolean;
  /** HEL-968 D3/task 5.3 — passed straight through to `LaneColumn`. */
  nodePathByStepId: Record<string, string>;
}

export function RootColumn({
  root,
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
  onRemoveRoot,
  canRemove,
  nodePathByStepId,
}: RootColumnProps) {
  const hasSteps = (lane?.steps.length ?? 0) > 0;

  return (
    <div className="pipeline-detail-page__root-column" aria-label={`Root: ${root.dataSourceName}`}>
      <div className="pipeline-detail-page__root-column-header">
        <span className="pipeline-detail-page__root-column-title">{root.dataSourceName}</span>
        <button
          type="button"
          className="pipeline-detail-page__root-column-remove-btn"
          aria-label={`Remove root ${root.dataSourceName}`}
          disabled={!canRemove}
          onClick={() => onRemoveRoot(root.id)}
        >
          Remove
        </button>
      </div>
      {hasSteps && lane ? (
        <LaneColumn
          lane={lane}
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
          isCompact={false}
          laneNumber={1}
          nodePathByStepId={nodePathByStepId}
        />
      ) : (
        // task 6.2 — an empty root renders an affordance rather than
        // vanishing (`LaneColumn` itself returns null for a zero-step lane).
        <div className="pipeline-detail-page__root-column-empty">
          No steps yet — join this source into another lane&apos;s step to use it.
        </div>
      )}
    </div>
  );
}
