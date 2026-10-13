import { useState } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";

/**
 * The sources + pipelines slice selectors and the page-id ownership derivation extracted from
 * `usePipelineDetailPage` (HEL-1501): the singleton `currentPipeline*` state exposed only for the
 * page's own id. Moved verbatim and called at the same position in the host's hook order.
 */
export function usePipelineOwnPipeline({ id }: { id: string | undefined }) {
  const { items: sources, status: sourcesStatus } = useAppSelector((state) => state.sources);
  const {
    runStatus,
    runError,
    runIsDry,
    runResult,
    runStepRowCounts,
    runSourceRowCount,
    runSourceTruncated,
    runTruncationNotice,
    currentPipeline: storedPipeline,
    currentPipelineStatus: storedPipelineStatus,
    currentPipelineError: storedPipelineError,
    currentPipelineErrorKind: storedPipelineErrorKind,
    currentPipelineRequestedId,
    updateStatus,
    updateError,
    steps: reduxSteps,
  } = useAppSelector((state) => state.pipelines);
  // HEL-1483 -- `currentPipeline` and its status/error are singletons in the slice, so right after an
  // in-app switch they still describe the PREVIOUS pipeline. Expose them only for the page's own id:
  // another id's pipeline reads as "not loaded" (loading skeleton, never A's name or header) and
  // another id's status/error as idle/none (so B's load is never skipped by A's failed latch, and
  // A's "couldn't load" never shows on B).
  // Once THIS mount has seen its own pipeline it keeps it (`ownPipeline`, only ever this mount's id)
  // while another id's late request holds the singleton, so a loaded editor is never swapped for the
  // page skeleton -- which would unmount its cards and drop a pending debounced edit -- during the
  // convergence refetch below.
  const singletonIsOwn = storedPipeline?.id === id;
  const [ownPipeline, setOwnPipeline] = useState<typeof storedPipeline>(() =>
    singletonIsOwn ? storedPipeline : null,
  );
  if (singletonIsOwn && storedPipeline !== ownPipeline) setOwnPipeline(storedPipeline);
  // (Not once this page's own request has failed: the error view must replace the kept editor.)
  const ownRequestFailed =
    (!currentPipelineRequestedId || currentPipelineRequestedId === id) &&
    storedPipelineStatus === "failed";
  const currentPipeline = singletonIsOwn ? storedPipeline : ownRequestFailed ? null : ownPipeline;
  // (`null` = nothing requested yet, so there is no other pipeline's status to disown.)
  const ownsPipelineStatus = !currentPipelineRequestedId || currentPipelineRequestedId === id;
  const currentPipelineStatus = ownsPipelineStatus ? storedPipelineStatus : "idle";
  const currentPipelineError = ownsPipelineStatus ? storedPipelineError : null;
  const currentPipelineErrorKind = ownsPipelineStatus ? storedPipelineErrorKind : null;

  return {
    sources,
    sourcesStatus,
    runStatus,
    runError,
    runIsDry,
    runResult,
    runStepRowCounts,
    runSourceRowCount,
    runSourceTruncated,
    runTruncationNotice,
    updateStatus,
    updateError,
    reduxSteps,
    singletonIsOwn,
    currentPipeline,
    currentPipelineStatus,
    currentPipelineError,
    currentPipelineErrorKind,
  };
}
