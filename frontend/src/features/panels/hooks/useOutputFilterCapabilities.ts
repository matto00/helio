import { useEffect, useSyncExternalStore } from "react";

import {
  ensureCapabilitiesLoaded,
  getCapabilitiesEntry,
  subscribeCapabilities,
  type CapabilityColumns,
} from "../state/filterCapabilitiesStore";

export interface OutputFilterCapabilities {
  /** `loading` also covers "not requested yet" (`enabled` false); `unavailable` is a failed
   *  load or an invalidation after a server `eq` rejection (design.md D3a). */
  status: "loading" | "ready" | "unavailable";
  columns: CapabilityColumns | null;
}

/** HEL-1191 design.md D3/D3a — the operators the Output's filter-capability contract currently
 *  allows per column, cached per Output (5-minute TTL) in `filterCapabilitiesStore`. LAZY: no
 *  request is made unless `enabled` (a cross-filter is active AND this panel is a candidate),
 *  because the backend contract build is O(columns x rows) per call. */
export function useOutputFilterCapabilities(
  outputId: string | null,
  enabled: boolean,
): OutputFilterCapabilities {
  const entry = useSyncExternalStore(
    subscribeCapabilities,
    () => (outputId ? getCapabilitiesEntry(outputId) : undefined),
    () => undefined,
  );

  useEffect(() => {
    if (enabled && outputId && entry === undefined) ensureCapabilitiesLoaded(outputId);
  }, [enabled, outputId, entry]);

  if (entry?.status === "ready") return { status: "ready", columns: entry.columns };
  if (entry?.status === "unavailable") return { status: "unavailable", columns: null };
  return { status: "loading", columns: null };
}
