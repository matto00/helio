export interface Dashboard {
  id: string;
  name: string;
}

export interface Panel {
  id: string;
  dashboardId: string;
  title: string;
}
