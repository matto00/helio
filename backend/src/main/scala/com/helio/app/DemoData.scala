package com.helio.app

import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import spray.json.JsObject

import java.time.Instant
import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration.DurationInt

object DemoData {
  val SystemUserId: UserId = UserId("00000000-0000-0000-0000-000000000001")

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
      createdBy   = SystemUserId.value,
      createdAt   = Instant.parse("2026-02-26T08:30:00Z"),
      lastUpdated = Instant.parse("2026-02-27T09:45:00Z")
    )
    val executiveMeta = ResourceMeta(
      createdBy   = SystemUserId.value,
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
        ),
        ownerId    = SystemUserId
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
        ),
        ownerId    = SystemUserId
      )
    )

    // HEL-904 task 3.6 (collapse): the bound trio (MetricPanel/ChartPanel/
    // TablePanel) no longer exists — a real reseed onto Source → Pipeline →
    // Output (task 3.7, not yet done: `seedIfEmpty`'s signature doesn't yet
    // thread a `PipelineRunService`/`OutputRepository`) is deferred. In the
    // interim these four seed panels are placeholder unbound `OutputPanel`s
    // (empty `outputId`, mirroring the prior empty-`dataTypeId` "unbound"
    // convention) so `DemoData` keeps compiling and inserting cleanly — NOT
    // a real Output-bound demo experience. See execution-progress.md.
    val emptyOutput = OutputPanelConfig.Empty

    val panels: Vector[Panel] = Vector(
      OutputPanel(
        id          = PanelId("panel-ops-latency"),
        dashboardId = operationsId,
        title       = "Latency",
        meta        = ResourceMeta(SystemUserId.value, Instant.parse("2026-02-26T08:45:00Z"), Instant.parse("2026-02-27T09:15:00Z")),
        appearance  = PanelAppearance("#132238", "#e2e8f0", 0.12),
        ownerId     = SystemUserId,
        config      = emptyOutput
      ),
      OutputPanel(
        id          = PanelId("panel-ops-incidents"),
        dashboardId = operationsId,
        title       = "Incident Queue",
        meta        = ResourceMeta(SystemUserId.value, Instant.parse("2026-02-26T09:00:00Z"), Instant.parse("2026-02-27T09:25:00Z")),
        appearance  = PanelAppearance("#1f2937", "#f8fafc", 0.18),
        ownerId     = SystemUserId,
        config      = emptyOutput
      ),
      OutputPanel(
        id          = PanelId("panel-exec-revenue"),
        dashboardId = executiveId,
        title       = "Revenue Pulse",
        meta        = ResourceMeta(SystemUserId.value, Instant.parse("2026-02-26T10:15:00Z"), Instant.parse("2026-02-27T11:00:00Z")),
        appearance  = PanelAppearance("#1d2a44", "#f8fafc", 0.08),
        ownerId     = SystemUserId,
        config      = emptyOutput
      ),
      OutputPanel(
        id          = PanelId("panel-exec-forecast"),
        dashboardId = executiveId,
        title       = "Forecast",
        meta        = ResourceMeta(SystemUserId.value, Instant.parse("2026-02-26T10:30:00Z"), Instant.parse("2026-02-27T11:20:00Z")),
        appearance  = PanelAppearance("#243b53", "#eff6ff", 0.16),
        ownerId     = SystemUserId,
        config      = emptyOutput
      )
    )

    SeedData(dashboards, panels)
  }
}
