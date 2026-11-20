// HEL-1191 design.md D3/D3a — a tiny module-scope store of per-Output filter capabilities
// (`GET /api/outputs/:id/filter-capabilities`, HEL-1188), shared by every panel host bound to the
// same Output so the request is made once, cached for `CAPABILITIES_TTL_MS`, and can be
// invalidated from OUTSIDE React (the `fetchPanelPage` thunk, on a cross-filter `eq` rejection).
// Consumed by `useOutputFilterCapabilities` via `useSyncExternalStore`.

import { getSessionEpoch } from "../../../shared/session/sessionEpoch";
import { registerSessionReset } from "../../../shared/session/sessionReset";
import { fetchPublicFilterCapabilities } from "../../dashboards/services/publicDashboardService";
import { getFilterCapabilities } from "../../pipelines/services/outputService";
import type { OutputFilterCapabilitiesResponse } from "../../pipelines/types/output";

export const CAPABILITIES_TTL_MS = 5 * 60 * 1000;

/** `column` -> the operators the contract currently allows on it. */
export type CapabilityColumns = ReadonlyMap<string, ReadonlySet<string>>;

export type CapabilitiesEntry =
  | { status: "loading" }
  | { status: "ready"; columns: CapabilityColumns; expiresAt: number }
  // Failed to load, OR invalidated after the server rejected a cross-filter `eq` (cardinality
  // grew past the cap). Either way the Output is client-fallback until the entry expires.
  | { status: "unavailable"; expiresAt: number };

/** HEL-1780 D5 -- the key of a per-panel capabilities entry (`GET /api/dashboards/:id/panels/:panelId/filter-capabilities`,
 *  already narrowed to that panel's own control columns). Never an `outputId`: two panels bound to one Output with
 *  different controls have different capabilities. */
export function panelCapabilitiesKey(dashboardId: string, panelId: string): string {
  return `panel:${dashboardId}:${panelId}`;
}

const entries = new Map<string, CapabilitiesEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

export function subscribeCapabilities(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The live entry for an Output, or `undefined` when none exists or it has expired. Stable
 *  (returns the stored object) between changes, as `useSyncExternalStore` requires. */
export function getCapabilitiesEntry(outputId: string): CapabilitiesEntry | undefined {
  const entry = entries.get(outputId);
  if (!entry) return undefined;
  if (entry.status !== "loading" && entry.expiresAt <= Date.now()) return undefined;
  return entry;
}

/** Starts the (single, shared) capabilities request for a key (an `outputId`, or a `panelCapabilitiesKey`) when no live
 *  entry exists. `load` defaults to the Output route; a per-panel key passes the per-panel fetch. */
export function ensureCapabilitiesLoaded(
  outputId: string,
  load: () => Promise<OutputFilterCapabilitiesResponse> = () => getFilterCapabilities(outputId),
): void {
  if (getCapabilitiesEntry(outputId) !== undefined) return;
  entries.set(outputId, { status: "loading" });
  notify();
  const epoch = getSessionEpoch();
  void (async () => {
    try {
      const response = await load();
      // HEL-1634: a load that started in an earlier session never lands in this one.
      if (epoch !== getSessionEpoch()) return;
      const columns = new Map<string, ReadonlySet<string>>(
        response.columns.map((c) => [c.column, new Set<string>(c.operators)]),
      );
      // A concurrent invalidation supersedes an in-flight load.
      if (entries.get(outputId)?.status !== "loading") return;
      entries.set(outputId, {
        status: "ready",
        columns,
        expiresAt: Date.now() + CAPABILITIES_TTL_MS,
      });
    } catch {
      if (epoch !== getSessionEpoch()) return;
      if (entries.get(outputId)?.status !== "loading") return;
      entries.set(outputId, { status: "unavailable", expiresAt: Date.now() + CAPABILITIES_TTL_MS });
    }
    notify();
  })();
}

/** design.md D3a — the server rejected a cross-filter `eq` for this Output (HTTP 400): treat the
 *  Output as client-fallback for the TTL, so every host re-derives its mode and stops sending
 *  the `eq`. Deliberately a blocked entry, not a delete: a delete would re-fetch capabilities,
 *  and a contract that still (wrongly) listed `eq` would loop eq -> 400 -> refetch -> eq. */
export function invalidateCapabilities(outputId: string): void {
  entries.set(outputId, { status: "unavailable", expiresAt: Date.now() + CAPABILITIES_TTL_MS });
  notify();
}

/** The per-panel loader (no share token: a signed-in grantee is admitted by their grant). */
export function loadPanelCapabilities(
  dashboardId: string,
  panelId: string,
): () => Promise<OutputFilterCapabilitiesResponse> {
  return () => fetchPublicFilterCapabilities(dashboardId, panelId);
}

/** Test-only reset. */
export function resetCapabilitiesStoreForTests(): void {
  entries.clear();
  notify();
}

registerSessionReset("filterCapabilitiesStore", {
  covers: ["features/panels/state/filterCapabilitiesStore.ts#entries"],
  reset: resetCapabilitiesStoreForTests,
});
