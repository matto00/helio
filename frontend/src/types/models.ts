export interface ResourceMeta {
  createdBy: string;
  createdAt: string;
  lastUpdated: string;
}

export interface DashboardAppearance {
  background: string;
  gridBackground: string;
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
}

export interface Panel {
  id: string;
  dashboardId: string;
  title: string;
  meta: ResourceMeta;
  appearance: PanelAppearance;
}
