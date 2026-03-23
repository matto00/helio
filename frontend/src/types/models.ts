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

export interface DataTypeField {
  name: string;
  fieldType: string;
}

export interface DataType {
  id: string;
  name: string;
  sourceId: string | null;
  sourceType: string;
  version: number;
  fields: DataTypeField[];
  createdAt: string;
  updatedAt: string;
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
  typeId: string | null;
  fieldMapping: Record<string, string> | null;
  refreshInterval: number | null;
}
