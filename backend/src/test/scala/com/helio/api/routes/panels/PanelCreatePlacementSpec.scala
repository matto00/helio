package com.helio.api.routes.panels

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import com.helio.services.panels.{LayoutBreakpointScaling, LayoutValidator}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Every panel create path stores a valid layout item in every breakpoint, atomically with the
 *  panel insert (HEL-1260). The base fixture runs the full route tree over a non-BYPASSRLS app
 *  pool, so each case is also the real RLS path. */
class PanelCreatePlacementSpec extends ApplyProposalSpecBase {

  private val Bps = Vector("lg", "md", "sm", "xs")

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private val formConfig =
    """{"dataSourceId":"DS","fields":[{"sourceField":"quantity","control":"number","step":1,"required":true}],"submit":{"writeMode":"append"}}"""

  private def bodyFor(kind: String, dashboardId: String): String = kind match {
    case "output" => s"""{"dashboardId":"$dashboardId","title":"o","type":"output","config":{"outputId":"$pipelineOutputId"}}"""
    case "form"   => s"""{"dashboardId":"$dashboardId","title":"f","type":"form","config":${formConfig.replace("DS", datasetSourceId)}}"""
    case other    => s"""{"dashboardId":"$dashboardId","title":"$other","type":"$other"}"""
  }

  private def createPanel(kind: String, dashboardId: String): JsObject =
    Post("/api/panels", json(bodyFor(kind, dashboardId))).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject
    }

  private def idOf(panel: JsObject): String = panel.fields("id").convertTo[String]

  private def items(layout: JsObject, bp: String): Vector[JsObject] =
    layout.fields(bp).convertTo[Vector[JsValue]].map(_.asJsObject)

  private def intField(o: JsObject, k: String): Int = o.fields(k).convertTo[Int]

  private def rects(layout: JsObject, bp: String): Vector[LayoutValidator.Rect] =
    items(layout, bp).map(o => LayoutValidator.Rect(o.fields("panelId").convertTo[String], intField(o, "x"), intField(o, "y"), intField(o, "w"), intField(o, "h")))

  private def itemFor(layout: JsObject, bp: String, panelId: String): JsObject =
    items(layout, bp).find(_.fields("panelId") == JsString(panelId)).getOrElse(fail(s"no $bp item for $panelId"))

  private def dims(o: JsObject): (Int, Int, Int, Int) = (intField(o, "x"), intField(o, "y"), intField(o, "w"), intField(o, "h"))

  private def assertAllValid(layout: JsObject): Unit =
    Bps.foreach(bp => withClue(s"breakpoint $bp: ")(LayoutValidator.isValid(rects(layout, bp), LayoutBreakpointScaling.breakpointCols(bp)) shouldBe true))

  private def patchLayout(dashboardId: String, layout: JsObject): Int =
    Patch(s"/api/dashboards/$dashboardId", json(s"""{"layout":${layout.compactPrint}}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status.intValue
    }

  private def layoutsOf(panel: JsObject): JsObject = panel.fields.getOrElse("layouts", fail("response carries no layouts")).asJsObject

  private def seedOrphanDashboard(name: String): (String, String) = {
    val id = seedDashboardWithLayout(name, userId, """{"lg":[],"md":[],"sm":[],"xs":[]}""")
    val orphan = createPanel("text", id)
    overwriteStoredLayout(id, """{"lg":[],"md":[],"sm":[],"xs":[]}""")
    (id, idOf(orphan))
  }

  "POST /api/panels" should {

    "store an item in lg, md, sm and xs for every panel kind, valid and non-overlapping" in {
      val dashboardId = createDashboard("place-every-kind")
      val created = Vector("output", "text", "markdown", "image", "divider", "form").map(createPanel(_, dashboardId))
      val stored  = storedLayoutJson(dashboardId)
      created.foreach { p =>
        Bps.foreach(bp => itemFor(stored, bp, idOf(p)))
        layoutsOf(p).fields.keySet shouldBe Bps.toSet
      }
      Bps.foreach(bp => items(stored, bp) should have size created.size.toLong)
      assertAllValid(stored)
    }

    "give a text panel the client's per-breakpoint default size at the origin of an empty dashboard" in {
      val dashboardId = createDashboard("place-text-sizes")
      val p           = createPanel("text", dashboardId)
      val stored      = storedLayoutJson(dashboardId)
      Bps.zip(Vector(4, 4, 3, 2)).foreach { case (bp, w) => dims(itemFor(stored, bp, idOf(p))) shouldBe ((0, 0, w, 5)) }
    }

    "return the stored per-breakpoint items in the response" in {
      val dashboardId = createDashboard("place-response-matches-store")
      val p           = createPanel("markdown", dashboardId)
      val stored      = storedLayoutJson(dashboardId)
      Bps.foreach { bp =>
        val wire = layoutsOf(p).fields(bp).asJsObject
        dims(wire) shouldBe dims(itemFor(stored, bp, idOf(p)))
      }
    }

    "keep the Output default size, scaled per breakpoint, byte-identical to before" in {
      val dashboardId = createDashboard("place-output-size")
      val p           = createPanel("output", dashboardId)
      val stored      = storedLayoutJson(dashboardId)
      dims(itemFor(stored, "lg", idOf(p))) shouldBe ((0, 0, 6, 6))
      dims(itemFor(stored, "md", idOf(p))) shouldBe ((0, 0, 5, 6))
      dims(itemFor(stored, "sm", idOf(p))) shouldBe ((0, 0, 3, 6))
      dims(itemFor(stored, "xs", idOf(p))) shouldBe ((0, 0, 1, 6))
    }

    "store both placements when two panels are created concurrently" in {
      val dashboardId = createDashboard("place-concurrent")
      val n           = 4
      implicit val pool: ExecutionContext = system.dispatcher
      val created = Await.result(Future.sequence((1 to n).map(_ => Future(createPanel("text", dashboardId)))), 30.seconds)
      val stored  = storedLayoutJson(dashboardId)
      Bps.foreach(bp => items(stored, bp) should have size n.toLong)
      created.foreach(p => Bps.foreach(bp => itemFor(stored, bp, idOf(p))))
      assertAllValid(stored)
    }

    "leave a stored layout that the layout PATCH validator accepts unchanged, after every create path" in {
      val dashboardId = createDashboard("place-seam")
      Vector("output", "text", "markdown", "image", "divider", "form").foreach(createPanel(_, dashboardId))
      patchLayout(dashboardId, storedLayoutJson(dashboardId)) shouldBe 200
      val source = idOf(createPanel("text", dashboardId))
      Post(s"/api/panels/$source/duplicate").addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check { status shouldBe StatusCodes.Created }
      patchLayout(dashboardId, storedLayoutJson(dashboardId)) shouldBe 200
      Post("/api/panels/batch", json(s"""{"dashboardId":"$dashboardId","panels":[{"title":"b","type":"text"},{"title":"c","type":"output","config":{"outputId":"$pipelineOutputId"}}]}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check { status shouldBe StatusCodes.Created }
      patchLayout(dashboardId, storedLayoutJson(dashboardId)) shouldBe 200
      assertAllValid(storedLayoutJson(dashboardId))
    }

    "never overlap an existing item even when a breakpoint was stored with items below another's bottom" in {
      val dashboardId = createDashboard("place-below-bottom")
      val a           = idOf(createPanel("divider", dashboardId))
      overwriteStoredLayout(dashboardId,
        s"""{"lg":[{"panelId":"$a","x":0,"y":0,"w":6,"h":2}],"md":[{"panelId":"$a","x":0,"y":0,"w":5,"h":9}],"sm":[],"xs":[]}""")
      val p      = createPanel("text", dashboardId)
      val stored = storedLayoutJson(dashboardId)
      dims(itemFor(stored, "lg", idOf(p)))._2 shouldBe 2
      dims(itemFor(stored, "md", idOf(p)))._2 shouldBe 9
      dims(itemFor(stored, "sm", idOf(p)))._2 shouldBe 0
    }
  }

  "POST /api/panels/batch" should {

    "store and return an item per breakpoint for every created panel, stacked in request order" in {
      val dashboardId = createDashboard("place-batch")
      Post("/api/panels/batch", json(s"""{"dashboardId":"$dashboardId","panels":[{"title":"t","type":"text"},{"title":"o","type":"output","config":{"outputId":"$pipelineOutputId"}}]}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val panels = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsObject]]
        val stored = storedLayoutJson(dashboardId)
        Bps.foreach { bp =>
          panels.foreach(p => dims(layoutsOf(p).fields(bp).asJsObject) shouldBe dims(itemFor(stored, bp, idOf(p))))
          dims(itemFor(stored, bp, idOf(panels(1))))._2 shouldBe dims(itemFor(stored, bp, idOf(panels.head)))._2 + 5
        }
        assertAllValid(stored)
      }
    }

    "leave the stored layout unchanged when the batch is rejected" in {
      val dashboardId = createDashboard("place-batch-rejected")
      createPanel("text", dashboardId)
      val before = storedLayoutJson(dashboardId)
      Post("/api/panels/batch", json(s"""{"dashboardId":"$dashboardId","panels":[{"title":"t","type":"text"},{"title":"bad","type":"bogus"}]}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      storedLayoutJson(dashboardId) shouldBe before
    }
  }

  "POST /api/panels/:id/duplicate" should {

    def duplicate(sourceId: String): JsObject =
      Post(s"/api/panels/$sourceId/duplicate").addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[String].parseJson.asJsObject
      }

    "store and return an item below the existing ones and keep the source size" in {
      val dashboardId = createDashboard("place-duplicate")
      val source      = idOf(createPanel("text", dashboardId))
      overwriteStoredLayout(dashboardId,
        s"""{"lg":[{"panelId":"$source","x":0,"y":0,"w":6,"h":4}],"md":[{"panelId":"$source","x":0,"y":0,"w":5,"h":4}],"sm":[{"panelId":"$source","x":0,"y":0,"w":3,"h":4}],"xs":[{"panelId":"$source","x":0,"y":0,"w":2,"h":4}]}""")
      val copy   = duplicate(source)
      val stored = storedLayoutJson(dashboardId)
      dims(itemFor(stored, "lg", idOf(copy))) shouldBe ((0, 4, 6, 4))
      Bps.foreach(bp => dims(layoutsOf(copy).fields(bp).asJsObject) shouldBe dims(itemFor(stored, bp, idOf(copy))))
      assertAllValid(stored)
    }

    "scale the source's lg size into a breakpoint where the source has no item" in {
      val dashboardId = createDashboard("place-duplicate-partial")
      val source      = idOf(createPanel("text", dashboardId))
      overwriteStoredLayout(dashboardId, s"""{"lg":[{"panelId":"$source","x":0,"y":0,"w":6,"h":4}],"md":[],"sm":[],"xs":[]}""")
      val copy = duplicate(source)
      val sm   = itemFor(storedLayoutJson(dashboardId), "sm", idOf(copy))
      (intField(sm, "w"), intField(sm, "h")) shouldBe ((3, 4))
    }

    "use the kind default size when the source is orphaned everywhere" in {
      val (dashboardId, source) = seedOrphanDashboard("place-duplicate-orphan")
      val copy                  = duplicate(source)
      val stored                = storedLayoutJson(dashboardId)
      Bps.zip(Vector(4, 4, 3, 2)).foreach { case (bp, w) =>
        val i = itemFor(stored, bp, idOf(copy))
        (intField(i, "w"), intField(i, "h")) shouldBe ((w, 5))
      }
    }
  }

  "POST /api/dashboards/apply-proposal" should {

    "give a panel with no authored placement an item in every breakpoint and keep the authored one" in {
      val body =
        s"""{"dashboardName":"place-proposal","panels":[
           |  {"title":"Authored","type":"output","outputId":"$pipelineOutputId","layout":{"x":0,"y":0,"w":4,"h":3}},
           |  {"title":"Unplaced","type":"text"}]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val id     = obj.fields("dashboard").asJsObject.fields("id").convertTo[String]
        val panels = obj.fields("panels").convertTo[Vector[JsObject]]
        val stored = storedLayoutJson(id)
        panels.foreach(p => Bps.foreach(bp => itemFor(stored, bp, idOf(p))))
        dims(itemFor(stored, "lg", idOf(panels.find(_.fields("title") == JsString("Authored")).get))) shouldBe ((0, 0, 4, 3))
        assertAllValid(stored)
      }
    }
  }

  "panel create under row-level security" should {

    def seedForeignDashboard(name: String, grant: Option[String]): String = {
      val id = seedDashboardWithLayout(name, otherId, """{"lg":[],"md":[],"sm":[],"xs":[]}""")
      grant.foreach(grantRole(id, userId, _))
      id
    }

    "run on an app pool that is neither superuser nor BYPASSRLS, with RLS forced on dashboards and panels" in {
      appPoolRlsPosture() shouldBe ((false, true, true))
    }

    "store the panel and its four items for an editor grantee" in {
      val id      = seedForeignDashboard("place-rls-editor", Some("editor"))
      val created = createPanel("text", id)
      val stored  = storedLayoutJson(id)
      Bps.foreach(bp => itemFor(stored, bp, idOf(created)))
      panelTitlesForDashboard(id) should have size 1
    }

    "store a batch and a duplicate with their items for an editor grantee" in {
      val id      = seedForeignDashboard("place-rls-editor-batch", Some("editor"))
      val created = createPanel("text", id)
      Post("/api/panels/batch", json(s"""{"dashboardId":"$id","panels":[{"title":"b","type":"text"}]}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Post(s"/api/panels/${idOf(created)}/duplicate").addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check { status shouldBe StatusCodes.Created }
      val stored = storedLayoutJson(id)
      Bps.foreach(bp => items(stored, bp) should have size 3L)
      assertAllValid(stored)
    }

    "write nothing for a caller with no grant" in {
      val id = seedForeignDashboard("place-rls-stranger", None)
      val before = storedLayoutJson(id)
      Post("/api/panels", json(bodyFor("text", id))).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status.intValue should (be(403) or be(404))
      }
      panelTitlesForDashboard(id) shouldBe empty
      storedLayoutJson(id) shouldBe before
    }

    "write nothing for a viewer grantee" in {
      val id = seedForeignDashboard("place-rls-viewer", Some("viewer"))
      val before = storedLayoutJson(id)
      Post("/api/panels", json(bodyFor("text", id))).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      panelTitlesForDashboard(id) shouldBe empty
      storedLayoutJson(id) shouldBe before
    }
  }

  "an orphan carried by a dashboard duplicate or import" should {

    def exportedPanelIds(dashboardId: String): Vector[String] =
      Get(s"/api/dashboards/$dashboardId/export").addHeader(sessionCookie) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsObject]].map(idOf)
      }

    def repairAppendingOrphan(dashboardId: String, panelId: String): Unit = {
      val body = Bps.map(bp => s""""$bp":[{"panelId":"$panelId","x":0,"y":0,"w":1,"h":2}]""").mkString("{", ",", "}")
      Post(s"/api/dashboards/$dashboardId/layout/repair", json(body)).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      val stored = storedLayoutJson(dashboardId)
      Bps.foreach(bp => dims(itemFor(stored, bp, panelId)) shouldBe ((0, 0, 1, 2)))
    }

    "stay faithful in a dashboard duplicate and be accepted by the owner repair appended" in {
      val (sourceId, _) = seedOrphanDashboard("place-dash-dup")
      Post(s"/api/dashboards/$sourceId/duplicate").addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val copyId = responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject.fields("id").convertTo[String]
        storedLayoutJson(copyId).fields("lg") shouldBe JsArray()
        repairAppendingOrphan(copyId, exportedPanelIds(copyId).head)
      }
    }

    "stay faithful in an export-then-import and be accepted by the owner repair appended" in {
      val (sourceId, _) = seedOrphanDashboard("place-dash-import")
      val snapshot = Get(s"/api/dashboards/$sourceId/export").addHeader(sessionCookie) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String]
      }
      Post("/api/dashboards/import", json(snapshot)).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val copyId = responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject.fields("id").convertTo[String]
        storedLayoutJson(copyId).fields("lg") shouldBe JsArray()
        repairAppendingOrphan(copyId, exportedPanelIds(copyId).head)
      }
    }
  }
}
