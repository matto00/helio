package com.helio.services

import com.helio.domain._
import com.helio.domain.panels._
import com.helio.infrastructure.{DataTypeRepository, PanelRepository}
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, times, verify, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.JsObject

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Unit tests for PanelService.resolveBindingsForRead.
 *
 *  Verifies that the batch path issues a single findByIdsOwned call
 *  regardless of the number of typed panels, and that panels whose
 *  typeId resolves to a different owner are cleared correctly. */
class PanelServiceResolveBindingsSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now       = Instant.parse("2026-01-01T00:00:00Z")
  private val dashId    = DashboardId("d-1")
  private val meta      = ResourceMeta("u", now, now)
  private val ownerId   = UserId(UUID.randomUUID().toString)
  private val user      = AuthenticatedUser(ownerId)
  private val appearance = PanelAppearance.Default

  private def metricPanel(id: String, typeId: DataTypeId): MetricPanel =
    MetricPanel(PanelId(id), dashId, "t", meta, appearance, ownerId,
      MetricPanelConfig(typeId, JsObject.empty))

  private def textPanel(id: String): TextPanel =
    TextPanel(PanelId(id), dashId, "t", meta, appearance, ownerId, TextPanelConfig.Empty)

  private def makeDataType(id: DataTypeId): DataType =
    DataType(id, None, "T", Vector.empty, Vector.empty, 1, now, now, ownerId)

  private val stubAccess: AccessChecker = new AccessChecker {
    def requireOwnerOnly(rt: String, rid: String, u: AuthenticatedUser, msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
    def requireAccess(rt: String, rid: String, uOpt: Option[AuthenticatedUser], msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
  }

  "PanelService.resolveBindingsForRead" should {

    "issue exactly one findByIdsOwned call for multiple typed panels" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val service   = new PanelService(panelRepo, dtRepo, stubAccess)

      val typeId1 = DataTypeId(UUID.randomUUID().toString)
      val typeId2 = DataTypeId(UUID.randomUUID().toString)

      val dt1 = makeDataType(typeId1)
      when(dtRepo.findByIdsOwned(any[Seq[DataTypeId]], any[AuthenticatedUser]))
        .thenReturn(Future.successful(Map(typeId1 -> dt1)))

      val panels = Vector(
        metricPanel("p-1", typeId1),
        metricPanel("p-2", typeId2),
        textPanel("p-3")
      )

      val result = await(service.resolveBindingsForRead(panels, Some(user)))

      verify(dtRepo, times(1)).findByIdsOwned(any[Seq[DataTypeId]], any[AuthenticatedUser])
      result(0).dataTypeId shouldBe Some(typeId1)
      result(1).dataTypeId shouldBe None
      result(2).isInstanceOf[TextPanel] shouldBe true
    }

    "short-circuit without any DB call when no panels carry a typeId" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val service   = new PanelService(panelRepo, dtRepo, stubAccess)

      val panels = Vector(textPanel("p-1"), textPanel("p-2"))
      val result = await(service.resolveBindingsForRead(panels, Some(user)))

      verify(dtRepo, times(0)).findByIdsOwned(any[Seq[DataTypeId]], any[AuthenticatedUser])
      result shouldBe panels
    }

    "clear all bindings and skip DB call for anonymous callers" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val service   = new PanelService(panelRepo, dtRepo, stubAccess)

      val typeId = DataTypeId(UUID.randomUUID().toString)
      val panels = Vector(metricPanel("p-1", typeId), textPanel("p-2"))

      val result = await(service.resolveBindingsForRead(panels, None))

      verify(dtRepo, times(0)).findByIdsOwned(any[Seq[DataTypeId]], any[AuthenticatedUser])
      result(0).dataTypeId shouldBe None
      result(1).isInstanceOf[TextPanel] shouldBe true
    }
  }
}
