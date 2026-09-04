package com.helio.app

import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import spray.json.JsObject

import java.time.Instant
import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration.DurationInt

object DemoData {
  val SystemUserId: UserId = UserId("00000000-0000-0000-0000-000000000001")
  private val SystemUser: AuthenticatedUser = AuthenticatedUser(SystemUserId)

  /** HEL-904 task 3.7: reseeds onto a real Source → Pipeline → three Outputs
   *  chain (no unbound panels) — the four demo panels each carry a real,
   *  non-empty `outputId`, two of them sharing the pipeline's third Output.
   *  No pipeline run/refresh is triggered here (this is boot-time seed data,
   *  not a live ingestion) — each Output's `schema` is set directly to a
   *  small illustrative shape so it round-trips a non-trivial demo without
   *  depending on the Spark run path. */
  def seedIfEmpty(
      dashboardRepo: DashboardRepository,
      panelRepo: PanelRepository,
      dataSourceRepo: DataSourceRepository,
      pipelineRepo: PipelineRepository,
      outputRepo: OutputRepository
  )(implicit ec: ExecutionContext): Unit = {
    val count = Await.result(dashboardRepo.count(), 5.seconds)
    if (count == 0) {
      val now = Instant.now()
      val source = CsvSource(
        id             = DataSourceId("source-demo"),
        name           = "Demo Orders",
        ownerId        = SystemUserId,
        createdAt      = now,
        updatedAt      = now,
        config         = CsvSourceConfig(path = "demo/orders.csv"),
        inferredSchema = Vector(SchemaField("orderId", "string"), SchemaField("amount", "float"), SchemaField("status", "string"))
      )
      Await.result(dataSourceRepo.insert(source, SystemUser), 5.seconds)

      val pipelineSummary = Await.result(pipelineRepo.create("Demo Pipeline", Vector(source.id), SystemUser), 5.seconds)
        .fold(err => throw new IllegalStateException(s"DemoData: failed to seed demo pipeline: $err"), r => r)
      val pipelineId = PipelineId(pipelineSummary.id)

      // DemoData seeds a single-root pipeline (one source above), so the root-bound outputs
      // below always mean that pipeline's one root -- named explicitly (task 7.3e) rather than
      // relying on `insertInternal`'s now-removed `firstRootIdAction` fallback default.
      val demoRootId = PipelineRootId(pipelineSummary.roots.head.id)

      def seedOutput(name: String, kind: OutputKind): Output =
        Await.result(
          outputRepo.insertInternal(
            pipelineId     = pipelineId,
            nodeStepId     = None,
            ownerId        = SystemUserId,
            name           = name,
            kind           = kind,
            schema         = source.inferredSchema,
            explicitRootId = Some(demoRootId)
          ),
          5.seconds
        )

      val latencyOutput  = seedOutput("Latency", OutputKind.Chart)
      val incidentOutput = seedOutput("Incident Queue", OutputKind.Table)
      val revenueOutput  = seedOutput("Revenue Pulse", OutputKind.Metric)

      val data = build(latencyOutput.id, incidentOutput.id, revenueOutput.id)
      data.dashboards.foreach(d => Await.result(dashboardRepo.insert(d), 5.seconds))
      data.panels.foreach(p => Await.result(panelRepo.insert(p), 5.seconds))
    }
  }

  private final case class SeedData(dashboards: Vector[Dashboard], panels: Vector[Panel])

  private def build(latencyOutputId: OutputId, incidentOutputId: OutputId, revenueOutputId: OutputId): SeedData = {
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

    // HEL-904 task 3.7: real Source → Pipeline → three Outputs, no unbound
    // panels — each panel below carries a real, non-empty `outputId`
    // (`seedIfEmpty` creates the source/pipeline/Outputs before calling
    // `build`). The exec-forecast panel deliberately shares the
    // revenueOutputId (three Outputs feed four panels, per the ticket's
    // "one source → one pipeline → three Outputs" scope).
    val panels: Vector[Panel] = Vector(
      OutputPanel(
        id          = PanelId("panel-ops-latency"),
        dashboardId = operationsId,
        title       = "Latency",
        meta        = ResourceMeta(SystemUserId.value, Instant.parse("2026-02-26T08:45:00Z"), Instant.parse("2026-02-27T09:15:00Z")),
        appearance  = PanelAppearance("#132238", "#e2e8f0", 0.12),
        ownerId     = SystemUserId,
        config      = OutputPanelConfig(latencyOutputId)
      ),
      OutputPanel(
        id          = PanelId("panel-ops-incidents"),
        dashboardId = operationsId,
        title       = "Incident Queue",
        meta        = ResourceMeta(SystemUserId.value, Instant.parse("2026-02-26T09:00:00Z"), Instant.parse("2026-02-27T09:25:00Z")),
        appearance  = PanelAppearance("#1f2937", "#f8fafc", 0.18),
        ownerId     = SystemUserId,
        config      = OutputPanelConfig(incidentOutputId)
      ),
      OutputPanel(
        id          = PanelId("panel-exec-revenue"),
        dashboardId = executiveId,
        title       = "Revenue Pulse",
        meta        = ResourceMeta(SystemUserId.value, Instant.parse("2026-02-26T10:15:00Z"), Instant.parse("2026-02-27T11:00:00Z")),
        appearance  = PanelAppearance("#1d2a44", "#f8fafc", 0.08),
        ownerId     = SystemUserId,
        config      = OutputPanelConfig(revenueOutputId)
      ),
      OutputPanel(
        id          = PanelId("panel-exec-forecast"),
        dashboardId = executiveId,
        title       = "Forecast",
        meta        = ResourceMeta(SystemUserId.value, Instant.parse("2026-02-26T10:30:00Z"), Instant.parse("2026-02-27T11:20:00Z")),
        appearance  = PanelAppearance("#243b53", "#eff6ff", 0.16),
        ownerId     = SystemUserId,
        config      = OutputPanelConfig(revenueOutputId)
      )
    )

    SeedData(dashboards, panels)
  }
}
