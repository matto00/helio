/**
 * Output-panel controls for `get_workspace_context` placements (HEL-1193 design.md D5).
 *
 * The dashboard export is the only read that carries a panel's `config`, so each distinct
 * dashboard hosting a placement is exported ONCE (deduped across every Output) and the panels'
 * controls are indexed from it. A failed export degrades that dashboard's placements to
 * `controls: []`, never the whole context (same convention as `fetchPlacements`). `defaultValue`
 * is omitted deliberately to keep the context small.
 */

import type { HelioApi } from "./helioApi.js";
import type { OutputControlKind } from "./types.js";

export interface ContextControl {
  id: string;
  kind: OutputControlKind;
  column: string;
  label: string;
  /** Present only when the backend flagged the control as no longer eligible. */
  orphaned?: true;
}

export type PanelControlsLookup = (
  dashboardId: string,
  panelId: string,
) => Promise<ContextControl[]>;

function toContextControl(raw: unknown): ContextControl {
  const c = raw as Record<string, unknown>;
  return {
    id: c.id as string,
    kind: c.kind as OutputControlKind,
    column: c.column as string,
    label: c.label as string,
    ...(c.orphaned === true ? { orphaned: true as const } : {}),
  };
}

export function createPanelControlsLookup(api: HelioApi): PanelControlsLookup {
  const byDashboard = new Map<string, Promise<Map<string, ContextControl[]>>>();

  const load = (dashboardId: string): Promise<Map<string, ContextControl[]>> => {
    let pending = byDashboard.get(dashboardId);
    if (!pending) {
      pending = (async () => {
        try {
          const snapshot = await api.getDashboardSnapshot(dashboardId);
          const index = new Map<string, ContextControl[]>();
          for (const panel of snapshot.panels) {
            const controls = (panel.config as { controls?: unknown[] } | null)?.controls;
            if (panel.id && Array.isArray(controls))
              index.set(panel.id, controls.map(toContextControl));
          }
          return index;
        } catch {
          return new Map<string, ContextControl[]>();
        }
      })();
      byDashboard.set(dashboardId, pending);
    }
    return pending;
  };

  return async (dashboardId, panelId) => (await load(dashboardId)).get(panelId) ?? [];
}
