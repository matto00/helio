// HEL-1744 D2 -- what the Output editor sheet derives for the insight settings card, split out of the sheet.

import { useMemo } from "react";

import { useAppSelector } from "../../../../hooks/reduxHooks";
import { isDraftOutput } from "../../state/draftOutputs";
import { selectOutputsForPipeline } from "../../state/outputsSlice";
import type { Output } from "../../types/output";
import { defaultInsightReads, soleRootId, type InsightNodeRef } from "./insightNode";
import type { OutputSheetDraft } from "./outputSheetDraft";

interface Args {
  pipelineId: string;
  output: Output | null;
  nodeStepId: string | undefined;
  isCreate: boolean;
  draft?: OutputSheetDraft;
}

/** The saved, non-insight Outputs of the pipeline an insight may read, the insight's node, the same-node default checklist and
 *  the signed-in user's tier (for the upsell). */
export function useInsightEditorState({ pipelineId, output, nodeStepId, isCreate, draft }: Args) {
  const pipelineOutputs = useAppSelector((state) => selectOutputsForPipeline(state, pipelineId));
  const tier = useAppSelector((state) => state.auth?.currentUser?.tier);
  const insightCandidates = useMemo(
    () =>
      pipelineOutputs.filter(
        (o) => o.kind !== "insight" && !isDraftOutput(o) && o.id !== output?.id,
      ),
    [pipelineOutputs, output?.id],
  );
  const insightNode = useMemo<InsightNodeRef>(
    () => ({
      nodeStepId,
      rootId:
        nodeStepId !== undefined
          ? undefined
          : isCreate
            ? draft && draft.roots.length === 1
              ? draft.roots[0].id
              : soleRootId(pipelineOutputs)
            : output?.rootId,
    }),
    [nodeStepId, isCreate, draft, pipelineOutputs, output?.rootId],
  );
  const insightDefaultReads = useMemo(
    () => defaultInsightReads(insightNode, insightCandidates),
    [insightNode, insightCandidates],
  );
  return { insightCandidates, insightNode, insightDefaultReads, tier };
}
