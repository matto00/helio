import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { createPipelineStep, updatePipelineStep } from "../services/pipelineService";
import type { CreatedPipelineStep } from "../services/pipelineService";
import { insertWireArgs } from "../state/insertAnchor";
import { isCompleteAiStepConfig, requiresCompleteConfigForCreate } from "../state/stepNarrowing";
import type { PipelineStepConfig, PipelineStepKind } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { PendingDraftMeta } from "./usePipelineStepCreation";

type UsePipelineDraftCreateArgs = {
  id: string | undefined;
  stepsRef: MutableRefObject<Step[]>;
  applyCreated: (tempId: string, created: CreatedPipelineStep, renderKey?: string) => void;
  pendingDraftMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
  draftFallbackMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
  syncPendingDraftIds: () => void;
  creatingDraftIdsRef: MutableRefObject<Set<string>>;
  setDraftCreateErrors: Dispatch<SetStateAction<Record<string, string>>>;
};

/** The deferred draft create (`createDraftIfComplete`), extracted from `usePipelineStepCreation` (HEL-1481). */
export function usePipelineDraftCreate({
  id,
  stepsRef,
  applyCreated,
  pendingDraftMetaRef,
  draftFallbackMetaRef,
  syncPendingDraftIds,
  creatingDraftIdsRef,
  setDraftCreateErrors,
}: UsePipelineDraftCreateArgs) {
  // HEL-1109 (design.md D3) — a draft AI step (still carrying its makeStep-minted temp id) whose
  // LOCAL config has just become complete is created exactly once, here, rather than at add-time.
  const createDraftIfComplete = useCallback(
    (stepId: string, config: PipelineStepConfig) => {
      const meta = pendingDraftMetaRef.current.get(stepId);
      if (!meta) return;
      const step = stepsRef.current.find((s) => s.id === stepId);
      if (!step || !requiresCompleteConfigForCreate(step.opType.id)) return;
      if (!isCompleteAiStepConfig(step.opType.id, config)) return;
      if (creatingDraftIdsRef.current.has(stepId)) return;
      if (!id) return;
      creatingDraftIdsRef.current.add(stepId);
      pendingDraftMetaRef.current.delete(stepId);
      syncPendingDraftIds();
      draftFallbackMetaRef.current.set(stepId, meta);
      // A lane draft (`meta.parentStepId`) sends its own anchor; a trunk draft builds the wire
      // call from its click-time anchor NOW (and on every retry), so a trunk that changed in
      // between never turns a stale index into a permanent 422 (HEL-1345 D11).
      const wire =
        meta.parentStepId !== undefined
          ? { parentStepId: meta.parentStepId, rootId: meta.rootId }
          : insertWireArgs(
              meta.anchor,
              (stepId) => stepsRef.current.some((s) => s.id === stepId),
              meta.rootId,
            );
      void createPipelineStep(
        id,
        step.opType.id as PipelineStepKind,
        config,
        wire.position,
        wire.parentStepId,
        meta.attachAsTail,
        wire.rootId,
      )
        .then((persisted) => {
          // HEL-1321 D3 — `stepsRef` still holds the PRE-swap list here, so look the draft up by
          // its temp id. Every edit replaces `config` with a new object, so reference
          // inequality with the POSTed config means the user edited while the create was in
          // flight; that edit was never sent (the create carried the older config, and a
          // temp-id PATCH is skipped), so flush it to the persisted id once.
          // HEL-1340 — keep the schema fallback alive across the id swap.
          draftFallbackMetaRef.current.delete(stepId);
          draftFallbackMetaRef.current.set(persisted.id, meta);
          const latest = stepsRef.current.find((s) => s.id === stepId);
          const editedInFlight = latest !== undefined && latest.config !== config;
          // HEL-1321 D2 — the temp id becomes the stable render key (set once), so the open
          // card and its lane are not remounted by the id swap. HEL-1345 D5 — the same swap also
          // applies the response's reparented ids.
          applyCreated(stepId, persisted, stepId);
          if (editedInFlight) {
            updatePipelineStep(persisted.id, latest.config).catch((err: unknown) => {
              const message = extractErrorMessage(
                err,
                "Failed to save your latest edit — try editing again.",
              );
              setDraftCreateErrors((prev) => ({ ...prev, [persisted.id]: message }));
            });
          }
        })
        .catch((err: unknown) => {
          const message = extractErrorMessage(err, "Failed to save this step — try again.");
          setDraftCreateErrors((prev) => ({ ...prev, [stepId]: message }));
          draftFallbackMetaRef.current.delete(stepId);
          // Restore the pending meta so a subsequent completing edit retries the create.
          pendingDraftMetaRef.current.set(stepId, meta);
          syncPendingDraftIds();
        })
        .finally(() => {
          creatingDraftIdsRef.current.delete(stepId);
        });
    },
    [
      id,
      stepsRef,
      applyCreated,
      pendingDraftMetaRef,
      draftFallbackMetaRef,
      syncPendingDraftIds,
      creatingDraftIdsRef,
      setDraftCreateErrors,
    ],
  );

  return createDraftIfComplete;
}
