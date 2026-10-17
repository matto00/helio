import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchSourceSample } from "../state/sourceSamplesSlice";

/**
 * HEL-1628: captures the sample of each given source once, when the pipeline page opens with nothing cached for
 * it (owner ruling C). Called from the pipeline page, never from a step editor, so edits cannot trigger it; the
 * thunk's `condition` makes a remount, a StrictMode double effect and a second consumer no-ops while an entry
 * exists, so a page visit costs one request per uncached source and later refreshes go through the label's button.
 *
 * Waits for the caller's own sources list, and only requests ids that appear in it: the endpoint is owner-only,
 * so a root whose source the caller cannot see (a shared pipeline's source) would certainly 404 and would spend
 * source-fetch budget for nothing. Its label reads "Sample unavailable".
 */
export function useSourceSamples(sourceIds: readonly string[]): void {
  const dispatch = useAppDispatch();
  const sourcesStatus = useAppSelector((state) => state.sources.status);
  const ownedIds = useAppSelector((state) => state.sources.items);
  const key = sourceIds.join(",");

  useEffect(() => {
    if (sourcesStatus !== "succeeded") return;
    const owned = new Set(ownedIds.map((s) => s.id));
    for (const id of key === "" ? [] : key.split(",")) {
      if (owned.has(id)) void dispatch(fetchSourceSample({ sourceId: id }));
    }
  }, [dispatch, key, sourcesStatus, ownedIds]);
}
