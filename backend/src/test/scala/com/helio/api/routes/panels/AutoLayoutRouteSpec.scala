package com.helio.api.routes.panels

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.UUID

/** Route-level coverage for `POST /api/dashboards/:id/auto-layout` (HEL-367,
 *  task 4.3). Shares the fixture (real RLS, seeded users) via
 *  `ApplyProposalSpecBase`, same as `DashboardContentsReplaceSpec`. */
class AutoLayoutRouteSpec extends ApplyProposalSpecBase {

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def createPanel(dashboardId: String, title: String, panelType: String): String =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"$title","type":"$panelType"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def patchLayout(dashboardId: String, item: String): Unit =
    Patch(s"/api/dashboards/$dashboardId", json(s"""{"layout":{"lg":[$item],"md":[$item],"sm":[$item],"xs":[$item]}}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.OK
    }

  private def autoLayout(dashboardId: String, body: String) =
    Post(s"/api/dashboards/$dashboardId/auto-layout", json(body))
      .addHeader(sessionCookie).addHeader(csrfHeader)

  private def storedLg(dashboardId: String): Vector[JsValue] =
    Get(s"/api/dashboards/$dashboardId/export").addHeader(sessionCookie) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject
        .fields("dashboard").asJsObject
        .fields("layout").asJsObject
        .fields("lg").convertTo[Vector[JsValue]]
    }

  "POST /api/dashboards/:id/auto-layout" should {

    "pack supplied panels into non-overlapping positions, persisted identically to lg/md/sm/xs" in {
      val dashboardId = createDashboard("Auto Layout Target")
      val p1 = createPanel(dashboardId, "Chart 1", "divider")
      val p2 = createPanel(dashboardId, "Chart 2", "divider")

      // w=6 + w=8 > 12 -> p2 wraps to a new shelf below p1.
      autoLayout(dashboardId, s"""{"items":[{"panelId":"$p1","w":6,"h":8},{"panelId":"$p2","w":8,"h":8}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val layout = responseAs[String].parseJson.asJsObject.fields("layout").asJsObject
        val lg = layout.fields("lg").convertTo[Vector[JsValue]]
        lg should have size 2
        layout.fields("md") shouldBe layout.fields("lg")
        layout.fields("sm") shouldBe layout.fields("lg")
        layout.fields("xs") shouldBe layout.fields("lg")

        val byId = lg.map(_.asJsObject).map(o => o.fields("panelId").convertTo[String] -> o).toMap
        byId(p1).fields("y").convertTo[Int] shouldBe 0
        byId(p2).fields("y").convertTo[Int] should be > 0
      }
    }

    "returns 400 for a panelId not on the dashboard, no persistence" in {
      val dashboardId = createDashboard("Unknown Panel Target")
      val p1 = createPanel(dashboardId, "Chart 1", "divider")
      val fakeId = UUID.randomUUID().toString

      autoLayout(dashboardId, s"""{"items":[{"panelId":"$p1","w":6,"h":8},{"panelId":"$fakeId","w":4,"h":4}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }

      storedLg(dashboardId) shouldBe empty
    }

    "keeps an omitted panel's saved position unchanged and appends the newly packed panel" in {
      val dashboardId = createDashboard("Omit Target")
      val kept = createPanel(dashboardId, "Kept", "text")
      val packed = createPanel(dashboardId, "Packed", "divider")

      patchLayout(dashboardId, s"""{"panelId":"$kept","x":0,"y":0,"w":2,"h":2}""")

      autoLayout(dashboardId, s"""{"items":[{"panelId":"$packed","w":6,"h":8}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val lg = responseAs[String].parseJson.asJsObject.fields("layout").asJsObject.fields("lg").convertTo[Vector[JsValue]]
        val byId = lg.map(_.asJsObject).map(o => o.fields("panelId").convertTo[String] -> o).toMap

        byId(kept).fields("x").convertTo[Int] shouldBe 0
        byId(kept).fields("y").convertTo[Int] shouldBe 0
        byId(kept).fields("w").convertTo[Int] shouldBe 2
        byId(kept).fields("h").convertTo[Int] shouldBe 2

        byId(packed).fields("x").convertTo[Int] shouldBe 0
        byId(packed).fields("y").convertTo[Int] shouldBe 0
      }
    }

    "returns an empty result unchanged for empty items on a dashboard with no panels" in {
      val dashboardId = createDashboard("Empty Target")
      autoLayout(dashboardId, """{"items":[]}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val lg = responseAs[String].parseJson.asJsObject.fields("layout").asJsObject.fields("lg").convertTo[Vector[JsValue]]
        lg shouldBe empty
      }
    }

    "returns 404 for a dashboard owned by another user with no grant" in {
      val otherDashboardId = seedDashboardForOwner("Other Owner's Dashboard", otherId)
      autoLayout(otherDashboardId, """{"items":[]}""") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "allows an editor grantee to auto-layout" in {
      val dashboardId = seedDashboardForOwner("Editor Grantee Target", otherId)
      grantRole(dashboardId, userId, "editor")
      autoLayout(dashboardId, """{"items":[]}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "forbids a viewer grantee from auto-layout" in {
      val dashboardId = seedDashboardForOwner("Viewer Grantee Target", otherId)
      grantRole(dashboardId, userId, "viewer")
      autoLayout(dashboardId, """{"items":[]}""") ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    "require authentication" in {
      Post(s"/api/dashboards/${UUID.randomUUID()}/auto-layout", json("""{"items":[]}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }
}
