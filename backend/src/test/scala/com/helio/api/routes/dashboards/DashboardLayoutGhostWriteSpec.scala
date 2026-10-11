package com.helio.api.routes.dashboards

import com.helio.api.routes.LayoutRouteFixtures
import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.{HttpRequest, StatusCodes}
import spray.json._

/** HEL-1456 D5: a dashboard layout update never stores an item for a panel that is not on the dashboard,
 *  whatever the client sends and whatever the stored layout still holds. Ghosts are seeded by SQL (V122 stops
 *  new ones being created by a delete, so only SQL can plant one). Both layout PATCH routes are exercised. */
class DashboardLayoutGhostWriteSpec extends ApplyProposalSpecBase with LayoutRouteFixtures {

  private val ghost = "00000000-0000-0000-0000-00000000dead"

  private def item(id: String, x: Int, y: Int, w: Int = 2, h: Int = 2): JsObject =
    JsObject("panelId" -> JsString(id), "x" -> JsNumber(x), "y" -> JsNumber(y), "w" -> JsNumber(w), "h" -> JsNumber(h))

  private def layoutJson(perBp: Map[String, Vector[JsObject]]): JsObject =
    JsObject(Bps.map(bp => bp -> JsArray(perBp.getOrElse(bp, Vector.empty))).toMap)

  private val routesUnderTest: Seq[(String, (String, String) => HttpRequest)] = Seq(
    "PATCH /api/dashboards/:id" -> { (id: String, body: String) =>
      Patch(s"/api/dashboards/$id", json(body)).addHeader(sessionCookie).addHeader(csrfHeader)
    },
    "PATCH /api/dashboards/:id/update" -> { (id: String, body: String) =>
      val fields = body.parseJson.asJsObject.fields.keys.map(k => s""""$k"""").mkString(",")
      Patch(s"/api/dashboards/$id/update", json(s"""{"fields":[$fields],"dashboard":$body}""")).addHeader(sessionCookie).addHeader(csrfHeader)
    }
  )

  private def ids(layout: JsObject, bp: String): Vector[String] =
    layout.fields(bp).convertTo[Vector[JsObject]].map(_.fields("panelId").convertTo[String])

  /** A dashboard with live panels `a`, `b` and a stored layout holding both plus the ghost in every breakpoint. */
  private def ghostBearingDashboard(name: String): (String, String, String) = {
    val d = createDashboard(name)
    val Vector(a, b) = Vector.fill(2)(createPanel(d, "divider"))
    overwriteStoredLayout(d, layoutJson(Bps.map(bp => bp -> Vector(item(a, 0, 0), item(b, 2, 0), item(ghost, 4, 0))).toMap).compactPrint)
    (d, a, b)
  }

  routesUnderTest.foreach { case (routeName, build) =>
    s"$routeName" should {
      "store no item for a deleted panel that the client sends back in a supplied breakpoint" in {
        val (d, a, b) = ghostBearingDashboard("ghost-supplied-" + routeName.hashCode)
        val sent      = Vector(item(a, 0, 2), item(b, 2, 0), item(ghost, 4, 0))
        build(d, s"""{"layout":{"lg":${JsArray(sent).compactPrint}}}""") ~> routes ~> check {
          status shouldBe StatusCodes.OK
          val layout = responseAs[String].parseJson.asJsObject.fields("layout").asJsObject
          layout.fields("lg") shouldBe JsArray(item(a, 0, 2), item(b, 2, 0))
        }
        storedLayoutJson(d).fields("lg") shouldBe JsArray(item(a, 0, 2), item(b, 2, 0))
      }

      "write a ghost back ghost-free in a breakpoint the patch does not send" in {
        val (d, a, b) = ghostBearingDashboard("ghost-unsent-" + routeName.hashCode)
        build(d, s"""{"layout":{"lg":${JsArray(Vector(item(a, 0, 2), item(b, 2, 0))).compactPrint}}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
        val stored = storedLayoutJson(d)
        Seq("md", "sm", "xs").foreach(bp => ids(stored, bp) shouldBe Vector(a, b))
        Bps.foreach(bp => ids(stored, bp) should not contain ghost)
      }

      "accept a write that places a live panel over the ghost's cells instead of rejecting the overlap" in {
        val (d, a, b) = ghostBearingDashboard("ghost-overlap-" + routeName.hashCode)
        build(d, s"""{"layout":{"lg":${JsArray(Vector(item(a, 0, 0), item(b, 4, 0))).compactPrint}}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
        storedLayoutJson(d).fields("lg") shouldBe JsArray(item(a, 0, 0), item(b, 4, 0))
      }

      "still reject a genuinely overlapping write between live panels" in {
        val (d, a, b) = ghostBearingDashboard("ghost-live-overlap-" + routeName.hashCode)
        build(d, s"""{"layout":{"lg":${JsArray(Vector(item(a, 0, 0), item(b, 1, 0))).compactPrint}}}""") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      }

      "keep the item of a panel created by another user on the dashboard" in {
        val d     = createDashboard("ghost-other-owner-" + routeName.hashCode)
        val mine  = createPanel(d, "divider")
        val theirs = createPanel(d, "divider")
        setPanelOwner(theirs, otherId)
        overwriteStoredLayout(d, layoutJson(Bps.map(bp => bp -> Vector(item(mine, 0, 0), item(theirs, 2, 0), item(ghost, 4, 0))).toMap).compactPrint)
        build(d, s"""{"layout":{"lg":${JsArray(Vector(item(mine, 0, 2), item(theirs, 2, 0))).compactPrint}}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
        Bps.foreach(bp => ids(storedLayoutJson(d), bp) should contain (theirs))
        Bps.foreach(bp => ids(storedLayoutJson(d), bp) should not contain ghost)
      }

      "store no ghost on an appearance-only update" in {
        val (d, _, _) = ghostBearingDashboard("ghost-appearance-" + routeName.hashCode)
        build(d, """{"appearance":{"background":"#112233","gridBackground":"transparent"}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
        Bps.foreach(bp => ids(storedLayoutJson(d), bp) should not contain ghost)
      }

      "store no ghost on a rename combined with an appearance change" in {
        val (d, _, _) = ghostBearingDashboard("ghost-rename-" + routeName.hashCode)
        build(d, """{"name":"renamed-ghost-free","appearance":{"background":"#112233","gridBackground":"transparent"}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
        Bps.foreach(bp => ids(storedLayoutJson(d), bp) should not contain ghost)
      }
    }
  }
}
