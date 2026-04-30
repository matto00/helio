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

export interface ChartLegend {
  show: boolean;
  position: "top" | "bottom" | "left" | "right";
}

export interface ChartTooltip {
  enabled: boolean;
}

export interface ChartAxisLabel {
  show: boolean;
  label?: string;
}

export interface ChartAxisLabels {
  x: ChartAxisLabel;
  y: ChartAxisLabel;
}

export interface ChartAppearance {
  seriesColors: string[];
  legend: ChartLegend;
  tooltip: ChartTooltip;
  axisLabels: ChartAxisLabels;
  chartType?: "bar" | "line" | "pie" | "scatter";
}

export interface PanelAppearance {
  background: string;
  color: string;
  transparency: number;
  chart?: ChartAppearance;
}

export interface DataTypeField {
  name: string;
  displayName: string;
  dataType: string;
  nullable: boolean;
}

export interface ComputedField {
  name: string;
  displayName: string;
  expression: string;
  dataType: string;
}

export interface DataType {
  id: string;
  name: string;
  sourceId: string | null;
  version: number;
  fields: DataTypeField[];
  computedFields: ComputedField[];
  createdAt: string;
  updatedAt: string;
}

export interface DataSource {
  id: string;
  name: string;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
}

export interface InferredField {
  name: string;
  displayName: string;
  dataType: string;
  nullable: boolean;
}

export type StaticColumnType = "string" | "integer" | "float" | "boolean";

export interface StaticColumn {
  name: string;
  type: StaticColumnType;
}

export interface StaticSourcePayload {
  name: string;
  sourceType: "static";
  columns: StaticColumn[];
  rows: unknown[][];
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

export type MappedPanelData = Record<string, string>;

export interface DuplicateDashboardResponse {
  dashboard: Dashboard;
  panels: Panel[];
}

export interface DashboardSnapshotPanelEntry {
  snapshotId: string;
  title: string;
  type: string;
  appearance: {
    background?: string;
    color?: string;
    transparency?: number;
  };
  typeId?: string | null;
  fieldMapping?: Record<string, string> | null;
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

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: User;
}

// ── Update API types ─────────────────────────────────────────────────────────

export interface DashboardUpdatePayload {
  name?: string;
  appearance?: DashboardAppearance;
  layout?: DashboardLayout;
}

export interface UpdateDashboardBatchRequest {
  fields: string[];
  dashboard: DashboardUpdatePayload;
}

export interface PanelBatchItem {
  id: string;
  title?: string;
  appearance?: PanelAppearance;
  type?: string;
}

export interface UpdatePanelsBatchRequest {
  fields: string[];
  panels: PanelBatchItem[];
}

export interface UpdatePanelsBatchResponse {
  panels: Panel[];
}

export interface UserPreferencePayload {
  zoomLevel?: number;
}

export interface UpdateUserPreferenceRequest {
  fields: string[];
  user: UserPreferencePayload;
}
