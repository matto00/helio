package com.helio.services

import com.helio.api.protocols.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.domain._
import com.helio.domain.panels._
import com.helio.infrastructure.{DataTypeRepository, PanelRepository}
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, never, times, verify, verifyNoInteractions, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsNull, JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Unit tests for the enforce-pipeline-only-bindings backend guard (task
 *  1.2 / design D2): `POST /api/panels` and `PATCH /api/panels/:id` must
 *  reject a `dataTypeId` that resolves to a companion DataType
 *  (`sourceId` defined) with 400, while pipeline-output types and
 *  unbinding continue to succeed.
 *
 *  Uses the same mocked-repository style as `PanelServiceResolveBindingsSpec`
 *  so the guard is exercised without a database. */
class PanelServiceCompanionBindingGuardSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now        = Instant.parse("2026-01-01T00:00:00Z")
  private val dashId     = DashboardId("d-1")
  private val meta       = ResourceMeta("u", now, now)
  private val ownerId    = UserId(UUID.randomUUID().toString)
  private val user       = AuthenticatedUser(ownerId)
  private val appearance = PanelAppearance.Default

  private val companionTypeId = DataTypeId(UUID.randomUUID().toString)
  private val outputTypeId    = DataTypeId(UUID.randomUUID().toString)

  private def companionDataType(id: DataTypeId): DataType =
    DataType(id, Some(DataSourceId(UUID.randomUUID().toString)), "Companion", Vector.empty, Vector.empty, 1, now, now, ownerId)

  private def pipelineOutputDataType(id: DataTypeId): DataType =
    DataType(id, None, "Output", Vector.empty, Vector.empty, 1, now, now, ownerId)

  private val stubAccess: AccessChecker = new AccessChecker {
    def requireOwnerOnly(rt: String, rid: String, u: AuthenticatedUser, msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
    def requireAccess(rt: String, rid: String, uOpt: Option[AuthenticatedUser], msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
  }

  private def newService(dtRepo: DataTypeRepository, panelRepo: PanelRepository): PanelService =
    new PanelService(panelRepo, dtRepo, stubAccess)

  // ── POST /api/panels ─────────────────────────────────────────────────────

  "PanelService.create" should {

    "reject with 400 when dataTypeId resolves to a companion DataType" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      when(dtRepo.findByIdOwned(companionTypeId, user))
        .thenReturn(Future.successful(Some(companionDataType(companionTypeId))))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Metric"),
        `type`      = Some(MetricPanel.Kind),
        config      = Some(JsObject("dataTypeId" -> JsString(companionTypeId.value)))
      )

      val result = await(newService(dtRepo, panelRepo).create(request, user))

      result shouldBe Left(ServiceError.BadRequest("Panels can only bind to pipeline-output data types"))
      verify(panelRepo, never()).insert(any[Panel])
    }

    "succeed when dataTypeId resolves to a pipeline-output DataType" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      when(dtRepo.findByIdOwned(outputTypeId, user))
        .thenReturn(Future.successful(Some(pipelineOutputDataType(outputTypeId))))
      when(panelRepo.insert(any[Panel])).thenAnswer(inv => Future.successful(inv.getArgument(0, classOf[Panel])))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Metric"),
        `type`      = Some(MetricPanel.Kind),
        config      = Some(JsObject("dataTypeId" -> JsString(outputTypeId.value)))
      )

      val result = await(newService(dtRepo, panelRepo).create(request, user))

      result.isRight shouldBe true
      result.map(_.dataTypeId) shouldBe Right(Some(outputTypeId))
      verify(panelRepo, times(1)).insert(any[Panel])
    }

    "succeed without any DataType lookup when no dataTypeId is set" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      when(panelRepo.insert(any[Panel])).thenAnswer(inv => Future.successful(inv.getArgument(0, classOf[Panel])))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Text"),
        `type`      = Some(TextPanel.Kind),
        config      = None
      )

      val result = await(newService(dtRepo, panelRepo).create(request, user))

      result.isRight shouldBe true
      verifyNoInteractions(dtRepo)
    }

    // ── HEL-316 round-2 (skeptic-refuted V41 gap): text/markdown panels have
    // no flat `dataTypeId` field — their binding lives ONLY inside `config`
    // (HEL-244) — so `dataTypeIdFromCreateConfig` previously fell through to
    // `case _ => None` for them and `rejectCompanionBinding` never saw their
    // binding target at all. Fixed by extending `dataTypeIdFromCreateConfig`
    // to cover `TextCreate`/`MarkdownCreate`; these mirror the metric
    // companion-binding tests above but for a text panel, proving the guard
    // now covers every panel type on every `PanelService.create` caller
    // (direct POST /api/panels, create_panel, AND apply_proposal).

    "reject with 400 when a TEXT panel's config.dataTypeId resolves to a companion DataType" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      when(dtRepo.findByIdOwned(companionTypeId, user))
        .thenReturn(Future.successful(Some(companionDataType(companionTypeId))))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Rogue Text"),
        `type`      = Some(TextPanel.Kind),
        config      = Some(JsObject("dataTypeId" -> JsString(companionTypeId.value)))
      )

      val result = await(newService(dtRepo, panelRepo).create(request, user))

      result shouldBe Left(ServiceError.BadRequest("Panels can only bind to pipeline-output data types"))
      verify(panelRepo, never()).insert(any[Panel])
    }

    "succeed when a TEXT panel's config.dataTypeId resolves to a pipeline-output DataType" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      when(dtRepo.findByIdOwned(outputTypeId, user))
        .thenReturn(Future.successful(Some(pipelineOutputDataType(outputTypeId))))
      when(panelRepo.insert(any[Panel])).thenAnswer(inv => Future.successful(inv.getArgument(0, classOf[Panel])))

      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Bound Text"),
        `type`      = Some(TextPanel.Kind),
        config      = Some(JsObject("dataTypeId" -> JsString(outputTypeId.value)))
      )

      val result = await(newService(dtRepo, panelRepo).create(request, user))

      result.isRight shouldBe true
      result.map(_.dataTypeId) shouldBe Right(Some(outputTypeId))
      verify(panelRepo, times(1)).insert(any[Panel])
    }
  }

  // ── PATCH /api/panels/:id ────────────────────────────────────────────────

  "PanelService.update" should {

    def existingMetricPanel(typeId: DataTypeId): MetricPanel =
      MetricPanel(PanelId("p-1"), dashId, "Metric", meta, appearance, ownerId, MetricPanelConfig(typeId, JsObject.empty))

    "reject with 400 when the PATCH re-binds to a companion DataType" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val existing  = existingMetricPanel(outputTypeId)
      when(panelRepo.findByIdInternal(PanelId("p-1"))).thenReturn(Future.successful(Some(existing)))
      when(dtRepo.findByIdOwned(companionTypeId, user))
        .thenReturn(Future.successful(Some(companionDataType(companionTypeId))))

      val request = UpdatePanelRequest(
        title      = None,
        appearance = None,
        `type`     = None,
        config     = Some(JsObject("dataTypeId" -> JsString(companionTypeId.value)))
      )

      val result = await(newService(dtRepo, panelRepo).update(PanelId("p-1"), request, user))

      result shouldBe Left(ServiceError.BadRequest("Panels can only bind to pipeline-output data types"))
      verify(panelRepo, never()).replace(any[Panel], any[Instant])
    }

    "succeed when the PATCH re-binds to a pipeline-output DataType" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val existing  = existingMetricPanel(DataTypeId(""))
      val rebound   = existingMetricPanel(outputTypeId)
      when(panelRepo.findByIdInternal(PanelId("p-1"))).thenReturn(Future.successful(Some(existing)))
      when(dtRepo.findByIdOwned(outputTypeId, user))
        .thenReturn(Future.successful(Some(pipelineOutputDataType(outputTypeId))))
      when(panelRepo.replace(any[Panel], any[Instant])).thenReturn(Future.successful(Some(rebound)))

      val request = UpdatePanelRequest(
        title      = None,
        appearance = None,
        `type`     = None,
        config     = Some(JsObject("dataTypeId" -> JsString(outputTypeId.value)))
      )

      val result = await(newService(dtRepo, panelRepo).update(PanelId("p-1"), request, user))

      result.isRight shouldBe true
      result.map(_.dataTypeId) shouldBe Right(Some(outputTypeId))
    }

    "succeed when the PATCH explicitly unbinds (dataTypeId: null) without a DataType lookup" in {
      val dtRepo     = mock(classOf[DataTypeRepository])
      val panelRepo  = mock(classOf[PanelRepository])
      val existing   = existingMetricPanel(outputTypeId)
      val unbound    = existingMetricPanel(DataTypeId(""))
      when(panelRepo.findByIdInternal(PanelId("p-1"))).thenReturn(Future.successful(Some(existing)))
      when(panelRepo.replace(any[Panel], any[Instant])).thenReturn(Future.successful(Some(unbound)))

      val request = UpdatePanelRequest(
        title      = None,
        appearance = None,
        `type`     = None,
        config     = Some(JsObject("dataTypeId" -> JsNull))
      )

      val result = await(newService(dtRepo, panelRepo).update(PanelId("p-1"), request, user))

      result.isRight shouldBe true
      result.map(_.dataTypeId) shouldBe Right(None)
      verifyNoInteractions(dtRepo)
    }
  }
}
