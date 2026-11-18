import { useEffect, useState } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { getPipelineById } from "../../pipelines/services/pipelineService";

/** HEL-1744 D7 -- whether the signed-in user owns the insight's PIPELINE (never the Output's creator: an editor can create
 *  an Output, and renders are charged to the pipeline owner). Reads `Pipeline.ownerId` from the pipelines slice when it is
 *  loaded, else one cached `GET /api/pipelines/:id` per pipeline id. A 403/404/error (a dashboard-only viewer cannot read
 *  the pipeline) resolves to `false`; a public viewer passes `null` and never makes a request. `enabled: false` (the answer cannot change
 *  what is shown) skips the request too. Returns `undefined` while an enabled lookup is still pending. */
const ownerByPipeline = new Map<string, Promise<string | null>>();

export function resetPipelineOwnership(): void {
  ownerByPipeline.clear();
}

function pipelineOwner(pipelineId: string): Promise<string | null> {
  let pending = ownerByPipeline.get(pipelineId);
  if (!pending) {
    pending = getPipelineById(pipelineId).then(
      (p) => p.ownerId ?? null,
      () => null,
    );
    ownerByPipeline.set(pipelineId, pending);
  }
  return pending;
}

export function usePipelineOwnership(
  pipelineId: string | null,
  enabled = true,
): boolean | undefined {
  const userId = useAppSelector((state) => state.auth?.currentUser?.id ?? null);
  const knownOwner = useAppSelector((state) => {
    if (pipelineId === null) return undefined;
    const slice = state.pipelines;
    if (slice?.currentPipeline?.id === pipelineId) return slice.currentPipeline.ownerId ?? null;
    return slice?.items?.find((p) => p.id === pipelineId)?.ownerId;
  });
  const [fetched, setFetched] = useState<{ pipelineId: string; ownerId: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled || pipelineId === null || knownOwner !== undefined) return;
    let cancelled = false;
    void pipelineOwner(pipelineId).then((ownerId) => {
      if (!cancelled) setFetched({ pipelineId, ownerId });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, pipelineId, knownOwner]);

  if (pipelineId === null || userId === null) return false;
  if (knownOwner === undefined && fetched?.pipelineId !== pipelineId) {
    // Not looked up yet: `undefined` while a lookup is due (so a caller can hold its state), else not the owner.
    return enabled ? undefined : false;
  }
  const ownerId = knownOwner !== undefined ? knownOwner : (fetched?.ownerId ?? null);
  return ownerId !== null && ownerId === userId;
}
