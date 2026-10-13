import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { Output } from "../types/output";
import type { Step } from "../types/step";
import type { PendingDraftMeta } from "./usePipelineStepCreation";

/**
 * The editor's local state and ref cluster extracted from `usePipelineDetailPage` (HEL-1501): the
 * `steps` list + its ref, the pending/in-flight draft bookkeeping, the steps-fetch phase, the
 * seed token, the SSE-active flag + ref and the analyze-guard refs. Moved verbatim, in order,
 * so the host's hook sequence is unchanged.
 */
export function usePipelineEditorState() {
  const [steps, setSteps] = useState<Step[]>([]);
  // F-146 — lets the step-mutation callbacks below read the current `steps`
  // without closing over it directly, so their `useCallback` identity stays
  // stable across the edits that change `steps` most often (every keystroke
  // in one step's config). A `useCallback([..., steps])` dependency would
  // defeat the point: it would get a new identity on exactly the renders
  // this is meant to guard against, which — since these callbacks are
  // `StepCard` props — would keep every *other*, unrelated `StepCard`
  // re-rendering via `React.memo`'s prop comparison (see `StepCard.tsx`).
  const stepsRef = useRef(steps);
  useLayoutEffect(() => {
    stepsRef.current = steps;
  });
  // HEL-1109 (design.md D3) — metadata for a step whose create was deferred
  // (an AI kind whose seed config the backend would reject): keyed by the
  // temp id, holds whatever `handleInsertStep`/`handleAddLaneStep` would
  // otherwise have passed straight to `createPipelineStep` at add-time.
  // Consumed once, by `handleStepConfigChange`, the moment the draft's local
  // config first satisfies `isCompleteAiStepConfig`.
  const pendingDraftMetaRef = useRef(new Map<string, PendingDraftMeta>());
  // HEL-1478 -- the key set of `pendingDraftMetaRef`, mirrored into state so `stepsFingerprint` can
  // exclude pending drafts without reading the ref during render. `usePipelineStepCreation` updates
  // it at every mutation site of the ref, in the same synchronous batch as a re-render-causing
  // setState, so a render always sees the ref and this set in step.
  const [pendingDraftIds, setPendingDraftIds] = useState<ReadonlySet<string>>(() => new Set());
  // HEL-1340 — the anchor meta of a draft whose create has been SENT. `pendingDraftMetaRef` is
  // emptied at send (the create-exactly-once guard and `stepsFingerprint` depend on that), which
  // left the in-flight draft with neither an analyze entry nor meta, so its field picker lost its
  // schema. Keyed by the temp id while in flight, re-keyed to the persisted id on the swap, and
  // dropped once the step has its own analyze entry (or is gone) or the create fails. Consulted
  // by the schema fallback only, never by the guard or the fingerprint.
  const draftFallbackMetaRef = useRef(new Map<string, PendingDraftMeta>());
  // HEL-908 Cycle 13 -- read inside the SSE `onTerminal` closure (defined in
  // `usePipelineRunStream.ts`, which runs before `allOutputs` itself is
  // computed) so a completed run can re-fetch every visible Output's
  // preview without a stale closure over an empty initial `allOutputs`.
  // Updated on every commit (layout effect), mirroring `stepsRef` above.
  const allOutputsRef = useRef<Output[]>([]);
  const [stepsInitialized, setStepsInitialized] = useState(false);
  // HEL-1483 (design D2a) -- true once the steps fetch THIS mount issued has fulfilled. The editor
  // seeds `steps` only then, never from a `reduxSteps[id]` entry that pre-dates the mount (a revisit
  // would otherwise seed the cached, pre-edit steps and `stepsInitialized` would block the reseed).
  // "pending" until it settles; "failed" shows the steps error with Retry (HEL-1501), never the empty editor.
  const [stepsFetch, setStepsFetch] = useState<"pending" | "fulfilled" | "failed">("pending");
  const stepsFetchedThisMount = stepsFetch === "fulfilled";
  const stepsLoading = stepsFetch === "pending";
  // HEL-1501: the steps fetch failed -- the Steps tab shows an error with Retry (never the empty
  // editor, which would claim the pipeline has no steps), and Retry flips the phase back to pending.
  const stepsFailed = stepsFetch === "failed";
  const onStepsRetry = useCallback(() => setStepsFetch("pending"), []);
  // F-105 — bumped (in the derived-state block below, batched into the same re-render as
  // `stepsInitialized`) the one time `steps` is seeded from `persistedSteps`. The debounced
  // re-analyze effect compares it with `consumedSeedTokenRef` (written only in that effect) so the
  // seeding doesn't count as a "genuine edit" and duplicate the mount effect's own immediate
  // `analyzePipeline`. HEL-1478: state + an effect-written ref instead of a ref written in render.
  const [seedToken, setSeedToken] = useState(0);
  const consumedSeedTokenRef = useRef(0);
  const [dropdownOpenAt, setDropdownOpenAt] = useState<"bottom" | null>(null);
  const [sseActive, setSseActive] = useState(false);
  // HEL-972 — read inside the debounced re-analyze effect's `setTimeout`
  // callback (a stale closure otherwise), which fires up to 300ms after the
  // render that scheduled it: mirrors `stepsRef`'s pattern above so the
  // callback sees the CURRENT sseActive value, not the one captured when the
  // effect last ran.
  const sseActiveRef = useRef(sseActive);
  useLayoutEffect(() => {
    sseActiveRef.current = sseActive;
  });
  // HEL-972 CR2 — `pendingAnalyzeRef` is set when the debounced re-analyze
  // effect's `setTimeout` callback finds the guard active and defers instead
  // of dispatching. `lastAnalyzedFingerprintRef` guards against the OTHER
  // failure mode adding `sseActive`/`analyzeStatus` to the effect's deps
  // creates on its own: since dispatching sets `analyzeStatus` to "loading"
  // and its own resolution sets it back, `analyzeStatus` changing is BOTH
  // the effect's own dependency AND a side effect of the dispatch it
  // performs — without this ref, every dispatch's own settle re-triggers the
  // effect and (guard now clear) dispatches again, forever. Dispatch only
  // when the guard is clear AND (the fingerprint changed since the last
  // dispatch OR a dispatch was genuinely deferred) breaks that loop.
  const pendingAnalyzeRef = useRef(false);
  const lastAnalyzedFingerprintRef = useRef<string | null>(null);
  // HEL-972 final-gate CR1 — `sseActive` is only ever cleared by the SSE
  // `onTerminal` handler or a submit-failure catch. `usePipelineRunEvents`
  // reports a failed/dropped connection via `connectionError` instead of a
  // terminal event, which has NO consumer that clears `sseActive` (confirmed:
  // `connectionError` has no non-test reader anywhere in `frontend/src`), and
  // `PipelineRunStreamRoutes`'s live (non-replaying) subscribe can miss a
  // terminal event outright if it fires before the browser's subscription
  // lands. Either failure mode leaves `sseActive` (and so this guard) stuck
  // true for the rest of the page's lifetime, silently dropping every future
  // edit's analyze forever -- the exact permanent-staleness outcome
  // deferral (vs. the cycle-1 drop) exists to prevent. Rather than plumbing
  // `connectionError` through this hook's several run-lifecycle call sites
  // (a wider, riskier change touching the SSE/run-submit surface this ticket
  // doesn't otherwise touch), bound the deferral in TIME: no single stuck
  // flag can suppress re-analyze for longer than `MAX_ANALYZE_DEFER_MS`,
  // regardless of why the guard never cleared.
  const pendingSinceRef = useRef<number | null>(null);
  const deferWatchdogHandleRef = useRef<number | null>(null);
  // Mirrors `stepsRef`'s pattern: read inside the watchdog's `setTimeout`
  // callback, which can fire long after the render that scheduled it.
  const stepsFingerprintRef = useRef("");

  return {
    steps,
    setSteps,
    stepsRef,
    pendingDraftMetaRef,
    pendingDraftIds,
    setPendingDraftIds,
    draftFallbackMetaRef,
    allOutputsRef,
    stepsInitialized,
    setStepsInitialized,
    setStepsFetch,
    stepsFetchedThisMount,
    stepsLoading,
    stepsFailed,
    onStepsRetry,
    seedToken,
    setSeedToken,
    consumedSeedTokenRef,
    dropdownOpenAt,
    setDropdownOpenAt,
    sseActive,
    setSseActive,
    sseActiveRef,
    pendingAnalyzeRef,
    lastAnalyzedFingerprintRef,
    pendingSinceRef,
    deferWatchdogHandleRef,
    stepsFingerprintRef,
  };
}
