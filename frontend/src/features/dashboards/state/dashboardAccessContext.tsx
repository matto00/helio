import { createContext, useContext, type ReactNode } from "react";

import type { DashboardAccessRole } from "../types/dashboard";

// HEL-1773 -- the caller's role on the dashboard being shown, for the panel components deep under `PanelList`
// (cards, the detail modal, the fullscreen overlay, the phone stack), which would otherwise need the role threaded
// through every prop. `PanelList` provides it from `selectDashboardAccessRole`; the default is `owner`, so every
// surface that never mounts the provider (the public viewer page, which reads its own per-panel routes, and the many
// component tests) behaves exactly as before.

const DashboardAccessContext = createContext<DashboardAccessRole>("owner");

export function DashboardAccessProvider({
  role,
  children,
}: {
  role: DashboardAccessRole;
  children: ReactNode;
}) {
  return <DashboardAccessContext.Provider value={role}>{children}</DashboardAccessContext.Provider>;
}

export function useDashboardRole(): DashboardAccessRole {
  return useContext(DashboardAccessContext);
}

/** Owner or editor: may change the dashboard's layout, name, appearance and panels. */
export function useCanEditPanels(): boolean {
  const role = useDashboardRole();
  return role === "owner" || role === "editor";
}

/** Owner only: the caller may use the Output and pipeline routes (rows, metadata, history, insight, provenance, filter
 *  capabilities, run events). A dashboard grantee reads every panel through the per-panel routes instead, and a panel
 *  feature that has no per-panel route yet is not offered. */
export function useCanUseOutputRoutes(): boolean {
  return useDashboardRole() === "owner";
}
