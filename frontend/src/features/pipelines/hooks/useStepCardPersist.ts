import { isAxiosError } from "axios";
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { Dispatch, SetStateAction } from "react";

import { updatePipelineStep } from "../services/pipelineService";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { isTempStepId, isUnsupportedOpType } from "../state/stepNarrowing";
import { useStepSaveContext } from "../state/stepSaveContext";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

/** Debounce window (ms) between the last config-editor edit and the
 *  persisted PATCH — matches the hand-rolled ref+setTimeout debounce idiom
 *  used by `ComputedFieldForm.tsx` / `TableRenderer.tsx`'s column-resize
 *  persistence (`RESIZE_PERSIST_DEBOUNCE_MS`). Every step-config editor
 *  (filter values, compute expressions, renames, casts, …) previously
 *  PATCHed the backend on every keystroke; debouncing collapses a burst of
 *  edits into one request. */
const STEP_CONFIG_PERSIST_DEBOUNCE_MS = 400;

type UseStepCardPersistArgs = {
  step: Step;
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  setSaveError: Dispatch<SetStateAction<string | null>>;
  setSaveErrorIsValidation: Dispatch<SetStateAction<boolean>>;
  /** HEL-1579 (design.md D7): opt-in, set only by the desktop focused editor. When true a pending
   *  debounced persist is SENT on unmount (selecting another step must not lose the edit) instead
   *  of cleared; the phone card keeps today's clear-on-unmount. */
  flushOnUnmount?: boolean;
  /** HEL-1579: receives a function that drops the pending persist without sending it, so the
   *  focused editor's Remove cancels the edit before the step is deleted (no PATCH to a vanished row). */
  cancelPendingRef?: MutableRefObject<(() => void) | null>;
};

export function useStepCardPersist({
  step,
  onConfigChange,
  setSaveError,
  setSaveErrorIsValidation,
  flushOnUnmount = false,
  cancelPendingRef,
}: UseStepCardPersistArgs) {
  // Debounce ref for the persist path below, plus a monotonically
  // increasing request token: `persist` may be called many times in a row
  // (one keystroke = one call, across any of the 26 change handlers) but
  // must only PATCH once the caller stops calling for
  // STEP_CONFIG_PERSIST_DEBOUNCE_MS. The token additionally guards against
  // an *out-of-order response* — e.g. the network reorders two PATCHes so an
  // older request's response arrives after a newer one's — by only applying
  // a response to `onConfigChange` when it's still the most recently
  // *dispatched* request for this step.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestTokenRef = useRef(0);

  // HEL-1579: the debounced edit not yet sent, and the page-level save seam (null on the phone).
  const pendingRef = useRef<{ config: PipelineStepConfig; captureErrors: boolean } | null>(null);
  const saveContext = useStepSaveContext();
  const latest = useRef({ stepId: step.id, saveContext, flushOnUnmount, onConfigChange });
  useEffect(() => {
    latest.current = { stepId: step.id, saveContext, flushOnUnmount, onConfigChange };
  });

  useEffect(() => {
    if (cancelPendingRef) {
      cancelPendingRef.current = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        pendingRef.current = null;
      };
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const pending = pendingRef.current;
      pendingRef.current = null;
      const {
        stepId,
        saveContext: ctx,
        flushOnUnmount: flush,
        onConfigChange: notify,
      } = latest.current;
      // HEL-1579 (design.md D7): flush instead of dropping, but only for a step that still exists.
      // The PATCH is dispatched and registered with the tracker SYNCHRONOUSLY here, inside the
      // cleanup, so the preview table's fetch effect for the newly selected step (which React runs
      // after this cleanup in the same commit) already sees it pending.
      if (flush && pending && ctx && ctx.isStepPresent(stepId)) {
        const promise = updatePipelineStep(stepId, pending.config)
          .then(() => {
            // The editor is gone but the page still holds the pre-edit config: bring it in line (the normal path
            // does the same after its PATCH), so a re-selected editor, the spine summary and the analyze
            // fingerprint show the saved value and the next edit does not revert it.
            notify(stepId, pending.config);
            ctx.reportSaveError(stepId, null);
          })
          .catch((err: unknown) => {
            ctx.reportSaveError(
              stepId,
              extractErrorMessage(
                err,
                "Failed to save this step's configuration — the server didn't say why.",
              ),
            );
          });
        ctx.tracker.register(promise);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only; reads refs
  }, []);

  /** Shared persistence path — debounces, then PATCHes the typed config and
   *  notifies the parent. Local editor state is updated by the caller (so
   *  the UI stays responsive regardless of debounce/network latency).
   *
   *  `captureErrors` (design.md Decision 6; passed `true` by `onUpsertSourceChange` and, since
   *  HEL-1416, by the fillnull/window/pivot change handlers whose write-time enum validation can
   *  422) opts a call site INTO surfacing a rejected
   *  PATCH's backend message via `saveError` — every other op kind keeps
   *  the pre-existing silent-swallow behavior (out of scope to change here)
   *  by omitting it. */
  function persist(newConfig: PipelineStepConfig, captureErrors = false): void {
    // HEL-1100 (design.md Decision 9): an unsupported step kind has no config editor that could
    // have produced this call in the first place, but the pending-`onChange` type shape allows
    // it to be invoked with a stale/default value regardless -- skip the PATCH entirely rather
    // than persisting a config no editor here actually computed.
    if (isUnsupportedOpType(step.opType)) return;
    // HEL-1109 (design.md D3) — a step still carrying its `makeStep`-minted
    // temp id (exactly `step-<counter>`, e.g. "step-1") has no server-side
    // row yet: PATCHing it would 404 (swallowed for every kind except
    // `upsertsource`, which is the only call site that captures errors
    // today). This was a latent defect before this ticket (the removed
    // `handleInsertStep:685` comment claiming otherwise was itself wrong,
    // design.md D3) -- fixed here, for every op, rather than wiring each
    // draft card to withhold `persist` individually. Uses the single
    // `isTempStepId` source of truth (evaluation-1.md CR3) -- a semantic
    // test-fixture id like "step-rename-1" is NOT a temp id and must still
    // PATCH normally.
    if (isTempStepId(step.id)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingRef.current = { config: newConfig, captureErrors };
    debounceRef.current = setTimeout(() => {
      pendingRef.current = null;
      const token = ++requestTokenRef.current;
      // Cleared at the start of THIS attempt (success or failure) so a stale error from a
      // previous rejected PATCH never lingers past a subsequent try.
      if (captureErrors) {
        setSaveError(null);
        setSaveErrorIsValidation(false);
      }
      const sent = updatePipelineStep(step.id, newConfig);
      // HEL-1579 (design.md D8): the desktop page waits on every in-flight step save before it
      // fetches a preview; a no-op without the page-level seam (the phone).
      saveContext?.tracker.register(sent);
      void sent
        .then(() => {
          saveContext?.reportSaveError(step.id, null);
          // Drop a stale response: a newer edit may have already dispatched
          // (and possibly already resolved) its own PATCH while this one
          // was in flight.
          if (requestTokenRef.current === token) {
            onConfigChange(step.id, newConfig);
          }
        })
        .catch((err: unknown) => {
          // The same `requestTokenRef` staleness guard as the success path above: an
          // out-of-order/superseded rejection must never clobber a newer, still-in-flight or
          // already-succeeded request's result.
          if (captureErrors && requestTokenRef.current === token) {
            setSaveErrorIsValidation(isAxiosError(err) && err.response?.status === 422);
            setSaveError(
              extractErrorMessage(
                err,
                "Failed to save this step's configuration — the server didn't say why.",
              ),
            );
          }
          // Every other op kind: no-op, local state always reflects user intent even if the
          // PATCH fails (pre-existing behavior, unchanged by this ticket — design.md Decision 6).
        });
    }, STEP_CONFIG_PERSIST_DEBOUNCE_MS);
  }

  /** HEL-1109 (design.md D3) — a not-yet-created draft (temp id) has no PATCH
   *  path at all (`persist`'s own guard above), but the parent still needs to
   *  see every edit immediately: `usePipelineDetailPage.handleStepConfigChange`
   *  is what notices a draft's config just became complete and fires its
   *  (exactly-once) create request. A real, persisted step keeps the normal
   *  debounced PATCH path unchanged. */
  function emitOrPersist(newConfig: PipelineStepConfig) {
    if (isTempStepId(step.id)) {
      onConfigChange(step.id, newConfig);
      return;
    }
    persist(newConfig);
  }

  return { persist, emitOrPersist };
}
