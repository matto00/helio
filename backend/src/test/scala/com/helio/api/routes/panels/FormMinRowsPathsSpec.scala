package com.helio.api.routes.panels

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.{HttpRequest, StatusCodes}
import spray.json._

import java.util.UUID

/** HEL-1834: the 5-row form minimum on the backend paths that copy a height (panel duplicate, proposal
 *  apply, replace contents), plus GUARD tests pinning the two paths the owner ruled out (dashboard
 *  import and dashboard duplicate keep a saved 4-row form at 4). Route-level, over the real RLS pool. */
class FormMinRowsPathsSpec extends ApplyProposalSpecBase {

  private val Bps = Vector("lg", "md", "sm", "xs")

  private val multiFields =
    """[{"sourceField":"quantity","control":"number","step":1,"required":true},{"sourceField":"note","control":"text"}]"""
  private val counterFields = """[{"sourceField":"delta","control":"counter","step":1}]"""

  /** A dataset with the counter shape (`occurred_at` timestamp, nullable numeric `value`) a counter form binds to. */
  private lazy val counterSourceId: String = {
    val id   = UUID.randomUUID().toString
    val conn = superuserConnection()
    try {
      val st = conn.prepareStatement(
        """INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
          |VALUES (?::uuid, 'counter-src', 'dataset', '{}'::jsonb, ?::uuid, now(), now(), ?::jsonb)""".stripMargin)
      st.setString(1, id)
      st.setString(2, userId)
      st.setString(3, """[{"name":"delta","type":"integer","required":true},{"name":"occurred_at","type":"timestamp","required":true},{"name":"value","type":"integer","required":false}]""")
      st.executeUpdate()
    } finally conn.close()
    id
  }

  private def sourceFor(fields: String): String = if (fields == counterFields) counterSourceId else datasetSourceId

  private def formConfig(fields: String): String =
    s"""{"dataSourceId":"${sourceFor(fields)}","fields":$fields,"submit":{"writeMode":"append"}}"""

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def createForm(dashboardId: String, fields: String): String =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"f","type":"form","config":${formConfig(fields)}}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def items(layout: JsObject, bp: String): Vector[JsObject] =
    layout.fields(bp).convertTo[Vector[JsValue]].map(_.asJsObject)

  private def itemFor(layout: JsObject, bp: String, panelId: String): JsObject =
    items(layout, bp).find(_.fields("panelId") == JsString(panelId)).getOrElse(fail(s"no $bp item for $panelId"))

  private def heightOf(layout: JsObject, bp: String, panelId: String): Int = itemFor(layout, bp, panelId).fields("h").convertTo[Int]

  private def idOf(o: JsObject): String = o.fields("id").convertTo[String]

  /** Every breakpoint holds `panelId` at 4 rows. */
  private def fourRowLayout(panelId: String): String =
    Bps.zip(Vector(6, 5, 3, 2)).map { case (bp, w) => s""""$bp":[{"panelId":"$panelId","x":0,"y":0,"w":$w,"h":4}]""" }.mkString("{", ",", "}")

  private def authed(r: HttpRequest) = r.addHeader(sessionCookie).addHeader(csrfHeader)

  private def duplicate(sourceId: String): JsObject =
    authed(Post(s"/api/panels/$sourceId/duplicate")) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject
    }

  private def proposalPanel(title: String, fields: String, layout: Option[String]): String =
    s"""{"title":"$title","type":"form","dataSourceId":"${sourceFor(fields)}","config":{"fields":$fields,"submit":{"writeMode":"append"}}${layout.map(l => s""","layout":$l""").getOrElse("")}}"""

  private def textPanel(title: String, layout: String): String = s"""{"title":"$title","type":"text","layout":$layout}"""

  private def applied(panels: Vector[String]): (String, Vector[JsObject]) =
    authed(Post("/api/dashboards/apply-proposal", json(s"""{"dashboardName":"hel1834","panels":[${panels.mkString(",")}]}"""))) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      val obj = responseAs[String].parseJson.asJsObject
      (obj.fields("dashboard").asJsObject.fields("id").convertTo[String], obj.fields("panels").convertTo[Vector[JsObject]])
    }

  private def replaced(dashboardId: String, panels: Vector[String]): Vector[JsObject] =
    authed(Put(s"/api/dashboards/$dashboardId/contents", json(s"""{"panels":[${panels.mkString(",")}]}"""))) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsObject]]
    }

  private def idByTitle(panels: Vector[JsObject], title: String): String =
    idOf(panels.find(_.fields("title") == JsString(title)).getOrElse(fail(s"no panel $title")))

  "POST /api/panels/:id/duplicate" should {

    "give a duplicate of a 4-row multi-field form 5 rows in every breakpoint, leaving the source and others unchanged" in {
      val dashboardId = createDashboard("hel1834-dup-form")
      val source      = createForm(dashboardId, multiFields)
      overwriteStoredLayout(dashboardId, fourRowLayout(source))
      val before = storedLayoutJson(dashboardId)
      val copy   = idOf(duplicate(source))
      val stored = storedLayoutJson(dashboardId)
      Bps.foreach { bp =>
        heightOf(stored, bp, copy) shouldBe 5
        itemFor(stored, bp, source) shouldBe itemFor(before, bp, source)
      }
    }

    "keep a duplicate of a 4-row compact counter at 4 rows" in {
      val dashboardId = createDashboard("hel1834-dup-counter")
      val source      = createForm(dashboardId, counterFields)
      overwriteStoredLayout(dashboardId, fourRowLayout(source))
      val copy   = idOf(duplicate(source))
      val stored = storedLayoutJson(dashboardId)
      Bps.foreach(bp => heightOf(stored, bp, copy) shouldBe 4)
    }
  }

  "POST /api/dashboards/apply-proposal" should {

    "grow an authored 4-row multi-field form to 5 rows in lg when the space below is free" in {
      val (id, panels) = applied(Vector(proposalPanel("F", multiFields, Some("""{"x":0,"y":0,"w":6,"h":4}"""))))
      val stored = storedLayoutJson(id)
      heightOf(stored, "lg", idByTitle(panels, "F")) shouldBe 5
    }

    "keep the authored 4 rows when another authored panel sits directly below, and not move that panel" in {
      val (id, panels) = applied(Vector(
        proposalPanel("F", multiFields, Some("""{"x":0,"y":0,"w":6,"h":4}""")),
        textPanel("Below", """{"x":0,"y":4,"w":6,"h":3}""")
      ))
      val stored = storedLayoutJson(id)
      heightOf(stored, "lg", idByTitle(panels, "F")) shouldBe 4
      val below = itemFor(stored, "lg", idByTitle(panels, "Below"))
      (below.fields("y").convertTo[Int], below.fields("h").convertTo[Int]) shouldBe ((4, 3))
    }

    "keep an authored 4-row compact counter at 4 rows" in {
      val (id, panels) = applied(Vector(proposalPanel("C", counterFields, Some("""{"x":0,"y":0,"w":4,"h":4}"""))))
      heightOf(storedLayoutJson(id), "lg", idByTitle(panels, "C")) shouldBe 4
    }
  }

  "PUT /api/dashboards/:id/contents" should {

    "grow an authored 4-row multi-field form to 5 rows in lg when the space below is free" in {
      val dashboardId = createDashboard("hel1834-put-form")
      val panels      = replaced(dashboardId, Vector(proposalPanel("F", multiFields, Some("""{"x":0,"y":0,"w":6,"h":4}"""))))
      heightOf(storedLayoutJson(dashboardId), "lg", idByTitle(panels, "F")) shouldBe 5
    }

    "keep an authored 4-row compact counter at 4 rows" in {
      val dashboardId = createDashboard("hel1834-put-counter")
      val panels      = replaced(dashboardId, Vector(proposalPanel("C", counterFields, Some("""{"x":0,"y":0,"w":4,"h":4}"""))))
      heightOf(storedLayoutJson(dashboardId), "lg", idByTitle(panels, "C")) shouldBe 4
    }
  }

  "GUARD: paths the owner ruled out keep a saved 4-row form at 4 rows" should {

    def seedFourRowDashboard(name: String): (String, String) = {
      val dashboardId = createDashboard(name)
      val source      = createForm(dashboardId, multiFields)
      overwriteStoredLayout(dashboardId, fourRowLayout(source))
      (dashboardId, source)
    }

    "GUARD: dashboard import" in {
      val (sourceId, _) = seedFourRowDashboard("hel1834-guard-import")
      val snapshot = Get(s"/api/dashboards/$sourceId/export").addHeader(sessionCookie) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String]
      }
      authed(Post("/api/dashboards/import", json(snapshot))) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val copyId = responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject.fields("id").convertTo[String]
        val stored = storedLayoutJson(copyId)
        Bps.foreach { bp =>
          items(stored, bp) should have size 1L
          items(stored, bp).head.fields("h").convertTo[Int] shouldBe 4
        }
      }
    }

    "GUARD: dashboard duplicate" in {
      val (sourceId, _) = seedFourRowDashboard("hel1834-guard-dashdup")
      authed(Post(s"/api/dashboards/$sourceId/duplicate")) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val copyId = responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject.fields("id").convertTo[String]
        val stored = storedLayoutJson(copyId)
        Bps.foreach { bp =>
          items(stored, bp) should have size 1L
          items(stored, bp).head.fields("h").convertTo[Int] shouldBe 4
        }
      }
    }
  }
}
