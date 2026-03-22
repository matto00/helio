package com.helio.app

import com.helio.domain._
import com.helio.infrastructure.{DashboardRepository, PanelRepository}

import java.time.Instant
import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration.DurationInt

object DemoData {
  private val DemoUser = "demo-seed"

  def seedIfEmpty(
      dashboardRepo: DashboardRepository,
      panelRepo: PanelRepository
  )(implicit ec: ExecutionContext): Unit = {
    val count = Await.result(dashboardRepo.count(), 5.seconds)
    if (count == 0) {
      val data = build()
      data.dashboards.foreach(d => Await.result(dashboardRepo.insert(d), 5.seconds))
      data.panels.foreach(p => Await.result(panelRepo.insert(p), 5.seconds))
    }
  }

  private final case class SeedData(dashboards: Vector[Dashboard], panels: Vector[Panel])

  private def build(): SeedData = {
    val operationsId = DashboardId("dashboard-operations")
    val executiveId  = DashboardId("dashboard-executive")

    val operationsMeta = ResourceMeta(
      createdBy   = DemoUser,
      createdAt   = Instant.parse("2026-02-26T08:30:00Z"),
      lastUpdated = Instant.parse("2026-02-27T09:45:00Z")
    )
    val executiveMeta = ResourceMeta(
      createdBy   = DemoUser,
      createdAt   = Instant.parse("2026-02-26T10:00:00Z"),
      lastUpdated = Instant.parse("2026-02-27T11:30:00Z")
    )

    val dashboards = Vector(
      Dashboard(
        id         = operationsId,
        name       = "Operations",
        meta       = operationsMeta,
        appearance = DashboardAppearance("#081226", "#0b1730"),
        layout     = DashboardLayout(
          lg = Vector(
            DashboardLayoutItem(PanelId("panel-ops-latency"),   x = 0, y = 0, w = 4, h = 5),
            DashboardLayoutItem(PanelId("panel-ops-incidents"), x = 4, y = 0, w = 4, h = 5)
          ),
          md = Vector(
            DashboardLayoutItem(PanelId("panel-ops-latency"),   x = 0, y = 0, w = 5, h = 5),
            DashboardLayoutItem(PanelId("panel-ops-incidents"), x = 5, y = 0, w = 5, h = 5)
          ),
          sm = Vector(
            DashboardLayoutItem(PanelId("panel-ops-latency"),   x = 0, y = 0, w = 3, h = 5),
            DashboardLayoutItem(PanelId("panel-ops-incidents"), x = 3, y = 0, w = 3, h = 5)
          ),
          xs = Vector(
            DashboardLayoutItem(PanelId("panel-ops-latency"),   x = 0, y = 0, w = 2, h = 5),
            DashboardLayoutItem(PanelId("panel-ops-incidents"), x = 0, y = 5, w = 2, h = 5)
          )
        )
      ),
      Dashboard(
        id         = executiveId,
        name       = "Executive",
        meta       = executiveMeta,
        appearance = DashboardAppearance("#101826", "#16233a"),
        layout     = DashboardLayout(
          lg = Vector(
            DashboardLayoutItem(PanelId("panel-exec-revenue"),  x = 0, y = 0, w = 4, h = 5),
            DashboardLayoutItem(PanelId("panel-exec-forecast"), x = 4, y = 2, w = 4, h = 5)
          ),
          md = Vector(
            DashboardLayoutItem(PanelId("panel-exec-revenue"),  x = 0, y = 0, w = 5, h = 5),
            DashboardLayoutItem(PanelId("panel-exec-forecast"), x = 5, y = 2, w = 5, h = 5)
          ),
          sm = Vector(
            DashboardLayoutItem(PanelId("panel-exec-revenue"),  x = 0, y = 0, w = 3, h = 5),
            DashboardLayoutItem(PanelId("panel-exec-forecast"), x = 0, y = 5, w = 3, h = 5)
          ),
          xs = Vector(
            DashboardLayoutItem(PanelId("panel-exec-revenue"),  x = 0, y = 0, w = 2, h = 5),
            DashboardLayoutItem(PanelId("panel-exec-forecast"), x = 0, y = 5, w = 2, h = 5)
          )
        )
      )
    )

    val panels = Vector(
      Panel(
        id          = PanelId("panel-ops-latency"),
        dashboardId = operationsId,
        title       = "Latency",
        meta        = ResourceMeta(DemoUser, Instant.parse("2026-02-26T08:45:00Z"), Instant.parse("2026-02-27T09:15:00Z")),
        appearance  = PanelAppearance("#132238", "#e2e8f0", 0.12),
        panelType   = PanelType.Metric
      ),
      Panel(
        id          = PanelId("panel-ops-incidents"),
        dashboardId = operationsId,
        title       = "Incident Queue",
        meta        = ResourceMeta(DemoUser, Instant.parse("2026-02-26T09:00:00Z"), Instant.parse("2026-02-27T09:25:00Z")),
        appearance  = PanelAppearance("#1f2937", "#f8fafc", 0.18),
        panelType   = PanelType.Table
      ),
      Panel(
        id          = PanelId("panel-exec-revenue"),
        dashboardId = executiveId,
        title       = "Revenue Pulse",
        meta        = ResourceMeta(DemoUser, Instant.parse("2026-02-26T10:15:00Z"), Instant.parse("2026-02-27T11:00:00Z")),
        appearance  = PanelAppearance("#1d2a44", "#f8fafc", 0.08),
        panelType   = PanelType.Chart
      ),
      Panel(
        id          = PanelId("panel-exec-forecast"),
        dashboardId = executiveId,
        title       = "Forecast",
        meta        = ResourceMeta(DemoUser, Instant.parse("2026-02-26T10:30:00Z"), Instant.parse("2026-02-27T11:20:00Z")),
        appearance  = PanelAppearance("#243b53", "#eff6ff", 0.16),
        panelType   = PanelType.Chart
      )
    )

    SeedData(dashboards, panels)
  }
}
