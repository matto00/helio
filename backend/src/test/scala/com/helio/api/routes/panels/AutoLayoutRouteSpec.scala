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

    "pack supplied panels into non-overlapping lg positions, scaling md/sm/xs to their own column counts" in {
      val dashboardId = createDashboard("Auto Layout Target")
      val p1 = createPanel(dashboardId, "Chart 1", "divider")
      val p2 = createPanel(dashboardId, "Chart 2", "divider")

      // w=6 + w=8 > 12 -> p2 wraps to a new shelf below p1.
      autoLayout(dashboardId, s"""{"items":[{"panelId":"$p1","w":6,"h":8},{"panelId":"$p2","w":8,"h":8}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val layout = responseAs[String].parseJson.asJsObject.fields("layout").asJsObject
        val lg = layout.fields("lg").convertTo[Vector[JsValue]]
        lg should have size 2

        val byId = lg.map(_.asJsObject).map(o => o.fields("panelId").convertTo[String] -> o).toMap
        byId(p1).fields("y").convertTo[Int] shouldBe 0
        byId(p2).fields("y").convertTo[Int] should be > 0

        // HEL-909 cycle-3: lg is packed at cols=12; md/sm/xs have narrower
        // column counts (10/6/2) and must be independently scaled, not a
        // verbatim copy of the 12-col lg array — every md/sm/xs item's w
        // must be <= its own breakpoint's column count.
        def maxW(bp: String): Int = layout.fields(bp).convertTo[Vector[JsValue]].map(_.asJsObject.fields("w").convertTo[Int]).max
        layout.fields("md") should not be layout.fields("lg")
        layout.fields("sm") should not be layout.fields("lg")
        layout.fields("xs") should not be layout.fields("lg")
        maxW("md") should be <= 10
        maxW("sm") should be <= 6
        maxW("xs") should be <= 2
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

        // HEL-1071: the packed item is placed BELOW the kept panel (it used to be appended with no
        // collision avoidance, landing on the kept panel's cell).
        byId(packed).fields("x").convertTo[Int] shouldBe 0
        byId(packed).fields("y").convertTo[Int] shouldBe 2
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

  // ── HEL-1071: breakpoint-aware packing ────────────────────────────────────

  private def createOutputPanel(dashboardId: String, title: String): String =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"$title","type":"output","config":{"outputId":"$pipelineOutputId"}}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def cols = Map("lg" -> 12, "md" -> 10, "sm" -> 6, "xs" -> 2)
  private def rects(layout: JsObject, bp: String): Vector[(String, Int, Int, Int, Int)] =
    layout.fields(bp).convertTo[Vector[JsValue]].map(_.asJsObject).map { o =>
      (o.fields("panelId").convertTo[String], o.fields("x").convertTo[Int], o.fields("y").convertTo[Int], o.fields("w").convertTo[Int], o.fields("h").convertTo[Int])
    }
  private def assertValid(layout: JsObject, only: Set[String] = Set("lg", "md", "sm", "xs")): Unit =
    cols.filter { case (bp, _) => only.contains(bp) }.foreach { case (bp, c) =>
      val items = rects(layout, bp)
      items.foreach { case (id, x, _, w, _) => withClue(s"$bp $id: ") { (x + w) should be <= c } }
      for (i <- items.indices; j <- (i + 1) until items.size) {
        val (_, ax, ay, aw, ah) = items(i)
        val (_, bx, by, bw, bh) = items(j)
        withClue(s"$bp items $i/$j overlap: ") { (ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by) shouldBe false }
      }
    }
  private def layoutOf(dashboardId: String): JsObject = storedLayoutJson(dashboardId)

  "POST /api/dashboards/:id/auto-layout (breakpoint-aware, HEL-1071)" should {

    "pack three 4-wide Outputs without overflow or overlap at every breakpoint, xs included" in {
      val dashboardId = createDashboard("Three Outputs")
      val ids = Vector("A", "B", "C").map(createOutputPanel(dashboardId, _))
      autoLayout(dashboardId, s"""{"items":[${ids.map(i => s"""{"panelId":"$i","w":4,"h":4}""").mkString(",")}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      val layout = layoutOf(dashboardId)
      assertValid(layout)
      rects(layout, "xs").foreach { case (_, _, _, w, _) => w should be <= 2 }
      rects(layout, "xs") should have size 3
    }

    "pack only the named breakpoint and leave the other three byte-identical" in {
      val dashboardId = createDashboard("Single Breakpoint")
      val ids = Vector("A", "B").map(createOutputPanel(dashboardId, _))
      val before = layoutOf(dashboardId)
      autoLayout(dashboardId, s"""{"breakpoint":"xs","items":[{"panelId":"${ids(0)}","w":2,"h":4},{"panelId":"${ids(1)}","w":2,"h":4}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      val after = layoutOf(dashboardId)
      List("lg", "md", "sm").foreach(bp => after.fields(bp) shouldBe before.fields(bp))
      rects(after, "xs").map(_._5) shouldBe Vector(6, 6) // an Output is clamped to its kind minimum height
      assertValid(after, only = Set("xs"))
    }

    "reject cols that disagree with the named breakpoint, and an unknown breakpoint, and cols above 12" in {
      val dashboardId = createDashboard("Bad Params")
      val p = createOutputPanel(dashboardId, "A")
      val item = s"""{"panelId":"$p","w":1,"h":2}"""
      autoLayout(dashboardId, s"""{"breakpoint":"xs","cols":12,"items":[$item]}""") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      autoLayout(dashboardId, s"""{"breakpoint":"huge","items":[$item]}""") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      autoLayout(dashboardId, s"""{"cols":24,"items":[$item]}""") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
    }

    "place packed items below kept panels in every breakpoint" in {
      val dashboardId = createDashboard("Below Kept")
      val kept   = createOutputPanel(dashboardId, "Kept")
      val packed = createOutputPanel(dashboardId, "Packed")
      val before = layoutOf(dashboardId)
      autoLayout(dashboardId, s"""{"items":[{"panelId":"$packed","w":4,"h":4}]}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val after = layoutOf(dashboardId)
      assertValid(after)
      cols.keys.foreach { bp =>
        val keptItem   = rects(after, bp).find(_._1 == kept).get
        val packedItem = rects(after, bp).find(_._1 == packed).get
        keptItem shouldBe rects(before, bp).find(_._1 == kept).get // kept panel did not move
        packedItem._3 should be >= (keptItem._3 + keptItem._5)
      }
    }

    "reject with 400 naming the breakpoint when a kept panel pair already overlaps there, saving nothing" in {
      val dashboardId = createDashboard("Kept Stored Bad")
      val k1 = createOutputPanel(dashboardId, "K1")
      val k2 = createOutputPanel(dashboardId, "K2")
      val p  = createOutputPanel(dashboardId, "P")
      def it(id: String, x: Int, y: Int, w: Int) = s"""{"panelId":"$id","x":$x,"y":$y,"w":$w,"h":2}"""
      overwriteStoredLayout(dashboardId, s"""{"lg":[],"md":[],"sm":[],"xs":[${it(k1, 0, 0, 1)},${it(k2, 0, 0, 1)}]}""")
      val before = layoutOf(dashboardId)
      autoLayout(dashboardId, s"""{"items":[{"panelId":"$p","w":4,"h":4}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val msg = responseAs[String].parseJson.asJsObject.fields("message").convertTo[String]
        msg should include("breakpoint 'xs'")
        msg should include(k1)
        msg should include(k2)
      }
      layoutOf(dashboardId) shouldBe before
    }
  }
}
