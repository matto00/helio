// HEL-914 task 6.8 — adapts a `PipelineProposal`'s loose `steps[]` (keyed by request-scoped
// `clientId`, not a real persisted `id`) into the SAME `Step[]`/`LaneGraph`/`LaneLayout` shapes
// `PipelineRiverView`/`LaneColumn` use for a persisted pipeline, so the proposal review UI reuses
// `buildLaneGraph`/`computeLaneLayout` (HEL-912/design.md decision) rather than a second,
// proposal-only lane-grouping implementation. `clientId` stands in for `id` here — a proposal
// step has no persisted id yet, and `clientId` is exactly the stable, request-scoped identifier
// `parentStepId`/`nodeStepClientId` already address it by.
//
// `pipelineStepToStep` (the real, persisted-pipeline converter) is reused for its `OpType`
// lookup/`join`-special-case logic, via a structurally-compatible object rather than a second
// lookup table — the loose cast below is deliberate and matches this whole review surface's
// documented "never validates/edits config client-side" convention (PipelineProposalSummary's
// own design.md D4).

import { pipelineStepToStep } from "../state/stepNarrowing";
import { buildLaneGraph, type LaneGraph } from "../state/stepTree";
import { computeLaneLayout, type LaneLayout } from "../state/laneLayout";
import type { PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { PipelineProposalStep } from "../types/pipelineProposal";

export function proposalStepsToSteps(steps: PipelineProposalStep[]): Step[] {
  return steps.map((s, index) => {
    const fakeWireStep = {
      id: s.clientId,
      type: s.type,
      config: s.config,
      enabled: s.enabled ?? true,
      parentStepId: s.parentStepId ?? undefined,
      position: index,
    } as unknown as PipelineStep;
    return pipelineStepToStep(fakeWireStep);
  });
}

export interface ProposalLaneGraph {
  steps: Step[];
  graph: LaneGraph;
  layout: LaneLayout;
}

export function buildProposalLaneGraph(steps: PipelineProposalStep[]): ProposalLaneGraph {
  const stepObjs = proposalStepsToSteps(steps);
  const graph = buildLaneGraph(stepObjs);
  const layout = computeLaneLayout(graph);
  return { steps: stepObjs, graph, layout };
}
