package com.helio.domain

final case class DashboardId(value: String) extends AnyVal
final case class PanelId(value: String) extends AnyVal

final case class Dashboard(id: DashboardId, name: String)
final case class Panel(id: PanelId, dashboardId: DashboardId, title: String)
