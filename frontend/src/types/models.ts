export interface ResourceMeta {
  createdBy: string;
  createdAt: string;
  lastUpdated: string;
}

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

export interface PanelAppearance {
  background: string;
  color: string;
  transparency: number;
}

export interface Dashboard {
  id: string;
  name: string;
  meta: ResourceMeta;
  appearance: DashboardAppearance;
  layout: DashboardLayout;
}

export type PanelType = "metric" | "chart" | "text" | "table";

export interface Panel {
  id: string;
  dashboardId: string;
  title: string;
  type: PanelType;
  meta: ResourceMeta;
  appearance: PanelAppearance;
}
