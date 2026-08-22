package com.helio.services.panels


import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.panels.PanelService
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
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
import spray.json.{JsNull, JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Unit tests for HEL-500 tasks.md T.2 — `PanelService.create`/`update`
 *  reject a foreign or nonexistent `metricId` (400); accept a caller-owned,
 *  pipeline-output-backed `metricId`; both raw fields and `metricId` may be
 *  set together (design.md D5's precedence — not mutually exclusive).
 *
 *  Uses the same mocked-repository style as
 *  `PanelServiceCompanionBindingGuardSpec` so the guard is exercised
 *  without a database. */
class PanelServiceMetricBindingSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now        = Instant.parse("2026-01-01T00:00:00Z")
  private val dashId     = DashboardId("d-1")
  private val meta       = ResourceMeta("u", now, now)
  private val ownerId    = UserId(UUID.randomUUID().toString)
  private val user       = AuthenticatedUser(ownerId)
  private val appearance = PanelAppearance.Default

  private val ownedMetricId  = MetricId(UUID.randomUUID().toString)
  private val foreignMetricId = MetricId(UUID.randomUUID().toString)
  private val outputTypeId   = DataTypeId(UUID.randomUUID().toString)
  private val companionTypeId = DataTypeId(UUID.randomUUID().toString)

  private def pipelineOutputDataType(id: DataTypeId): DataType =
    DataType(id, None, "Output", Vector.empty, Vector.empty, 1, now, now, ownerId)

  private def companionDataType(id: DataTypeId): DataType =
    DataType(id, Some(DataSourceId(UUID.randomUUID().toString)), "Companion", Vector.empty, Vector.empty, 1, now, now, ownerId)

  private def metricDefinition(id: MetricId, dataTypeId: DataTypeId): MetricDefinition =
    MetricDefinition(
      id                = id,
      ownerId           = ownerId,
      dataTypeId        = dataTypeId,
      name              = "Total Revenue",
      description       = None,
      measureField      = "revenue",
      aggregation       = "sum",
      allowedDimensions = Vector.empty,
      format            = MetricFormat(None, None, None, None),
      createdAt         = now,
      updatedAt         = now
    )

  private val stubAccess: AccessChecker = new AccessChecker {
    def requireOwnerOnly(rt: String, rid: String, u: AuthenticatedUser, msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
    def requireAccess(rt: String, rid: String, uOpt: Option[AuthenticatedUser], msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
  }

  private def newService(
      dtRepo: DataTypeRepository,
      panelRepo: PanelRepository,
      metricRepo: MetricRepository
  ): PanelService =
    new PanelService(panelRepo, dtRepo, stubAccess, mock(classOf[DashboardRepository]), metricRepo)

  // ── POST /api/panels ─────────────────────────────────────────────────────

  "PanelService.create" should {

    "reject with 400 when metricId belongs to a different user (foreign)" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val metricRepo = mock(classOf[MetricRepository])
      when(metricRepo.findByIdOwned(foreignMetricId, user)).thenReturn(Future.successful(None))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Metric"),
        `type`      = Some(MetricPanel.Kind),
        config      = Some(JsObject("metricId" -> JsString(foreignMetricId.value)))
      )

      val result = await(newService(dtRepo, panelRepo, metricRepo).create(request, user))

      result shouldBe Left(ServiceError.BadRequest("metricId does not resolve to a metric you own"))
      verify(panelRepo, never()).insert(any[Panel])
    }

    "reject with 400 when metricId does not resolve to any metric" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val metricRepo = mock(classOf[MetricRepository])
      val nonexistentId = MetricId(UUID.randomUUID().toString)
      when(metricRepo.findByIdOwned(nonexistentId, user)).thenReturn(Future.successful(None))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Metric"),
        `type`      = Some(MetricPanel.Kind),
        config      = Some(JsObject("metricId" -> JsString(nonexistentId.value)))
      )

      val result = await(newService(dtRepo, panelRepo, metricRepo).create(request, user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
      verify(panelRepo, never()).insert(any[Panel])
    }

    "reject with 400 when metricId resolves to a metric bound to a non-pipeline-output DataType" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val metricRepo = mock(classOf[MetricRepository])
      when(metricRepo.findByIdOwned(ownedMetricId, user))
        .thenReturn(Future.successful(Some(metricDefinition(ownedMetricId, companionTypeId))))
      when(dtRepo.findByIdOwned(companionTypeId, user))
        .thenReturn(Future.successful(Some(companionDataType(companionTypeId))))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Metric"),
        `type`      = Some(MetricPanel.Kind),
        config      = Some(JsObject("metricId" -> JsString(ownedMetricId.value)))
      )

      val result = await(newService(dtRepo, panelRepo, metricRepo).create(request, user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
      verify(panelRepo, never()).insert(any[Panel])
    }

    "succeed when metricId resolves to a caller-owned, pipeline-output-backed metric" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val metricRepo = mock(classOf[MetricRepository])
      when(metricRepo.findByIdOwned(ownedMetricId, user))
        .thenReturn(Future.successful(Some(metricDefinition(ownedMetricId, outputTypeId))))
      when(dtRepo.findByIdOwned(outputTypeId, user))
        .thenReturn(Future.successful(Some(pipelineOutputDataType(outputTypeId))))
      when(panelRepo.insert(any[Panel])).thenAnswer(inv => Future.successful(inv.getArgument(0, classOf[Panel])))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Metric"),
        `type`      = Some(MetricPanel.Kind),
        config      = Some(JsObject("metricId" -> JsString(ownedMetricId.value)))
      )

      val result = await(newService(dtRepo, panelRepo, metricRepo).create(request, user))

      result.isRight shouldBe true
      verify(panelRepo, times(1)).insert(any[Panel])
    }

    "succeed without any metric lookup when no metricId is set" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val metricRepo = mock(classOf[MetricRepository])
      when(panelRepo.insert(any[Panel])).thenAnswer(inv => Future.successful(inv.getArgument(0, classOf[Panel])))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Metric"),
        `type`      = Some(MetricPanel.Kind),
        config      = None
      )

      val result = await(newService(dtRepo, panelRepo, metricRepo).create(request, user))

      result.isRight shouldBe true
      org.mockito.Mockito.verifyNoInteractions(metricRepo)
    }

    // ── Precedence (AC4): metricId + raw fields may both be set — accepted ──

    "succeed when both metricId and raw dataTypeId/fieldMapping are set together" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val metricRepo = mock(classOf[MetricRepository])
      when(metricRepo.findByIdOwned(ownedMetricId, user))
        .thenReturn(Future.successful(Some(metricDefinition(ownedMetricId, outputTypeId))))
      when(dtRepo.findByIdOwned(outputTypeId, user))
        .thenReturn(Future.successful(Some(pipelineOutputDataType(outputTypeId))))
      when(panelRepo.insert(any[Panel])).thenAnswer(inv => Future.successful(inv.getArgument(0, classOf[Panel])))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Metric"),
        `type`      = Some(MetricPanel.Kind),
        config      = Some(JsObject(
          "metricId"     -> JsString(ownedMetricId.value),
          "dataTypeId"   -> JsString(outputTypeId.value),
          "fieldMapping" -> JsObject("value" -> JsString("profit"))
        ))
      )

      val result = await(newService(dtRepo, panelRepo, metricRepo).create(request, user))

      result.isRight shouldBe true
      result.map(_.asInstanceOf[MetricPanel].config.fieldMapping) shouldBe
        Right(JsObject("value" -> JsString("profit")))
    }
  }

  // ── PATCH /api/panels/:id ────────────────────────────────────────────────

  "PanelService.update" should {

    def existingMetricPanel(): MetricPanel =
      MetricPanel(PanelId("p-1"), dashId, "Metric", meta, appearance, ownerId, MetricPanelConfig(outputTypeId, JsObject.empty))

    "reject with 400 when the PATCH re-binds to a foreign metricId" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val metricRepo = mock(classOf[MetricRepository])
      val existing  = existingMetricPanel()
      when(panelRepo.findByIdInternal(PanelId("p-1"))).thenReturn(Future.successful(Some(existing)))
      when(metricRepo.findByIdOwned(foreignMetricId, user)).thenReturn(Future.successful(None))

      val request = UpdatePanelRequest(
        title      = None,
        appearance = None,
        `type`     = None,
        config     = Some(JsObject("metricId" -> JsString(foreignMetricId.value)))
      )

      val result = await(newService(dtRepo, panelRepo, metricRepo).update(PanelId("p-1"), request, user))

      result shouldBe Left(ServiceError.BadRequest("metricId does not resolve to a metric you own"))
      verify(panelRepo, never()).replace(any[Panel], any[Instant])
    }

    "succeed when the PATCH explicitly unbinds metricId (null) without a metric lookup" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val metricRepo = mock(classOf[MetricRepository])
      val existing  = existingMetricPanel()
      val unbound   = existingMetricPanel()
      when(panelRepo.findByIdInternal(PanelId("p-1"))).thenReturn(Future.successful(Some(existing)))
      when(panelRepo.replace(any[Panel], any[Instant])).thenReturn(Future.successful(Some(unbound)))
      when(dtRepo.findByIdOwned(outputTypeId, user))
        .thenReturn(Future.successful(Some(pipelineOutputDataType(outputTypeId))))

      val request = UpdatePanelRequest(
        title      = None,
        appearance = None,
        `type`     = None,
        config     = Some(JsObject("metricId" -> JsNull))
      )

      val result = await(newService(dtRepo, panelRepo, metricRepo).update(PanelId("p-1"), request, user))

      result.isRight shouldBe true
      org.mockito.Mockito.verifyNoInteractions(metricRepo)
    }
  }
}
