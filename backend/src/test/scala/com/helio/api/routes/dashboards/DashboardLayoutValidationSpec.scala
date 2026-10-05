package com.helio.api.routes.dashboards

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.{HttpRequest, StatusCodes}
import spray.json._

/** HEL-1071 route-level coverage of the layout write policy over a real database: a changed breakpoint
 *  must be in bounds and non-overlapping or the WHOLE write is a 400 naming the breakpoint and panel
 *  ids; a breakpoint identical to the stored one passes untouched (so a stored-bad breakpoint never
 *  locks a user out); absent breakpoints are preserved. Stored-bad layouts are seeded through the
 *  repository/SQL, never the API (the API can no longer produce one). Every case that is about the
 *  write policy runs through BOTH layout PATCH routes: `PATCH /api/dashboards/:id` and the batch
 *  `PATCH /api/dashboards/:id/update` the web client actually uses. */
class DashboardLayoutValidationSpec extends ApplyProposalSpecBase {

  private def item(id: String, x: Int, y: Int, w: Int = 1, h: Int = 2): String =
    s"""{"panelId":"$id","x":$x,"y":$y,"w":$w,"h":$h}"""
  private def arr(items: String*): String = items.mkString("[", ",", "]")

  /** lg is valid; xs is stored-bad (two panels in one cell). */
  private val storedBadLayout: String =
    s"""{"lg":${arr(item("p1", 0, 0, 6), item("p2", 6, 0, 6))},"md":[],"sm":[],"xs":${arr(item("p1", 0, 0), item("p2", 0, 0))}}"""

  private def seedStoredBad(name: String): String = seedDashboardWithLayout(name, userId, storedBadLayout)

  private val routesUnderTest: Seq[(String, (String, String) => HttpRequest)] = Seq(
    "PATCH /api/dashboards/:id" -> { (id: String, layoutBody: String) =>
      Patch(s"/api/dashboards/$id", json(s"""{"layout":$layoutBody}""")).addHeader(sessionCookie).addHeader(csrfHeader)
    },
    "PATCH /api/dashboards/:id/update" -> { (id: String, layoutBody: String) =>
      Patch(s"/api/dashboards/$id/update", json(s"""{"fields":["layout"],"dashboard":{"layout":$layoutBody}}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader)
    }
  )

  private def bp(layout: JsObject, name: String): Vector[JsValue] = layout.fields(name).convertTo[Vector[JsValue]]
  private def message: String = responseAs[String].parseJson.asJsObject.fields("message").convertTo[String]

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def createOutputPanel(dashboardId: String, title: String): JsObject =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"$title","type":"output","config":{"outputId":"$pipelineOutputId"}}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject
    }

  private def createDivider(dashboardId: String, title: String): String =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"$title","type":"divider"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  routesUnderTest.foreach { case (routeName, build) =>
    s"$routeName layout validation" should {

      "reject an overlapping xs with 400 naming the breakpoint and both panel ids, saving nothing" in {
        val id     = seedStoredBad("overlap-xs-" + routeName.hashCode)
        val before = storedLayoutJson(id)
        build(id, s"""{"xs":${arr(item("p1", 0, 0), item("p2", 0, 1))}, "lg":${arr(item("p1", 0, 4, 6), item("p2", 6, 4, 6))}}""") ~> routes ~> check {
          status shouldBe StatusCodes.BadRequest
          message should include("breakpoint 'xs'")
          message should include("'p1'")
          message should include("'p2'")
        }
        storedLayoutJson(id) shouldBe before // the valid lg change was not saved either
      }

      "reject an out-of-bounds xs (x=1, w=2) with 400 and save nothing" in {
        val id     = seedDashboardWithLayout("oob-xs-" + routeName.hashCode, userId, """{"lg":[],"md":[],"sm":[],"xs":[]}""")
        val before = storedLayoutJson(id)
        build(id, s"""{"xs":${arr(item("p1", 1, 0, 2))}}""") ~> routes ~> check {
          status shouldBe StatusCodes.BadRequest
          message should include("breakpoint 'xs'")
          message should include("panel 'p1' is out of bounds")
        }
        storedLayoutJson(id) shouldBe before
      }

      "reject a negative coordinate instead of clamping it" in {
        val id = seedDashboardWithLayout("neg-" + routeName.hashCode, userId, """{"lg":[],"md":[],"sm":[],"xs":[]}""")
        build(id, s"""{"lg":${arr(item("p1", -1, 0, 2))}}""") ~> routes ~> check {
          status shouldBe StatusCodes.BadRequest
          message should include("breakpoint 'lg'")
        }
        storedLayoutJson(id).fields("lg") shouldBe JsArray()
      }

      "reject an empty layout object" in {
        val id = seedStoredBad("empty-" + routeName.hashCode)
        build(id, "{}") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      }

      "preserve the other breakpoints on a partial PATCH that sets only xs" in {
        val id     = seedStoredBad("partial-" + routeName.hashCode)
        val before = storedLayoutJson(id)
        build(id, s"""{"xs":${arr(item("p1", 0, 0), item("p2", 1, 0))}}""") ~> routes ~> check {
          status shouldBe StatusCodes.OK
        }
        val after = storedLayoutJson(id)
        after.fields("lg") shouldBe before.fields("lg")
        after.fields("md") shouldBe before.fields("md")
        after.fields("sm") shouldBe before.fields("sm")
        bp(after, "xs").map(_.asJsObject.fields("x")) shouldBe Vector(JsNumber(0), JsNumber(1))
      }

      "accept an lg edit while a stored-bad xs rides along reordered, leaving xs byte-identical" in {
        val id     = seedStoredBad("grandfather-" + routeName.hashCode)
        val before = storedLayoutJson(id)
        val body   = s"""{"lg":${arr(item("p1", 0, 4, 6), item("p2", 6, 4, 6))},"md":[],"sm":[],"xs":${arr(item("p2", 0, 0), item("p1", 0, 0))}}"""
        build(id, body) ~> routes ~> check { status shouldBe StatusCodes.OK }
        val after = storedLayoutJson(id)
        after.fields("xs") shouldBe before.fields("xs") // same elements, stored order kept
        bp(after, "lg").map(_.asJsObject.fields("y")).toSet shouldBe Set(JsNumber(4))
      }

      "treat a whitespace-padded but otherwise identical panelId as unchanged, not as a change" in {
        val id     = seedStoredBad("ws-" + routeName.hashCode)
        val before = storedLayoutJson(id)
        build(id, s"""{"xs":${arr(item(" p1 ", 0, 0), item("p2 ", 0, 0))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
        storedLayoutJson(id).fields("xs") shouldBe before.fields("xs")
      }

      "still reject a stored-bad xs that is changed but still overlapping" in {
        val id     = seedStoredBad("still-bad-" + routeName.hashCode)
        val before = storedLayoutJson(id)
        build(id, s"""{"xs":${arr(item("p1", 0, 0), item("p2", 0, 1))}}""") ~> routes ~> check {
          status shouldBe StatusCodes.BadRequest
          message should include("breakpoint 'xs'")
        }
        storedLayoutJson(id) shouldBe before
      }

      "accept the repaired xs" in {
        val id = seedStoredBad("repair-" + routeName.hashCode)
        build(id, s"""{"xs":${arr(item("p1", 0, 0), item("p2", 1, 0))}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
        bp(storedLayoutJson(id), "xs") should have size 2
      }
    }
  }

  "POST /api/panels" should {
    "answer with the item it stored in every breakpoint, each below THAT breakpoint's own bottom" in {
      val id = seedDashboardWithLayout(
        "create-per-bp",
        userId,
        s"""{"lg":${arr(item("x", 0, 0, 6, 2))},"md":${arr(item("x", 0, 0, 5, 9))},"sm":[],"xs":${arr(item("x", 0, 0, 2, 3), item("y", 0, 0, 2, 3))}}"""
      )
      val created = createOutputPanel(id, "New")
      val layouts = created.fields("layouts").asJsObject
      created.fields("layout") shouldBe layouts.fields("lg") // `layout` kept for compatibility
      val yOf = (name: String) => layouts.fields(name).asJsObject.fields("y").convertTo[Int]
      (yOf("lg"), yOf("md"), yOf("sm"), yOf("xs")) shouldBe ((2, 9, 0, 3))
      layouts.fields("xs").asJsObject.fields("w").convertTo[Int] should be <= 2

      val stored = storedLayoutJson(id)
      List("lg", "md", "sm", "xs").foreach { name =>
        val last = bp(stored, name).last.asJsObject
        val placed = layouts.fields(name).asJsObject
        List("x", "y", "w", "h").foreach(f => last.fields(f) shouldBe placed.fields(f))
        last.fields("panelId") shouldBe created.fields("id")
      }
    }
  }

  "the web client's real request bodies (seam contract)" should {
    "be accepted when it creates a panel and then drags another one (all four breakpoints sent)" in {
      val id = createDashboard("seam-create-then-drag")
      val a  = createOutputPanel(id, "A")
      val b  = createOutputPanel(id, "B")
      // What the client holds after adopting the server's placement is exactly what is stored.
      val authored = storedLayoutJson(id)
      val dragged  = bp(authored, "lg").map { raw =>
        val o = raw.asJsObject
        if (o.fields("panelId") == a.fields("id")) JsObject(o.fields.updated("x", JsNumber(6)).updated("y", JsNumber(30))) else o
      }
      val body = s"""{"lg":${JsArray(dragged)},"md":${authored.fields("md")},"sm":${authored.fields("sm")},"xs":${authored.fields("xs")}}"""
      routesUnderTest.foreach { case (_, build) =>
        build(id, body) ~> routes ~> check { status shouldBe StatusCodes.OK }
      }
      // ... and the partial form the client now sends (changed breakpoint only) is accepted too.
      routesUnderTest.head._2(id, s"""{"lg":${JsArray(dragged)}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      b.fields("layouts") should not be null
    }

    "be accepted for undo-after-repair on a stored-bad xs, and reject the raw stale snapshot the client no longer sends" in {
      val id = seedStoredBad("seam-undo-after-repair")
      val repaired = arr(item("p1", 0, 0), item("p2", 1, 0))
      // 1. the user repairs xs by dragging
      routesUnderTest.head._2(id, s"""{"xs":$repaired}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      // 2. undo restores the stored-bad snapshot locally; sent AS-IS it differs from stored and is invalid
      val staleBad = arr(item("p1", 0, 0), item("p2", 0, 0))
      routesUnderTest.head._2(id, s"""{"xs":$staleBad}""") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      // 3. the client instead sends what the user sees (the resolved breakpoint): accepted
      val resolved = arr(item("p1", 0, 0), item("p2", 0, 2))
      routesUnderTest.head._2(id, s"""{"xs":$resolved}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      bp(storedLayoutJson(id), "xs").map(_.asJsObject.fields("y")) shouldBe Vector(JsNumber(0), JsNumber(2))
    }
  }

  "dashboard import (HEL-1233) and duplicate (HEL-1071 D7)" should {
    "store an imported snapshot's overlapping or out-of-bounds breakpoints repaired, keeping every panel" in {
      val id = createDashboard("import-source")
      val p1 = createDivider(id, "One")
      val p2 = createDivider(id, "Two")
      val exported = Get(s"/api/dashboards/$id/export").addHeader(sessionCookie) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject
      }
      def snapshotWith(bps: (String, String)*): String = {
        val dash   = exported.fields("dashboard").asJsObject
        val layout = JsObject(bps.foldLeft(dash.fields("layout").asJsObject.fields)((fs, kv) => fs.updated(kv._1, kv._2.parseJson)))
        JsObject(exported.fields.updated("dashboard", JsObject(dash.fields.updated("layout", layout)))).compactPrint
      }
      def importedLayout(body: String): JsObject =
        Post("/api/dashboards/import", json(body)).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
          status shouldBe StatusCodes.Created
          responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject.fields("layout").asJsObject
        }
      def cells(layout: JsObject, name: String): Vector[(Int, Int, Int)] =
        bp(layout, name).map(_.asJsObject.fields).map(f => (f("x").convertTo[Int], f("y").convertTo[Int], f("w").convertTo[Int]))

      val lgBefore = exported.fields("dashboard").asJsObject.fields("layout").asJsObject.fields("lg")
      val overlap  = importedLayout(snapshotWith("xs" -> arr(item(p1, 0, 0), item(p2, 0, 0))))
      bp(overlap, "xs") should have size 2
      cells(overlap, "xs").distinct should have size 2 // no longer the same cell
      overlap.fields("lg") should not be JsNull
      overlap.fields("lg").convertTo[Vector[JsValue]].size shouldBe lgBefore.convertTo[Vector[JsValue]].size

      val oob = importedLayout(snapshotWith("md" -> arr(item(p1, 8, 0, 4), item(p2, 0, 2, 4))))
      bp(oob, "md") should have size 2
      cells(oob, "md").foreach { case (x, _, w) => (x + w) should be <= 10 }
    }

    "still reject an imported layout entry that references no snapshot panel" in {
      val id = createDashboard("import-ref-source")
      createDivider(id, "One")
      val exported = Get(s"/api/dashboards/$id/export").addHeader(sessionCookie) ~> routes ~> check {
        responseAs[String].parseJson.asJsObject
      }
      val dash   = exported.fields("dashboard").asJsObject
      val layout = JsObject(dash.fields("layout").asJsObject.fields.updated("xs", arr(item("ghost", 0, 0)).parseJson))
      val body   = JsObject(exported.fields.updated("dashboard", JsObject(dash.fields.updated("layout", layout)))).compactPrint
      Post("/api/dashboards/import", json(body)).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "duplicate a stored-bad dashboard as a faithful copy (no validation, ids remapped)" in {
      val id = createDashboard("dup-source")
      val p1 = createDivider(id, "One")
      val p2 = createDivider(id, "Two")
      overwriteStoredLayout(id, s"""{"lg":[],"md":[],"sm":[],"xs":${arr(item(p1, 0, 0), item(p2, 0, 0))}}""")
      Post(s"/api/dashboards/$id/duplicate").addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val xs = responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject
          .fields("layout").asJsObject.fields("xs").convertTo[Vector[JsValue]].map(_.asJsObject)
        xs should have size 2
        xs.map(o => (o.fields("x"), o.fields("y"))).distinct should have size 1 // still the same cell: copied faithfully
        xs.map(_.fields("panelId").convertTo[String]) should not contain p1
      }
    }
  }

  "apply-proposal and replace-contents layout (HEL-1071 D6)" should {
    val threeTiles =
      """{"title":"T1","type":"text","layout":{"x":0,"y":0,"w":4,"h":3}},
        |{"title":"T2","type":"text","layout":{"x":4,"y":0,"w":4,"h":3}},
        |{"title":"T3","type":"text","layout":{"x":8,"y":0,"w":4,"h":3}}""".stripMargin
    val overlapping =
      """{"title":"T1","type":"text","layout":{"x":0,"y":0,"w":6,"h":3}},
        |{"title":"T2","type":"text","layout":{"x":3,"y":1,"w":6,"h":3}}""".stripMargin

    def assertDerivedValid(layout: JsObject): Unit = {
      val cols = Map("lg" -> 12, "md" -> 10, "sm" -> 6, "xs" -> 2)
      cols.foreach { case (name, c) =>
        val items = bp(layout, name).map(_.asJsObject.fields.view.filterKeys(_ != "panelId").mapValues(_.convertTo[Int]).toMap)
        items should have size 3
        items.foreach(i => (i("x") + i("w")) should be <= c)
        for (i <- items.indices; j <- (i + 1) until items.size) {
          val (a, b) = (items(i), items(j))
          val overlap = a("x") < b("x") + b("w") && a("x") + a("w") > b("x") && a("y") < b("y") + b("h") && a("y") + a("h") > b("y")
          withClue(s"$name: items $i and $j overlap: ") { overlap shouldBe false }
        }
      }
    }

    "apply a proposal of three 4-wide tiles with valid md/sm/xs" in {
      apply(s"""{"dashboardName":"Three tiles","panels":[$threeTiles]}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        assertDerivedValid(responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject.fields("layout").asJsObject)
      }
    }

    "reject an overlapping lg proposal with 400 naming lg and the proposal panels, creating nothing" in {
      val before = dashboardCount()
      apply(s"""{"dashboardName":"Overlap","panels":[$overlapping]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message should include("breakpoint 'lg'")
        message should include("panel 1 ('T1')")
        message should include("panel 2 ('T2')")
      }
      dashboardCount() shouldBe before
    }

    "reject an out-of-bounds lg proposal layout" in {
      apply("""{"dashboardName":"OOB","panels":[{"title":"T1","type":"text","layout":{"x":10,"y":0,"w":6,"h":3}}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message should include("out of bounds")
      }
    }

    "replace contents with derived valid breakpoints, and reject an overlapping lg leaving the dashboard untouched" in {
      val id = createDashboard("contents-target")
      createDivider(id, "Keep")
      val before = storedLayoutJson(id)
      Put(s"/api/dashboards/$id/contents", json(s"""{"panels":[$overlapping]}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        message should include("breakpoint 'lg'")
      }
      storedLayoutJson(id) shouldBe before

      Put(s"/api/dashboards/$id/contents", json(s"""{"panels":[$threeTiles]}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        assertDerivedValid(storedLayoutJson(id))
      }
    }
  }
}
