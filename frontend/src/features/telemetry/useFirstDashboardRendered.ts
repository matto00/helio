import { useEffect } from "react";

import { useAppSelector } from "../../hooks/reduxHooks";
import { claimFirstDashboardEmission } from "./firstDashboardFlag";
import { track } from "./track";

/** Emits `first_dashboard_rendered` the first time an OUTPUT panel has loaded at least one row
 *  for the signed-in user (a zero-row panel, a non-output panel, or an errored fetch never
 *  counts). The per-user "delivered" flag is set by the telemetry queue only after the server
 *  accepts the event, so a dropped or failed delivery is re-emitted on a later visit; the server
 *  dedupes authoritatively. Authenticated-only by construction: no user means nothing is emitted. */
export function useFirstDashboardRendered(rendered: boolean): void {
  const userId = useAppSelector((state) => state.auth.currentUser?.id ?? null);
  const panelCount = useAppSelector((state) => state.panels.items.length);
  useEffect(() => {
    if (!rendered || !userId || !claimFirstDashboardEmission(userId)) return;
    track("first_dashboard_rendered", { panelCount: Math.min(Math.max(panelCount, 1), 500) });
  }, [rendered, userId, panelCount]);
}
