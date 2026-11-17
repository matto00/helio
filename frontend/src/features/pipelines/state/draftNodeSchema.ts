// draftNodeSchema -- HEL-1733 (design.md D5): the typed schema of a node of the DRAFT, from the server's own projection
// (`POST /api/pipelines/analyze-proposal`, the same `analyzeNodes` the saved projection uses), never inferred from rows. This file
// builds the request from the draft steps and reads one node's schema out of the response. Pure.

import type { OutputSchemaField } from "../types/output";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { isTempStepId } from "./stepNarrowing";

export interface AnalyzeProposalStep {
  clientId: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
  parentStepId?: string;
  rootClientId?: string;
}

export interface AnalyzeProposalRequest {
  pipelineName: string;
  roots: { sourceId: string; clientId: string }[];
  steps: AnalyzeProposalStep[];
  outputs: never[];
}

export interface AnalyzeProposalResponse {
  sourceSchemas: { rootId: string; dataSourceName: string; sourceSchema: OutputSchemaField[] }[];
  steps: { id: string; outputSchema: OutputSchemaField[] }[];
}

/** The nearest non-temp ancestor id of `step` (or `undefined`), walking draft parent links. */
function realParentOf(step: Step, byId: ReadonlyMap<string, Step>): string | undefined {
  let parentId = step.parentStepId ?? undefined;
  const seen = new Set<string>();
  while (parentId !== undefined && isTempStepId(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentStepId ?? undefined;
  }
  return parentId;
}

/** The root a step chain ends at (through temp steps too). */
function rootOf(step: Step, byId: ReadonlyMap<string, Step>): string | undefined {
  let cur: Step | undefined = step;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parentStepId == null) return cur.rootId ?? undefined;
    cur = byId.get(cur.parentStepId);
  }
  return undefined;
}

/** One entry per draft step (temp `step-N` steps excluded: the server has no row for them), `enabled` sent for EVERY step so a
 *  disabled one stays transparent. A step whose parent is a temp step is re-pointed to that temp step's own nearest non-temp
 *  ancestor, or made parentless under its root. Steps are ordered by `position` (stable): the server derives a node's position from
 *  its index, so this keeps the trunk (position 0) ahead of its lanes. */
export function buildAnalyzeProposalRequest(
  pipelineName: string,
  roots: readonly PipelineRoot[],
  draftSteps: readonly Step[],
): AnalyzeProposalRequest {
  const byId = new Map(draftSteps.map((s) => [s.id, s]));
  const real = draftSteps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !isTempStepId(s.id))
    .sort((a, b) => (a.s.position ?? 0) - (b.s.position ?? 0) || a.i - b.i)
    .map(({ s }) => s);
  return {
    pipelineName,
    roots: roots.map((r) => ({ sourceId: r.dataSourceId, clientId: r.id })),
    steps: real.map((s) => {
      const parent = realParentOf(s, byId);
      const step: AnalyzeProposalStep = {
        clientId: s.id,
        type: s.opType.id,
        config: s.config as unknown as Record<string, unknown>,
        enabled: s.enabled === true,
      };
      if (parent !== undefined) step.parentStepId = parent;
      else {
        const root = rootOf(s, byId);
        if (root !== undefined) step.rootClientId = root;
      }
      return step;
    }),
    outputs: [],
  };
}

/** The schema of `nodeStepId` in the response. A node the draft disabled is transparent (the response omits it): its schema is its
 *  nearest ENABLED ancestor's, or, with none, its root's source schema. `null` when the node has no derivable schema. */
export function schemaAtNode(
  response: AnalyzeProposalResponse,
  draftSteps: readonly Step[],
  nodeStepId: string,
): OutputSchemaField[] | null {
  const bySteps = new Map(response.steps.map((s) => [s.id, s.outputSchema]));
  const byId = new Map(draftSteps.map((s) => [s.id, s]));
  let cur: Step | undefined = byId.get(nodeStepId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const own = bySteps.get(cur.id);
    if (own !== undefined) return own;
    if (cur.parentStepId == null) {
      const rootId = cur.rootId;
      const src = response.sourceSchemas.find((s) => s.rootId === rootId);
      return src ? src.sourceSchema : null;
    }
    cur = byId.get(cur.parentStepId);
  }
  return null;
}
