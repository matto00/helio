package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1203: pins that `ApiRoutes` hands its `OutputControlsValidator` to BOTH
 *  `DashboardProposalService` and `DashboardContentsService`. Both constructor parameters default to
 *  `null`, which skips propose-time validation without any error, so dropping the wiring is otherwise
 *  invisible. A real `DbContext` is required: with none, `ApiRoutes` builds the validator over a null
 *  `outputRepo` and `reject` returns `Right` — indistinguishable from the null-validator case.
 *
 *  The assertion is the exact `panel 'Sales': ` prefixed message: only the propose-time pre-validation
 *  adds that prefix. The later create-time check (`PanelService`, which runs its own validator) returns
 *  the same eligibility text WITHOUT it, so a bare 400 would still pass with the wiring removed. */
class OutputControlsValidatorWiringSpec extends ApplyProposalSpecBase {

  private val expected = JsString("panel 'Sales': control not eligible: column 'region', kind 'date-range'")

  // A def: `pipelineOutputId` is assigned in beforeAll, after this class is constructed.
  private def panel =
    s""""title":"Sales","type":"output","outputId":"$pipelineOutputId","controls":[{"kind":"date-range","column":"region"}]"""

  private def message: JsValue = responseAs[String].parseJson.asJsObject.fields("message")

  "ApiRoutes" should {
    "wire the controls validator into DashboardProposalService (propose-time rejection, nothing created)" in {
      val before = dashboardCount()
      apply(s"""{"dashboardName":"Wiring","panels":[{$panel}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message shouldBe expected
      }
      dashboardCount() shouldBe before
    }

    "wire the controls validator into DashboardContentsService (PUT contents rejection, panels unchanged)" in {
      val dashboardId =
        Post("/api/dashboards", json("""{"name":"Wiring Contents"}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
          status shouldBe StatusCodes.Created
          responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
        }
      Put(s"/api/dashboards/$dashboardId/contents", json(s"""{"panels":[{$panel}]}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message shouldBe expected
      }
      panelTitlesForDashboard(dashboardId) shouldBe empty
    }
  }
}
