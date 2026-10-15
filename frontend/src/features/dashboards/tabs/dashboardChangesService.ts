import { httpClient } from "../../../services/httpClient";
import type { DashboardChange } from "./tabTypes";

interface DashboardChangesWire {
  serverNow: string;
  items: Array<{
    dashboardId: string;
    contentUpdatedAt?: string | null;
    dataUpdatedAt?: string | null;
    outputs?: Array<{ outputId: string; dataUpdatedAt?: string | null }> | null;
  }>;
}

export interface DashboardChangesResult {
  serverNow: string;
  items: DashboardChange[];
}

/** `GET /api/dashboard-changes?ids=` (HEL-1575 D6): when each dashboard's content last changed and when its
 *  panels' Outputs last received data. At most 20 ids (the tab cap); ids the caller cannot read come back
 *  omitted. This is the ONLY request the tabs' refresh triggers make: never a panel or rows request. */
export async function fetchDashboardChanges(ids: string[]): Promise<DashboardChangesResult> {
  const response = await httpClient.get<DashboardChangesWire>("/api/dashboard-changes", {
    params: { ids: ids.join(",") },
  });
  return {
    serverNow: response.data.serverNow,
    items: response.data.items.map((item) => ({
      dashboardId: item.dashboardId,
      contentUpdatedAt: item.contentUpdatedAt ?? null,
      dataUpdatedAt: item.dataUpdatedAt ?? null,
      outputs: (item.outputs ?? []).map((o) => ({
        outputId: o.outputId,
        dataUpdatedAt: o.dataUpdatedAt ?? null,
      })),
    })),
  };
}
