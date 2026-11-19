import { useEffect, useSyncExternalStore } from "react";

import {
  ensureCapabilitiesLoaded,
  getCapabilitiesEntry,
  loadPanelCapabilities,
  panelCapabilitiesKey,
  subscribeCapabilities,
  type CapabilityColumns,
} from "../state/filterCapabilitiesStore";
import type { PanelReadScope } from "../state/panelReadScope";

export interface OutputFilterCapabilities {
  /** `loading` also covers "not requested yet" (`enabled` false); `unavailable` is a failed
   *  load or an invalidation after a server `eq` rejection (design.md D3a). */
  status: "loading" | "ready" | "unavailable";
  columns: CapabilityColumns | null;
}

/** HEL-1191 design.md D3/D3a — the operators the Output's filter-capability contract currently
 *  allows per column, cached (5-minute TTL) in `filterCapabilitiesStore`. LAZY: no request is made
 *  unless `enabled` (a cross-filter is active AND this panel is a candidate), because the backend
 *  contract build is O(columns x rows) per call.
 *
 *  HEL-1780 D5: in `panel` scope the capabilities come from the per-panel route (already narrowed to the panel's
 *  own control columns) and are keyed by `(dashboardId, panelId)`, never by Output. */
export function useOutputFilterCapabilities(
  outputId: string | null,
  enabled: boolean,
  scope: PanelReadScope = { kind: "output" },
): OutputFilterCapabilities {
  const key =
    scope.kind === "panel" ? panelCapabilitiesKey(scope.dashboardId, scope.panelId) : outputId;
  const entry = useSyncExternalStore(
    subscribeCapabilities,
    () => (key ? getCapabilitiesEntry(key) : undefined),
    () => undefined,
  );

  useEffect(() => {
    if (!enabled || !key || entry !== undefined) return;
    if (scope.kind === "panel") {
      ensureCapabilitiesLoaded(key, loadPanelCapabilities(scope.dashboardId, scope.panelId));
    } else ensureCapabilitiesLoaded(key);
  }, [enabled, key, entry, scope]);

  if (entry?.status === "ready") return { status: "ready", columns: entry.columns };
  if (entry?.status === "unavailable") return { status: "unavailable", columns: null };
  return { status: "loading", columns: null };
}
