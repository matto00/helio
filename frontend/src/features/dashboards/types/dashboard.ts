// Dashboard domain types — extracted from `types/models.ts` as part of CS4
// cycle 1 to colocate types with their feature folder.

import type { Panel } from "../../panels/types/panel";
import type { ResourceMeta } from "../../../types/models";

export interface DashboardAppearance {
  background: string;
  gridBackground: string;
}

export interface DashboardLayoutItem {
  panelId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardLayout {
  lg: DashboardLayoutItem[];
  md: DashboardLayoutItem[];
  sm: DashboardLayoutItem[];
  xs: DashboardLayoutItem[];
}

export interface Dashboard {
  id: string;
  name: string;
  meta: ResourceMeta;
  appearance: DashboardAppearance;
  layout: DashboardLayout;
}

export interface DuplicateDashboardResponse {
  dashboard: Dashboard;
  panels: Panel[];
}

/** Snapshot entry mirrors the CS2c-3c wire shape: `type` discriminator +
 *  typed `config`. Specific config fields are determined by `type` and match
 *  the backend per-subtype `*PanelConfig` shapes; the FE keeps `config`
 *  loosely typed because snapshot round-trips don't depend on subtype
 *  narrowing on the frontend. */
export interface DashboardSnapshotPanelEntry {
  snapshotId: string;
  title: string;
  type: string;
  appearance: {
    background?: string;
    color?: string;
    transparency?: number;
  };
  config?: Record<string, unknown>;
}

export interface DashboardSnapshotDashboardEntry {
  name: string;
  appearance: {
    background?: string;
    gridBackground?: string;
  };
  layout: DashboardLayout;
}

export interface DashboardSnapshot {
  version: number;
  dashboard: DashboardSnapshotDashboardEntry;
  panels: DashboardSnapshotPanelEntry[];
}

export interface DashboardUpdatePayload {
  name?: string;
  appearance?: DashboardAppearance;
  layout?: DashboardLayout;
}

export interface UpdateDashboardBatchRequest {
  fields: string[];
  dashboard: DashboardUpdatePayload;
}
