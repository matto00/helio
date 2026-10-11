package com.helio.api.routes.dashboards

import com.helio.api.routes.LayoutRouteFixtures
import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.nio.file.{Files, Paths}

/** Server half of the ghost-write seam (HEL-1456). The client half (`layoutGhostWriteSeam.test.ts`) proves the
 *  PATCH body `buildLayoutPatch` builds from a ghost-bearing store layout; this spec PATCHes that same body, from the
 *  same shared fixture, to the real route over a stored layout holding the ghost, and checks the ghost-free
 *  response and stored layout. sbt runs with cwd `backend/`. */
class DashboardLayoutGhostSeamSpec extends ApplyProposalSpecBase with LayoutRouteFixtures {

  private val fixture: JsObject = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/layout-ghost-write-seam.json"))).asJsObject

  private def remap(v: JsValue, ids: Map[String, String]): JsValue = v match {
    case JsObject(fs) => JsObject(fs.map {
      case ("panelId", JsString(p)) => "panelId" -> JsString(ids.getOrElse(p, p))
      case (k, x)                   => k -> remap(x, ids)
    })
    case JsArray(xs) => JsArray(xs.map(remap(_, ids)))
    case other       => other
  }

  "the ghost-write seam fixture" should {
    "yield a ghost-free response and stored layout when its client PATCH body is sent over its stored layout" in {
      val dashboardId = seedDashboardWithLayout("ghost-seam", userId, """{"lg":[],"md":[],"sm":[],"xs":[]}""")
      val ids         = fixture.fields("panels").convertTo[Vector[String]].map(p => p -> createPanel(dashboardId, "divider")).toMap
      overwriteStoredLayout(dashboardId, remap(fixture.fields("stored"), ids).compactPrint)
      val expected = remap(fixture.fields("expectedStored"), ids)

      Patch(s"/api/dashboards/$dashboardId", json(s"""{"layout":${remap(fixture.fields("patch"), ids).compactPrint}}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("layout") shouldBe expected
      }
      storedLayoutJson(dashboardId) shouldBe expected
    }
  }
}
