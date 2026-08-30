package com.helio.services.panels


import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.panels.PanelService
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.domain.model._
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import org.mockito.Mockito.mock
import spray.json.{JsObject, JsString}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Unit coverage for `PanelService.buildAllForCreate` (HEL-370 design.md
 *  D2/D5) — the shared "validate every item before any write" recursion
 *  behind both `DashboardContentsService.buildPanels` (unlabeled, default
 *  `itemLabel`) and `PanelService.batchCreate` (labeled). Uses the same
 *  mocked-repository style as `PanelServiceCompanionBindingGuardSpec` so the
 *  helper is exercised without a database — every request here is a `text`
 *  panel (with or without a valid `type`), which never touches
 *  `dataTypeRepo`/`panelRepo`. */
class PanelServiceBuildAllForCreateSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val dashId  = DashboardId("d-1")
  private val ownerId = UserId(UUID.randomUUID().toString)
  private val user    = AuthenticatedUser(ownerId)

  private val stubAccess: AccessChecker = new AccessChecker {
    def requireOwnerOnly(rt: String, rid: String, u: AuthenticatedUser, msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
    def requireAccess(rt: String, rid: String, uOpt: Option[AuthenticatedUser], msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
  }

  private def newService(): PanelService =
    new PanelService(
      mock(classOf[PanelRepository]),
      mock(classOf[DataTypeRepository]),
      stubAccess,
      mock(classOf[DashboardRepository]),
      mock(classOf[MetricRepository])
    )

  private def validTextRequest(title: String): CreatePanelRequest =
    CreatePanelRequest(dashboardId = Some(dashId.value), title = Some(title), `type` = Some("text"), config = None)

  private def invalidTypeRequest(title: String): CreatePanelRequest =
    CreatePanelRequest(dashboardId = Some(dashId.value), title = Some(title), `type` = Some("bogus"), config = None)

  "PanelService.buildAllForCreate" should {

    "build every panel and return them in order when all requests are valid" in {
      val service  = newService()
      val requests = Vector(validTextRequest("One"), validTextRequest("Two"), validTextRequest("Three"))

      val result = await(service.buildAllForCreate(dashId, requests, user))

      result.isRight shouldBe true
      result.toOption.get.map(_.title) shouldBe Vector("One", "Two", "Three")
    }

    "pass a BadRequest error through UNLABELED when no itemLabel is supplied (default) — matches DashboardContentsService's usage" in {
      val service  = newService()
      val requests = Vector(validTextRequest("Good"), invalidTypeRequest("Bad"))

      val result = await(service.buildAllForCreate(dashId, requests, user))

      result.isLeft shouldBe true
      val err = result.swap.toOption.get
      err shouldBe a[ServiceError.BadRequest]
      err.message should include("Unknown panel type")
      err.message should not include "panel 2"
    }

    "prefix a BadRequest error with the supplied label when itemLabel is provided — matches batchCreate's usage" in {
      val service  = newService()
      val requests = Vector(validTextRequest("Good"), invalidTypeRequest("Bad"))
      val itemLabel: Int => Option[String] = idx => Some(s"panel ${idx + 1} ('${requests(idx).title.getOrElse("")}')")

      val result = await(service.buildAllForCreate(dashId, requests, user, itemLabel))

      result.isLeft shouldBe true
      val err = result.swap.toOption.get
      err shouldBe a[ServiceError.BadRequest]
      err.message should startWith("panel 2 ('Bad'): ")
      err.message should include("Unknown panel type")
    }

    "short-circuit on the first bad item — a later valid item never gets built" in {
      val service = newService()
      // If the recursion did NOT short-circuit, item 3 (also invalid, but with
      // a DIFFERENT type string) would surface as the failure instead of item 2 —
      // asserting the label names item 2 proves item 3 was never reached.
      val requests = Vector(validTextRequest("Good"), invalidTypeRequest("Bad"), invalidTypeRequest("AlsoBad"))
      val itemLabel: Int => Option[String] = idx => Some(s"panel ${idx + 1}")

      val result = await(service.buildAllForCreate(dashId, requests, user, itemLabel))

      result.isLeft shouldBe true
      result.swap.toOption.get.message should startWith("panel 2: ")
    }

    "build a real OutputPanel for type = \"output\" (HEL-904 task 3.6 write-path increment) — " +
      "the new write path this task adds, not just PanelType.fromString accepting the string" in {
      val service = newService()
      val request = CreatePanelRequest(
        dashboardId = Some(dashId.value),
        title       = Some("Revenue"),
        `type`      = Some("output"),
        config      = Some(JsObject("outputId" -> JsString("out-1")))
      )

      val result = await(service.buildAllForCreate(dashId, Vector(request), user))

      result.isRight shouldBe true
      val built = result.toOption.get.head
      built shouldBe a[OutputPanel]
      built.kind shouldBe "output"
      built.asInstanceOf[OutputPanel].outputId shouldBe Some(OutputId("out-1"))
    }
  }
}
