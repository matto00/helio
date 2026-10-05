package com.helio.api.routes.dashboards

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.{HttpRequest, StatusCodes}
import spray.json._

/** HEL-1233 route coverage of `POST /api/dashboards/:id/layout/repair`. The base spec runs the whole
 *  route tree over an RLS-enforced (non-BYPASSRLS `helio_app_test`) app pool, so every owner-success
 *  case here is also the end-to-end owner repair under RLS. Stored-bad layouts are seeded by raw SQL,
 *  never through a validating HTTP path. */
class DashboardLayoutRepairRoutesSpec extends ApplyProposalSpecBase {

  private def item(id: String, x: Int, y: Int, w: Int = 1, h: Int = 2): String =
    s"""{"panelId":"$id","x":$x,"y":$y,"w":$w,"h":$h}"""
  private def arr(items: String*): String = items.mkString("[", ",", "]")
  private def message: String = responseAs[String].parseJson.asJsObject.fields("message").convertTo[String]

  private def repair(id: String, body: String): HttpRequest =
    Post(s"/api/dashboards/$id/layout/repair", json(body)).addHeader(sessionCookie).addHeader(csrfHeader)

  private def createDivider(dashboardId: String, title: String): String =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"$title","type":"divider"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  /** An owned dashboard with two real panels whose stored layout is `layoutOf(p1, p2)` (raw SQL). */
  private def seedWithTwoPanels(name: String)(layoutOf: (String, String) => String): (String, String, String) = {
    val id = seedDashboardWithLayout(name, userId, """{"lg":[],"md":[],"sm":[],"xs":[]}""")
    val p1 = createDivider(id, "One")
    val p2 = createDivider(id, "Two")
    overwriteStoredLayout(id, layoutOf(p1, p2))
    (id, p1, p2)
  }

  private def badXs(p1: String, p2: String): String =
    s"""{"lg":${arr(item(p1, 0, 0, 6), item(p2, 6, 0, 6))},"md":[],"sm":[],"xs":${arr(item(p1, 0, 0), item(p2, 0, 0))}}"""

  private def xsOf(id: String): Vector[JsValue] = storedLayoutJson(id).fields("xs").convertTo[Vector[JsValue]]

  private def xsOfBp(id: String, bp: String): Vector[JsValue] = storedLayoutJson(id).fields(bp).convertTo[Vector[JsValue]]

  private def dashboardJson(id: String): JsObject =
    Get("/api/dashboards").addHeader(sessionCookie) ~> routes ~> check {
      responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]].find(_.fields("id") == JsString(id)).get
    }

  "POST /api/dashboards/:id/layout/repair" should {

    "store the owner's repaired xs, leaving every other breakpoint, the name and lastUpdated untouched" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-owner")(badXs)
      val before       = storedLayoutJson(id)
      val metaBefore   = dashboardJson(id).fields("meta")
      repair(id, s"""{"xs":${arr(item(p1, 0, 0), item(p2, 0, 2))}}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("name") shouldBe JsString("repair-owner")
      }
      val after = storedLayoutJson(id)
      after.fields("xs").convertTo[Vector[JsValue]].map(_.asJsObject.fields("y")) shouldBe Vector(JsNumber(0), JsNumber(2))
      after.fields("lg") shouldBe before.fields("lg")
      after.fields("md") shouldBe before.fields("md")
      dashboardJson(id).fields("meta") shouldBe metaBefore
    }

    "ignore a replacement for a breakpoint whose stored value is already valid" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-valid-ignored")(badXs)
      val before       = storedLayoutJson(id)
      repair(id, s"""{"lg":${arr(item(p1, 0, 8, 6), item(p2, 6, 8, 6))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      storedLayoutJson(id) shouldBe before
    }

    "be a no-op the second time: a different valid xs no longer overwrites the repaired one" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-twice")(badXs)
      repair(id, s"""{"xs":${arr(item(p1, 0, 0), item(p2, 0, 2))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val afterFirst = storedLayoutJson(id)
      repair(id, s"""{"xs":${arr(item(p1, 0, 6), item(p2, 0, 9))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      storedLayoutJson(id) shouldBe afterFirst
    }

    "match the compare-and-set for a stored layout seeded with reordered keys and extra whitespace" in {
      val id = seedDashboardWithLayout("repair-keyorder", userId, """{"lg":[],"md":[],"sm":[],"xs":[]}""")
      val p1 = createDivider(id, "One")
      val p2 = createDivider(id, "Two")
      overwriteStoredLayout(
        id,
        s"""{ "xs" : [ {"h":2, "w":1, "y":0, "x":0, "panelId":"$p1"}, {"h":2,"w":1,"y":0,"x":0,"panelId":"$p2"} ],
           |  "sm":[], "md" : [], "lg":[] }""".stripMargin
      )
      repair(id, s"""{"xs":${arr(item(p1, 0, 0), item(p2, 1, 0))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      xsOf(id).map(_.asJsObject.fields("x")) shouldBe Vector(JsNumber(0), JsNumber(1))
    }

    "allow dropping the entry of a deleted panel" in {
      val (id, p1, _) = seedWithTwoPanels("repair-stale")((p1, _) =>
        s"""{"lg":[],"md":[],"sm":[],"xs":${arr(item(p1, 0, 0), item("deleted-panel", 0, 0))}}"""
      )
      repair(id, s"""{"xs":${arr(item(p1, 0, 0))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      xsOf(id).map(_.asJsObject.fields("panelId")) shouldBe Vector(JsString(p1))
    }

    "allow adding a live panel that had no stored item" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-add")((p1, _) =>
        s"""{"lg":[],"md":[],"sm":[],"xs":${arr(item(p1, 0, 0), item("deleted-panel", 0, 0))}}"""
      )
      repair(id, s"""{"xs":${arr(item(p1, 0, 0), item(p2, 0, 2))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      xsOf(id).map(_.asJsObject.fields("panelId")) shouldBe Vector(JsString(p1), JsString(p2))
    }

    "reject a replacement that drops a live panel, naming the breakpoint, and store nothing" in {
      val (id, p1, _) = seedWithTwoPanels("repair-drop-live")(badXs)
      val before      = storedLayoutJson(id)
      repair(id, s"""{"xs":${arr(item(p1, 0, 0))}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message should include("breakpoint 'xs'")
        message should include("drop")
      }
      storedLayoutJson(id) shouldBe before
    }

    "reject an invalid, duplicated or foreign-panel replacement" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-invalid")(badXs)
      val before       = storedLayoutJson(id)
      repair(id, s"""{"xs":${arr(item(p1, 0, 0), item(p2, 0, 0))}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message should include("overlap")
      }
      repair(id, s"""{"xs":${arr(item(p1, 0, 0), item(p1, 0, 2), item(p2, 0, 4))}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message should include("more than once")
      }
      repair(id, s"""{"xs":${arr(item(p1, 0, 0), item(p2, 0, 2), item("not-a-panel-here", 0, 4))}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message should include("unknown panels")
      }
      storedLayoutJson(id) shouldBe before
    }

    "refuse an editor grantee with 403 and a viewer grantee with 403, writing nothing" in {
      val id = seedDashboardWithLayout("repair-grantee", otherId, """{"lg":[],"md":[],"sm":[],"xs":[{"panelId":"x","x":0,"y":0,"w":1,"h":2},{"panelId":"y","x":0,"y":0,"w":1,"h":2}]}""")
      val before = storedLayoutJson(id)
      grantRole(id, userId, "editor")
      repair(id, s"""{"xs":${arr(item("x", 0, 0), item("y", 0, 2))}}""") ~> routes ~> check { status shouldBe StatusCodes.Forbidden }
      grantRole(id, userId, "viewer")
      repair(id, s"""{"xs":${arr(item("x", 0, 0), item("y", 0, 2))}}""") ~> routes ~> check { status shouldBe StatusCodes.Forbidden }
      storedLayoutJson(id) shouldBe before
    }

    "answer 404 for a stranger with no grant, writing nothing" in {
      val id     = seedDashboardWithLayout("repair-stranger", otherId, """{"lg":[],"md":[],"sm":[],"xs":[{"panelId":"x","x":0,"y":0,"w":1,"h":2},{"panelId":"y","x":0,"y":0,"w":1,"h":2}]}""")
      val before = storedLayoutJson(id)
      repair(id, s"""{"xs":${arr(item("x", 0, 0), item("y", 0, 2))}}""") ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      storedLayoutJson(id) shouldBe before
    }

    "append an orphan to an incomplete (valid) breakpoint, leaving the stored item unchanged" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-incomplete-append")((p1, _) => s"""{"lg":${arr(item(p1, 0, 0, 6))},"md":[],"sm":[],"xs":[]}""")
      repair(id, s"""{"lg":${arr(item(p1, 0, 0, 6), item(p2, 6, 0, 6))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      storedLayoutJson(id).fields("lg").convertTo[Vector[JsObject]].map(_.fields("panelId")) shouldBe Vector(JsString(p1), JsString(p2))
      storedLayoutJson(id).fields("lg").convertTo[Vector[JsObject]].head shouldBe JsonParser(item(p1, 0, 0, 6))
    }

    "fill an empty breakpoint that has live panels" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-empty-bp")((p1, p2) => s"""{"lg":${arr(item(p1, 0, 0, 6), item(p2, 6, 0, 6))},"md":[],"sm":[],"xs":[]}""")
      repair(id, s"""{"md":${arr(item(p1, 0, 0, 5), item(p2, 5, 0, 5))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      xsOfBp(id, "md").map(_.asJsObject.fields("panelId")) shouldBe Vector(JsString(p1), JsString(p2))
    }

    "reject an incomplete-breakpoint repair that moves a stored item, naming the breakpoint, and store nothing" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-incomplete-move")((p1, _) => s"""{"lg":${arr(item(p1, 0, 0, 6))},"md":[],"sm":[],"xs":[]}""")
      val before       = storedLayoutJson(id)
      repair(id, s"""{"lg":${arr(item(p1, 0, 4, 6), item(p2, 6, 0, 6))}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message should include("breakpoint 'lg'")
      }
      storedLayoutJson(id) shouldBe before
    }

    "let stored-bad rules win over append-only when a breakpoint is both overlapping and missing a panel" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-bad-and-missing") { (p1, p2) =>
        s"""{"lg":${arr(item(p1, 0, 0, 6), item(p2, 6, 0, 6))},"md":[],"sm":[],"xs":${arr(item(p1, 0, 0), item("ghost", 0, 0))}}"""
      }
      repair(id, s"""{"xs":${arr(item(p1, 0, 2), item(p2, 0, 4))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      xsOf(id).map(_.asJsObject.fields("panelId")) shouldBe Vector(JsString(p1), JsString(p2))
    }

    "be a no-op the second time for an incomplete-breakpoint append" in {
      val (id, p1, p2) = seedWithTwoPanels("repair-incomplete-twice")((p1, _) => s"""{"lg":${arr(item(p1, 0, 0, 6))},"md":[],"sm":[],"xs":[]}""")
      repair(id, s"""{"lg":${arr(item(p1, 0, 0, 6), item(p2, 6, 0, 6))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val afterFirst = storedLayoutJson(id)
      repair(id, s"""{"lg":${arr(item(p1, 0, 0, 6), item(p2, 6, 4, 6))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      storedLayoutJson(id) shouldBe afterFirst
    }

    "refuse an editor grantee's append to an incomplete breakpoint with 403, writing nothing" in {
      val id = seedDashboardWithLayout("repair-incomplete-grantee", otherId, """{"lg":[{"panelId":"x","x":0,"y":0,"w":6,"h":2}],"md":[],"sm":[],"xs":[]}""")
      val before = storedLayoutJson(id)
      grantRole(id, userId, "editor")
      repair(id, s"""{"lg":${arr(item("x", 0, 0, 6), item("y", 6, 0, 6))}}""") ~> routes ~> check { status shouldBe StatusCodes.Forbidden }
      storedLayoutJson(id) shouldBe before
    }

    "reject an empty body" in {
      val (id, _, _) = seedWithTwoPanels("repair-empty")(badXs)
      repair(id, "{}") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
    }
  }
}
