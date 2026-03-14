package com.helio.domain

import java.time.Instant

final case class DashboardId(value: String) extends AnyVal
final case class PanelId(value: String) extends AnyVal
final case class ResourceMeta(createdBy: String, createdAt: Instant, lastUpdated: Instant)

final case class Dashboard(id: DashboardId, name: String, meta: ResourceMeta)
final case class Panel(id: PanelId, dashboardId: DashboardId, title: String, meta: ResourceMeta)
