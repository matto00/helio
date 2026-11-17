import { useMemo } from "react";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { createOutput, deleteOutput, previewOutput, updateOutput } from "../state/outputsSlice";
import type { Output } from "../types/output";

/** What the Output editor sheet asks the page to do. With a draft open each is recorded as a draft entry; otherwise it is written
 *  at once (`useOutputImmediateActions`). Every function rejects with the server's message (a string) or an `Error`. */
export interface OutputActions {
  create: (payload: {
    nodeStepId?: string;
    kind: string;
    name: string;
    config: Record<string, unknown>;
  }) => void | Promise<void>;
  update: (
    output: Output,
    payload: { name: string; config?: Record<string, unknown> },
  ) => void | Promise<void>;
  remove: (output: Output) => void | Promise<void>;
}

/**
 * The immediate (no draft open) Output writes, moved verbatim out of `OutputEditorSheet` (HEL-1733 D3): the same thunks, and the
 * same post-create `previewOutput`. `usePipelineDraftRouting` decides between these and a draft entry.
 */
export function useOutputImmediateActions(pipelineId: string): OutputActions {
  const dispatch = useAppDispatch();
  return useMemo(
    () => ({
      create: async (payload) => {
        const created = await dispatch(createOutput({ pipelineId, payload })).unwrap();
        // HEL-908 Cycle 13 -- the preview fetched while creating is cached under the unsaved `step:<stepId>` key, not the new
        // Output's real id; without this the rail chip of a freshly created Output shows no preview until its sheet is reopened.
        void dispatch(previewOutput({ pipelineId, outputId: created.id }));
      },
      update: async (output, payload) => {
        await dispatch(updateOutput({ outputId: output.id, payload })).unwrap();
      },
      remove: async (output) => {
        await dispatch(deleteOutput({ outputId: output.id, pipelineId })).unwrap();
      },
    }),
    [dispatch, pipelineId],
  );
}
