package com.helio.services.panels


import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.panels.{PanelService, ResolvedPanelPatch}
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelAppearancePayload, PanelBatchItem}
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, never, times, verify, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsObject, JsString}
import com.helio.services.panels.PanelServiceHelpers.validateScatterAggregationConflict

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-624 task 5.5 — coverage for four of the five write-path enforcement
 *  sites `ChartPanel.rejectsAggregation` is wired into: direct create, single
 *  update, batch update, and the `ChartPanel` type-narrowing guard on a
 *  non-chart panel. (The remaining two sites — the `ProposalPanel` pre-pass
 *  and dashboard-snapshot import — are covered separately, see
 *  `DashboardProposalServiceSpec`/`DashboardContentsServiceSpec` and
 *  `DashboardServiceValidationSpec`.)
 *
 *  Create and batch-update are exercised through the full `PanelService` with
 *  mocked repositories (same style as `PanelServiceBatchUpdateErrorSpec`/
 *  `PanelServiceBuildAllForCreateSpec`). Single update is exercised directly
 *  against `PanelServiceHelpers.validateScatterAggregationConflict` — see the
 *  comment on that section for why. */
class PanelServiceScatterAggregationSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now     = Instant.parse("2026-01-01T00:00:00Z")
  private val dashId  = DashboardId("d-1")
  private val meta    = ResourceMeta("u", now, now)
  private val ownerId = UserId(UUID.randomUUID().toString)
  private val user    = AuthenticatedUser(ownerId)

  private val stubAccess: AccessChecker = new AccessChecker {
    def requireOwnerOnly(rt: String, rid: String, u: AuthenticatedUser, msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
    def requireAccess(rt: String, rid: String, uOpt: Option[AuthenticatedUser], msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
  }

  private def aggregationJson: JsObject =
    JsObject("groupBy" -> JsString("category"), "agg" -> JsString("sum"), "yField" -> JsString("amount"))

  private def chartAppearance(chartType: String): ChartAppearance =
    ChartAppearance.Default.copy(chartType = Some(chartType))

  private def chartPanel(id: String, chartType: String, aggregation: Option[JsObject]): ChartPanel =
    ChartPanel(
      PanelId(id),
      dashId,
      "Chart",
      meta,
      PanelAppearance.Default.copy(chart = Some(chartAppearance(chartType))),
      ownerId,
      ChartPanelConfig.Empty.copy(aggregation = aggregation)
    )

  private def tablePanel(id: String): TablePanel =
    TablePanel(PanelId(id), dashId, "Table", meta, PanelAppearance.Default, ownerId, TablePanelConfig.Empty)


  "PanelService.create" should {

    "reject scatter + aggregation with a 400 and never insert" in {
      val panelRepo     = mock(classOf[PanelRepository])
      val dtRepo        = mock(classOf[DataTypeRepository])
      val dashboardRepo = mock(classOf[DashboardRepository])
      val service       = new PanelService(panelRepo, dtRepo, stubAccess, dashboardRepo, mock(classOf[MetricRepository]))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Scatter"),
        `type`      = Some("chart"),
        config      = Some(JsObject("aggregation" -> aggregationJson)),
        appearance  = Some(PanelAppearancePayload(None, None, None, Some(chartAppearance("scatter"))))
      )

      val result = await(service.create(request, user))

      result.isLeft shouldBe true
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
      result.swap.toOption.get.message should include("aggregation is not supported for scatter charts")
      verify(panelRepo, never()).insert(any[Panel])
    }

    "accept scatter without aggregation" in {
      val panelRepo     = mock(classOf[PanelRepository])
      val dtRepo        = mock(classOf[DataTypeRepository])
      val dashboardRepo = mock(classOf[DashboardRepository])
      val service       = new PanelService(panelRepo, dtRepo, stubAccess, dashboardRepo, mock(classOf[MetricRepository]))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Scatter"),
        `type`      = Some("chart"),
        config      = None,
        appearance  = Some(PanelAppearancePayload(None, None, None, Some(chartAppearance("scatter"))))
      )
      when(panelRepo.insert(any[Panel])).thenAnswer(inv => Future.successful(inv.getArgument(0).asInstanceOf[Panel]))

      val result = await(service.create(request, user))

      result.isRight shouldBe true
      verify(panelRepo, times(1)).insert(any[Panel])
    }
  }

  // ── Update (single) ────────────────────────────────────────────────────
  //
  // Exercised directly against `PanelServiceHelpers.validateScatterAggregationConflict`
  // — the exact pre-write gate `PanelService.update` calls before
  // `patchApplier.apply` (see `PanelService.scala`'s `update`) — rather than
  // through the full mocked `PanelService.update` flow. `PanelId` is a Scala
  // `AnyVal` value class; Mockito's `any()`/`eq()` matchers return `null` as a
  // placeholder, which Scala then unboxes (`.value`) at the call site for any
  // method taking a raw `PanelId` param, NPEing before Mockito ever runs the
  // match — unrelated to this ticket's logic. Testing the pure helper
  // sidesteps that entirely while covering the identical business rule.

  "PanelServiceHelpers.validateScatterAggregationConflict" should {

    "reject a chartType-only PATCH to scatter against an existing aggregation" in {
      val existing = chartPanel("p-1", "bar", Some(aggregationJson))
      val spec = ResolvedPanelPatch(
        trimmedTitle = None,
        appearance   = Some(PanelAppearance.Default.copy(chart = Some(chartAppearance("scatter")))),
        panelType    = None,
        configPatch  = None
      )

      val result = validateScatterAggregationConflict(existing, spec)

      result.isLeft shouldBe true
      result.swap.toOption.get should include("aggregation is not supported for scatter charts")
    }

    "reject an aggregation-only PATCH against an existing scatter chartType" in {
      val existing = chartPanel("p-1", "scatter", None)
      val spec = ResolvedPanelPatch(
        trimmedTitle = None,
        appearance   = None,
        panelType    = None,
        configPatch  = Some(JsObject("aggregation" -> aggregationJson))
      )

      val result = validateScatterAggregationConflict(existing, spec)

      result.isLeft shouldBe true
      result.swap.toOption.get should include("aggregation is not supported for scatter charts")
    }

    "leave a non-chart panel's incidental appearance.chart.chartType PATCH unaffected (type-narrowing guard)" in {
      val existing = tablePanel("p-1")
      val spec = ResolvedPanelPatch(
        trimmedTitle = None,
        // A table panel structurally carries `appearance.chart` (shared field
        // across every panel kind) — setting it to scatter must NOT trigger
        // the chart-only scatter+aggregation rule, since `TablePanelConfig`
        // has no `aggregation` concept at all.
        appearance   = Some(PanelAppearance.Default.copy(chart = Some(chartAppearance("scatter")))),
        panelType    = None,
        configPatch  = None
      )

      val result = validateScatterAggregationConflict(existing, spec)

      result shouldBe Right(())
    }

    "accept a chartType-only PATCH to pie against an existing aggregation" in {
      val existing = chartPanel("p-1", "bar", Some(aggregationJson))
      val spec = ResolvedPanelPatch(
        trimmedTitle = None,
        appearance   = Some(PanelAppearance.Default.copy(chart = Some(chartAppearance("pie")))),
        panelType    = None,
        configPatch  = None
      )

      validateScatterAggregationConflict(existing, spec) shouldBe Right(())
    }
  }


  "PanelService.batchUpdate" should {

    "reject one conflicting item and write nothing (no partial write)" in {
      val panelRepo     = mock(classOf[PanelRepository])
      val dtRepo        = mock(classOf[DataTypeRepository])
      val dashboardRepo = mock(classOf[DashboardRepository])
      val service       = new PanelService(panelRepo, dtRepo, stubAccess, dashboardRepo, mock(classOf[MetricRepository]))

      val okPanel   = chartPanel("p-1", "bar", None)
      val badPanel  = chartPanel("p-2", "bar", None)
      when(panelRepo.findByIdInternal(PanelId("p-1"))).thenReturn(Future.successful(Some(okPanel)))
      when(panelRepo.findByIdInternal(PanelId("p-2"))).thenReturn(Future.successful(Some(badPanel)))

      val okItem = PanelBatchItem(
        id         = "p-1",
        title      = None,
        appearance = None,
        `type`     = None,
        config     = Some(JsObject("aggregation" -> aggregationJson))
      )
      val badItem = PanelBatchItem(
        id         = "p-2",
        title      = None,
        appearance = Some(JsObject("chart" -> JsObject("chartType" -> JsString("scatter")))),
        `type`     = None,
        config     = Some(JsObject("aggregation" -> aggregationJson))
      )

      val result = await(service.batchUpdate(Vector(okItem, badItem), user))

      result.isLeft shouldBe true
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
      result.swap.toOption.get.message should include("p-2")
      result.swap.toOption.get.message should include("aggregation is not supported for scatter charts")
      verify(panelRepo, never()).batchUpdate(any[Vector[PanelBatchItem]], any[Instant])
    }
  }
}
