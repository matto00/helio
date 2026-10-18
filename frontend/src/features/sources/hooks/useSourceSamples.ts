import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchSourceSample } from "../state/sourceSamplesSlice";

/** The pipeline page a sample is requested on. `canSampleShared` is true once analyze has answered with an
 *  `owner` or `editor` `callerRole` (HEL-1648): then sources the caller does not own are requested through the
 *  pipeline, which the server admits only if the caller holds that role and the pipeline uses the source. */
export interface SourceSampleScope {
  pipelineId: string;
  canSampleShared: boolean;
}

/**
 * HEL-1628: captures the sample of each given source once, when the pipeline page opens with nothing cached for
 * it (owner ruling C). Called from the pipeline page, never from a step editor, so edits cannot trigger it; the
 * thunk's `condition` makes a remount, a StrictMode double effect and a second consumer no-ops while an entry
 * exists, so a page visit costs one request per uncached source and later refreshes go through the label's button.
 *
 * Without `canSampleShared` it waits for the caller's own sources list and requests only ids that appear in it
 * (anything else would 404 and spend source-fetch budget for nothing). With it (HEL-1648) every id is requested,
 * with the page's `pipelineId`, as soon as analyze has answered -- the role wins over a pending or failed list.
 * A request never carries a pipeline id other than the current page's.
 */
export function useSourceSamples(sourceIds: readonly string[], scope?: SourceSampleScope): void {
  const dispatch = useAppDispatch();
  const sourcesStatus = useAppSelector((state) => state.sources.status);
  const ownedIds = useAppSelector((state) => state.sources.items);
  const key = sourceIds.join(",");
  const pipelineId = scope?.pipelineId;
  const shared = scope?.canSampleShared === true;

  useEffect(() => {
    const ids = key === "" ? [] : key.split(",");
    if (shared) {
      for (const id of ids) void dispatch(fetchSourceSample({ sourceId: id, pipelineId }));
      return;
    }
    if (sourcesStatus !== "succeeded") return;
    const owned = new Set(ownedIds.map((s) => s.id));
    for (const id of ids) {
      if (owned.has(id)) void dispatch(fetchSourceSample({ sourceId: id, pipelineId }));
    }
  }, [dispatch, key, sourcesStatus, ownedIds, pipelineId, shared]);
}
