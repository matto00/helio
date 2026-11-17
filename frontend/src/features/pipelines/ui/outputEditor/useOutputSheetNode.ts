// The Output editor sheet's node data: its capabilities (columns, per-kind bindings) and the rows its preview draws. With no draft they
// are the saved server reads; with a draft (HEL-1733 D5) the root node keeps the saved capabilities, a step node uses the server's
// projection of the draft, and the preview is the draft rows of the node, never a server preview request.

import { useEffect, useMemo } from "react";

import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { useDraftNodeCapabilities } from "../../hooks/useDraftNodeCapabilities";
import { useOutputPreview, useUnsavedStepPreview } from "../../hooks/usePipelinePreviewCache";
import { frameColumns } from "../../state/liveOutput/frameRecords";
import { fetchNodeCapabilities, selectNodeCapabilities } from "../../state/outputsSlice";
import type { Output } from "../../types/output";
import type { Step } from "../../types/step";
import { draftNodeFrame, runResultFromFrame, type OutputSheetDraft } from "./outputSheetDraft";

export function useOutputSheetNode({
  open,
  pipelineId,
  output,
  nodeStepId,
  steps,
  draft,
}: {
  open: boolean;
  pipelineId: string;
  output: Output | null;
  nodeStepId: string | undefined;
  steps: Step[];
  draft: OutputSheetDraft | undefined;
}) {
  const dispatch = useAppDispatch();
  const inDraft = draft !== undefined;
  const isCreate = output === null;
  const savedCapabilities = useAppSelector((state) =>
    selectNodeCapabilities(state, pipelineId, nodeStepId),
  );
  // In a draft only the ROOT node reads the saved capabilities (a root is never changed by a draft); a step node never asks the
  // server for a stored step by a possibly draft-only id.
  useEffect(() => {
    if (!open || (inDraft && nodeStepId !== undefined)) return;
    void dispatch(fetchNodeCapabilities({ pipelineId, stepId: nodeStepId }));
  }, [open, dispatch, pipelineId, nodeStepId, inDraft]);
  const draftFrame = draftNodeFrame(draft?.frames ?? null, nodeStepId, draft?.roots[0]?.id);
  const frameColumnNames = useMemo(
    () => (draftFrame === null ? [] : frameColumns(draftFrame, [])),
    [draftFrame],
  );
  const { capabilities, typing } = useDraftNodeCapabilities({
    active: open && inDraft,
    nodeStepId,
    pipelineName: draft?.pipelineName ?? "",
    roots: draft?.roots ?? [],
    draftSteps: steps,
    savedCapabilities,
    frameColumnNames,
  });

  // task 5.5 -- live preview, saved vs. unsaved arm (design.md decision 6a).
  const savedPreview = useOutputPreview(pipelineId, output?.id ?? "");
  const unsavedPreview = useUnsavedStepPreview(pipelineId, nodeStepId ?? "__root__");
  const serverPreview = isCreate ? unsavedPreview : savedPreview;
  const draftPreview = useMemo(
    () => (draftFrame === null ? undefined : runResultFromFrame(draftFrame)),
    [draftFrame],
  );
  const refresh = serverPreview.refresh;
  useEffect(() => {
    if (!open || inDraft) return;
    const handle = setTimeout(() => {
      void refresh();
    }, 400);
    return () => clearTimeout(handle);
    // Debounced re-fetch on open + whenever the target node changes. The preview endpoints don't apply in-progress config server-side
    // (decision 6a) so field/kind edits re-render client-side against the same rows without re-fetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isCreate, output?.id, nodeStepId, inDraft]);

  return { capabilities, typing, previewRows: inDraft ? draftPreview : serverPreview.result };
}
