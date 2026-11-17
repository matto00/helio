import { useEffect, useMemo, useState } from "react";

import { analyzeProposal } from "../services/analyzeProposalService";
import { buildAnalyzeProposalRequest, schemaAtNode } from "../state/draftNodeSchema";
import { buildNodeCapabilities } from "../state/nodeCapabilities";
import type { NodeCapabilities, OutputSchemaField } from "../types/output";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";

/** `ready`: the capabilities carry the server's typed schema. `checking`: the projection is in flight (Save waits). `unavailable`: the
 *  projection failed or the node has no derivable schema; only kinds with no type-restricted slot may be saved (design.md D5). */
export type DraftTyping = "ready" | "checking" | "unavailable";

export interface DraftNodeCapabilities {
  capabilities: NodeCapabilities | undefined;
  typing: DraftTyping;
}

type Settled = { key: string; schema: OutputSchemaField[] | null };

/**
 * HEL-1733 (design.md D5): the capabilities of the Output editor sheet's node while a draft exists. A root node keeps the SAVED
 * capabilities (a root is never changed by a draft); EVERY step node uses the server's projection of the DRAFT definition
 * (`POST /api/pipelines/analyze-proposal`, read-only, stores nothing and names no draft-only resource), turned into capabilities by
 * the client port of `buildNodeCapabilities`. The column types are never inferred from rows: while the projection is in flight or
 * unavailable the field pickers show the draft frame's column names with every type unknown, and `typing` says Save must wait.
 * Requested when the sheet opens on a step node, when its target changes and when the draft changes under it; the latest wins.
 */
export function useDraftNodeCapabilities({
  active,
  nodeStepId,
  pipelineName,
  roots,
  draftSteps,
  savedCapabilities,
  frameColumnNames,
}: {
  /** The sheet is open on a draft. */
  active: boolean;
  nodeStepId: string | undefined;
  pipelineName: string;
  roots: readonly PipelineRoot[];
  draftSteps: readonly Step[];
  /** The saved server capabilities (the root node's, or the no-draft path's). */
  savedCapabilities: NodeCapabilities | undefined;
  /** The draft frame's column names for the node (for the field pickers while the types are not known). */
  frameColumnNames: readonly string[];
}): DraftNodeCapabilities {
  const useProjection = active && nodeStepId !== undefined;
  const request = useMemo(
    () => (useProjection ? buildAnalyzeProposalRequest(pipelineName, roots, draftSteps) : null),
    [useProjection, pipelineName, roots, draftSteps],
  );
  const key = useMemo(
    () => (request === null ? null : `${nodeStepId}|${JSON.stringify(request)}`),
    [request, nodeStepId],
  );
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (request === null || key === null || nodeStepId === undefined) return;
    let cancelled = false;
    analyzeProposal(request).then(
      (response) => {
        if (!cancelled) setSettled({ key, schema: schemaAtNode(response, draftSteps, nodeStepId) });
      },
      () => {
        if (!cancelled) setSettled({ key, schema: null });
      },
    );
    return () => {
      cancelled = true;
    };
    // `draftSteps` is covered by `key` (the request is built from it); a new array identity with equal content must not re-request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    if (!useProjection) return { capabilities: savedCapabilities, typing: "ready" as const };
    const typing: DraftTyping =
      settled === null || settled.key !== key
        ? "checking"
        : settled.schema === null
          ? "unavailable"
          : "ready";
    if (typing === "ready" && settled?.schema)
      return { capabilities: buildNodeCapabilities(settled.schema, nodeStepId), typing };
    return {
      capabilities: buildNodeCapabilities(
        frameColumnNames.map((name) => ({ name, type: "string" })),
        nodeStepId,
      ),
      typing,
    };
  }, [useProjection, savedCapabilities, settled, key, nodeStepId, frameColumnNames]);
}
