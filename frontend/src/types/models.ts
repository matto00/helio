export interface ResourceMeta {
  createdBy: string;
  createdAt: string;
  lastUpdated: string;
}

export interface Dashboard {
  id: string;
  name: string;
  meta: ResourceMeta;
}

export interface Panel {
  id: string;
  dashboardId: string;
  title: string;
  meta: ResourceMeta;
}
