import { isAxiosError } from "axios";
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import { updatePipelineStep } from "../services/pipelineService";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { isTempStepId, isUnsupportedOpType } from "../state/stepNarrowing";
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
};

export function useStepCardPersist({
  step,
  onConfigChange,
  setSaveError,
  setSaveErrorIsValidation,
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

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
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
    debounceRef.current = setTimeout(() => {
      const token = ++requestTokenRef.current;
      // Cleared at the start of THIS attempt (success or failure) so a stale error from a
      // previous rejected PATCH never lingers past a subsequent try.
      if (captureErrors) {
        setSaveError(null);
        setSaveErrorIsValidation(false);
      }
      void updatePipelineStep(step.id, newConfig)
        .then(() => {
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
