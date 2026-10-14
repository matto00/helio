package com.helio.domain.model

import java.time.Instant

/** HEL-1574: a per-user dashboard folder (`dashboard_folders`, V134). `id` is the folder's UUID as text. */
final case class DashboardFolder(id: String, name: String, collapsed: Boolean, createdAt: Instant)

/** A user's private filing of a dashboard they can access into one of their folders. */
final case class DashboardFolderAssignment(dashboardId: String, folderId: String)
