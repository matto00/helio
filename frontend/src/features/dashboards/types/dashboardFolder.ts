/** A per-user dashboard folder (HEL-1574). */
export interface DashboardFolder {
  id: string;
  name: string;
  collapsed: boolean;
  createdAt: string;
}

/** The caller's filing of one dashboard into one of their folders. */
export interface DashboardFolderAssignment {
  dashboardId: string;
  folderId: string;
}

/** `GET /api/dashboard-folders`. */
export interface DashboardFolderList {
  folders: DashboardFolder[];
  assignments: DashboardFolderAssignment[];
}
