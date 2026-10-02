package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.nio.file.{Files, Paths}

/** HEL-1148 seam test: the SAME wire fixture helio-mcp's `formProposalSeam.test.ts` proves the MCP
 *  handler serializes byte-for-byte (`shared-test-fixtures/form-proposal.json`) is posted verbatim
 *  to the real `POST /api/dashboards/apply-proposal` route, applied, and the resulting form
 *  accepts a submit that lands in the dataset. Client and server can each pass their own gates
 *  while disagreeing on the wire; sharing the fixture is what pins them together. */
class DashboardApplyProposalFormSeamSpec extends ApplyProposalSpecBase {

  private val fixture      = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/form-proposal.json"))).asJsObject
  private val placeholder  = fixture.fields("datasetSourcePlaceholder").convertTo[String]

  "the shared form-proposal wire fixture" should {

    "apply through the real route, bind the form to its source, and accept its submit" in {
      val body = fixture.fields("proposal").compactPrint.replace(placeholder, datasetSourceId)
      val rowsBefore = datasetRowCount(datasetSourceId)
      val panelId = apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val panel = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsValue]].head.asJsObject
        panel.fields("config").asJsObject.fields("dataSourceId") shouldBe JsString(datasetSourceId)
        panel.fields("id").convertTo[String]
      }
      val submitBody = fixture.fields("submit").compactPrint
      Post(s"/api/panels/$panelId/submit", json(submitBody)).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
      }
      datasetRowCount(datasetSourceId) shouldBe (rowsBefore + 1)
    }
  }
}
