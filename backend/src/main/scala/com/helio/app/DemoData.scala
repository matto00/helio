package com.helio.app

import com.helio.domain.Dashboard
import com.helio.domain.DashboardAppearance
import com.helio.domain.DashboardLayout
import com.helio.domain.DashboardLayoutItem
import com.helio.domain.DashboardId
import com.helio.domain.Panel
import com.helio.domain.PanelAppearance
import com.helio.domain.PanelId
import com.helio.domain.ResourceMeta

import java.time.Instant

object DemoData {
  private val DemoUser = "demo-seed"

  final case class SeedData(dashboards: Vector[Dashboard], panels: Vector[Panel])

  def build(): SeedData = {
    val operationsId = DashboardId("dashboard-operations")
    val executiveId = DashboardId("dashboard-executive")

    val operationsMeta = ResourceMeta(
      createdBy = DemoUser,
      createdAt = Instant.parse("2026-02-26T08:30:00Z"),
      lastUpdated = Instant.parse("2026-02-27T09:45:00Z")
    )
    val executiveMeta = ResourceMeta(
      createdBy = DemoUser,
      createdAt = Instant.parse("2026-02-26T10:00:00Z"),
      lastUpdated = Instant.parse("2026-02-27T11:30:00Z")
    )

    val dashboards = Vector(
      Dashboard(
        id = operationsId,
        name = "Operations",
        meta = operationsMeta,
        appearance = DashboardAppearance(
          background = "#081226",
          gridBackground = "#0b1730"
        ),
        layout = DashboardLayout(
          lg = Vector(
            DashboardLayoutItem(PanelId("panel-ops-latency"), x = 0, y = 0, w = 4, h = 5),
            DashboardLayoutItem(PanelId("panel-ops-incidents"), x = 4, y = 0, w = 4, h = 5)
          ),
          md = Vector(
            DashboardLayoutItem(PanelId("panel-ops-latency"), x = 0, y = 0, w = 5, h = 5),
            DashboardLayoutItem(PanelId("panel-ops-incidents"), x = 5, y = 0, w = 5, h = 5)
          ),
          sm = Vector(
            DashboardLayoutItem(PanelId("panel-ops-latency"), x = 0, y = 0, w = 3, h = 5),
            DashboardLayoutItem(PanelId("panel-ops-incidents"), x = 3, y = 0, w = 3, h = 5)
          ),
          xs = Vector(
            DashboardLayoutItem(PanelId("panel-ops-latency"), x = 0, y = 0, w = 2, h = 5),
            DashboardLayoutItem(PanelId("panel-ops-incidents"), x = 0, y = 5, w = 2, h = 5)
          )
        )
      ),
      Dashboard(
        id = executiveId,
        name = "Executive",
        meta = executiveMeta,
        appearance = DashboardAppearance(
          background = "#101826",
          gridBackground = "#16233a"
        ),
        layout = DashboardLayout(
          lg = Vector(
            DashboardLayoutItem(PanelId("panel-exec-revenue"), x = 0, y = 0, w = 4, h = 5),
            DashboardLayoutItem(PanelId("panel-exec-forecast"), x = 4, y = 2, w = 4, h = 5)
          ),
          md = Vector(
            DashboardLayoutItem(PanelId("panel-exec-revenue"), x = 0, y = 0, w = 5, h = 5),
            DashboardLayoutItem(PanelId("panel-exec-forecast"), x = 5, y = 2, w = 5, h = 5)
          ),
          sm = Vector(
            DashboardLayoutItem(PanelId("panel-exec-revenue"), x = 0, y = 0, w = 3, h = 5),
            DashboardLayoutItem(PanelId("panel-exec-forecast"), x = 0, y = 5, w = 3, h = 5)
          ),
          xs = Vector(
            DashboardLayoutItem(PanelId("panel-exec-revenue"), x = 0, y = 0, w = 2, h = 5),
            DashboardLayoutItem(PanelId("panel-exec-forecast"), x = 0, y = 5, w = 2, h = 5)
          )
        )
      )
    )

    val panels = Vector(
      Panel(
        id = PanelId("panel-ops-latency"),
        dashboardId = operationsId,
        title = "Latency",
        meta = ResourceMeta(
          createdBy = DemoUser,
          createdAt = Instant.parse("2026-02-26T08:45:00Z"),
          lastUpdated = Instant.parse("2026-02-27T09:15:00Z")
        ),
        appearance = PanelAppearance(
          background = "#132238",
          color = "#e2e8f0",
          transparency = 0.12
        )
      ),
      Panel(
        id = PanelId("panel-ops-incidents"),
        dashboardId = operationsId,
        title = "Incident Queue",
        meta = ResourceMeta(
          createdBy = DemoUser,
          createdAt = Instant.parse("2026-02-26T09:00:00Z"),
          lastUpdated = Instant.parse("2026-02-27T09:25:00Z")
        ),
        appearance = PanelAppearance(
          background = "#1f2937",
          color = "#f8fafc",
          transparency = 0.18
        )
      ),
      Panel(
        id = PanelId("panel-exec-revenue"),
        dashboardId = executiveId,
        title = "Revenue Pulse",
        meta = ResourceMeta(
          createdBy = DemoUser,
          createdAt = Instant.parse("2026-02-26T10:15:00Z"),
          lastUpdated = Instant.parse("2026-02-27T11:00:00Z")
        ),
        appearance = PanelAppearance(
          background = "#1d2a44",
          color = "#f8fafc",
          transparency = 0.08
        )
      ),
      Panel(
        id = PanelId("panel-exec-forecast"),
        dashboardId = executiveId,
        title = "Forecast",
        meta = ResourceMeta(
          createdBy = DemoUser,
          createdAt = Instant.parse("2026-02-26T10:30:00Z"),
          lastUpdated = Instant.parse("2026-02-27T11:20:00Z")
        ),
        appearance = PanelAppearance(
          background = "#243b53",
          color = "#eff6ff",
          transparency = 0.16
        )
      )
    )

    SeedData(dashboards = dashboards, panels = panels)
  }
}
