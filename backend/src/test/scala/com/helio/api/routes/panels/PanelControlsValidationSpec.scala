package com.helio.api.routes.panels

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.{HttpRequest, StatusCodes}
import spray.json._

/** HEL-1203: every route that stores a panel's `config.controls` must answer a malformed list, a
 *  duplicate id, or controls on a non-output panel with a 400 (never a 500, never a silent drop).
 *  Real RLS + Flyway via [[ApplyProposalSpecBase]]; the seeded Output has one `region` string
 *  column, so a `text` control on `region` is eligible. One scenario matrix is run against each
 *  write path so a path that regresses is named in the test title. */
class PanelControlsValidationSpec extends ApplyProposalSpecBase {

  private val validControl = """{"id":"c1","kind":"text","column":"region","label":"Region"}"""
  private val dupControls  =
    """[{"id":"dup","kind":"text","column":"region","label":"A"},{"id":"dup","kind":"text","column":"region","label":"B"}]"""

  private val malformed = Vector(
    "a non-array controls"      -> "\"nope\"",
    "a non-object element"      -> "[\"x\"]",
    "a control missing its id"  -> """[{"kind":"text","column":"region","label":"R"}]"""
  )

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def authed(req: HttpRequest): HttpRequest = req.addHeader(sessionCookie).addHeader(csrfHeader)

  private def createPanel(dashboardId: String, kind: String, controls: String = "[]"): String = {
    val config = if (kind == "output") s"""{"outputId":"$pipelineOutputId","controls":$controls}""" else "{}"
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"P","type":"$kind","config":$config}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }
  }

  private def storedControls(dashboardId: String): Vector[JsValue] =
    Get(s"/api/dashboards/$dashboardId/export").addHeader(sessionCookie) ~> routes ~> check {
      val panels = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsObject]]
      panels.flatMap(_.fields("config").asJsObject.fields.get("controls")).flatMap(_.convertTo[Vector[JsValue]])
    }

  private def configFor(kind: String, controls: String): String =
    if (kind == "output") s"""{"outputId":"$pipelineOutputId","controls":$controls}""" else s"""{"controls":$controls}"""

  private def assertBadRequest(req: HttpRequest, mentions: String*): Unit = {
    req ~> routes ~> check {
      withClue(responseAs[String]) { status shouldBe StatusCodes.BadRequest }
      mentions.foreach(m => responseAs[String] should include(m))
    }
  }

  /** (path name, builder from (dashboardId, kind, controlsJson) to a request). Each builder sends
   *  `controls` to a panel of `kind`; PATCH-style paths create the target panel first. */
  private val paths: Vector[(String, (String, String, String) => HttpRequest)] = Vector(
    ("PATCH /api/panels/:id", (d, k, c) => {
      val id = createPanel(d, k)
      authed(Patch(s"/api/panels/$id", json(s"""{"config":${configFor(k, c)}}""")))
    }),
    ("POST /api/panels/updateBatch", (d, k, c) => {
      val id = createPanel(d, k)
      authed(Post("/api/panels/updateBatch", json(s"""{"fields":["config"],"panels":[{"id":"$id","config":${configFor(k, c)}}]}""")))
    }),
    ("POST /api/panels", (d, k, c) =>
      authed(Post("/api/panels", json(s"""{"dashboardId":"$d","title":"P","type":"$k","config":${configFor(k, c)}}""")))),
    ("POST /api/panels/batch", (d, k, c) =>
      authed(Post("/api/panels/batch", json(s"""{"dashboardId":"$d","panels":[{"title":"P","type":"$k","config":${configFor(k, c)}}]}""")))),
    ("PUT /api/dashboards/:id/contents", (d, k, c) => {
      val binding = if (k == "output") s""""outputId":"$pipelineOutputId",""" else ""
      authed(Put(s"/api/dashboards/$d/contents", json(s"""{"panels":[{"title":"P","type":"$k",$binding"config":{"controls":$c}}]}""")))
    }),
    ("POST /api/dashboards/apply-proposal", (_, k, c) => {
      val binding = if (k == "output") s""""outputId":"$pipelineOutputId",""" else ""
      authed(Post("/api/dashboards/apply-proposal", json(s"""{"dashboardName":"Ctl","panels":[{"title":"P","type":"$k",$binding"config":{"controls":$c}}]}""")))
    }),
    ("POST /api/dashboards/import", (d, k, c) => {
      createPanel(d, k)
      val snapshot = Get(s"/api/dashboards/$d/export").addHeader(sessionCookie) ~> routes ~> check {
        responseAs[String].parseJson.asJsObject
      }
      val panels = snapshot.fields("panels").convertTo[Vector[JsObject]].map { p =>
        val cfg = p.fields("config").asJsObject.fields + ("controls" -> c.parseJson)
        JsObject(p.fields + ("config" -> JsObject(cfg)))
      }
      authed(Post("/api/dashboards/import", json(JsObject(snapshot.fields + ("panels" -> JsArray(panels))).compactPrint)))
    })
  )

  "malformed controls (defect 1)" should {
    for ((path, send) <- paths; (label, controls) <- malformed)
      s"be a 400 on $path for $label" in {
        val d = createDashboard(s"m-$path-$label")
        assertBadRequest(send(d, "output", controls))
      }
  }

  "duplicate control ids (defect 2)" should {
    for ((path, send) <- paths)
      s"be a 400 naming the id on $path" in {
        val d = createDashboard(s"d-$path")
        assertBadRequest(send(d, "output", dupControls), "duplicate control id: 'dup'")
      }
  }

  "controls on a non-output panel (defect 3)" should {
    for ((path, send) <- paths; (label, controls) <- Vector("an empty array" -> "[]", "a populated array" -> s"[$validControl]"))
      s"be a 400 on $path for $label" in {
        val d = createDashboard(s"n-$path-$label")
        assertBadRequest(send(d, "text", controls), "controls are only supported on an output panel")
      }
  }

  "a rejected PATCH" should {
    "persist nothing" in {
      val d  = createDashboard("persist-nothing")
      val id = createPanel(d, "output", s"[$validControl]")
      assertBadRequest(authed(Patch(s"/api/panels/$id", json(s"""{"config":{"controls":$dupControls}}"""))))
      storedControls(d).map(_.asJsObject.fields("id")) shouldBe Vector(JsString("c1"))
    }

    "still 404 an absent panel before any controls validation" in {
      authed(Patch(s"/api/panels/00000000-0000-0000-0000-00000000dead", json("""{"config":{"controls":"nope"}}"""))) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "still accept a valid controls PATCH, a title-only PATCH, and a duplicate of a panel with controls" in {
      val d  = createDashboard("valid-paths")
      val id = createPanel(d, "output", s"[$validControl]")
      authed(Patch(s"/api/panels/$id", json("""{"title":"renamed"}"""))) ~> routes ~> check { status shouldBe StatusCodes.OK }
      authed(Patch(s"/api/panels/$id", json(s"""{"config":{"controls":[$validControl]}}"""))) ~> routes ~> check { status shouldBe StatusCodes.OK }
      authed(Post(s"/api/panels/$id/duplicate")) ~> routes ~> check { status shouldBe StatusCodes.Created }
      storedControls(d) should have size 2
    }
  }
}
