import { useEffect } from "react";

import { release, retain } from "../state/outputFreshness";

/** HEL-1392 design.md D1 — marks `outputId` as on screen while the calling card is mounted, and for
 *  `REMOUNT_GRACE_MS` after it leaves, so a card remounting in the same commit (the desktop <-> phone
 *  swap) may reuse the Output's rows and metadata however long the user had been reading before it.
 *  StrictMode-safe: the dev cleanup/re-run pair nets to one retain. */
export function useOutputRetention(outputId: string | null): void {
  useEffect(() => {
    if (!outputId) return;
    retain(outputId);
    return () => release(outputId);
  }, [outputId]);
}
