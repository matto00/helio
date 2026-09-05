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
import { buildLaneGraph, type LaneGraph, type LaneGraphRoot } from "../state/stepTree";
import { computeLaneLayout, type LaneLayout } from "../state/laneLayout";
import type { PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { PipelineProposalSource, PipelineProposalStep } from "../types/pipelineProposal";

// HEL-968 — a proposal's roots have no persisted id yet (`clientId` is
// optional and only REQUIRED, by the backend, once a proposal has more than
// one root -- see `PipelineProposalStep.rootClientId`'s own doc comment).
// This synthesizes a stable id per root so `buildLaneGraph`'s (D1) required
// `roots` parameter has something to seed lanes from even for a
// single-root proposal, whose steps carry no `rootClientId` at all.
function syntheticRootId(root: PipelineProposalSource, index: number): string {
  return root.clientId ?? `root-${index}`;
}

export function proposalStepsToSteps(
  steps: PipelineProposalStep[],
  roots: PipelineProposalSource[],
): Step[] {
  // A parentless proposal step's root is `rootClientId` when the proposal
  // has multiple roots (required there); with exactly one root it may be
  // omitted, so it implicitly belongs to that one root.
  const fallbackRootId = roots.length > 0 ? syntheticRootId(roots[0], 0) : undefined;
  return steps.map((s, index) => {
    const fakeWireStep = {
      id: s.clientId,
      type: s.type,
      config: s.config,
      enabled: s.enabled ?? true,
      parentStepId: s.parentStepId ?? undefined,
      position: index,
      rootId: s.parentStepId ? undefined : (s.rootClientId ?? fallbackRootId),
    } as unknown as PipelineStep;
    return pipelineStepToStep(fakeWireStep);
  });
}

export interface ProposalLaneGraph {
  steps: Step[];
  graph: LaneGraph;
  layout: LaneLayout;
}

export function buildProposalLaneGraph(
  steps: PipelineProposalStep[],
  roots: PipelineProposalSource[],
): ProposalLaneGraph {
  const laneRoots: LaneGraphRoot[] = roots.map((r, i) => ({ id: syntheticRootId(r, i) }));
  const stepObjs = proposalStepsToSteps(steps, roots);
  const graph = buildLaneGraph(stepObjs, laneRoots);
  const layout = computeLaneLayout(graph);
  return { steps: stepObjs, graph, layout };
}
