package com.helio.api.routes.panels

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.{StatusCode, StatusCodes}
import spray.json._

/** HEL-1466 — pins the panel-content claims of the `markdown-panel` spec against the real route
 *  tree: `content` lives only in `config.content` of a `text`/`markdown` panel; there is no
 *  top-level `content`; a `content` key sent for any other kind never becomes stored content. */
class PanelContentOwnershipSpec extends ApplyProposalSpecBase {

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def formCfg: String =
    s"""{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"quantity","control":"number"}],"submit":{"writeMode":"append"}"""

  private def create(dashboardId: String, kind: String, config: String): (StatusCode, JsObject) =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"$kind","type":"$kind","config":$config}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      (status, responseAs[String].parseJson.asJsObject)
    }

  private def patch(id: String, config: String): (StatusCode, JsObject) =
    Patch(s"/api/panels/$id", json(s"""{"config":$config}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      (status, responseAs[String].parseJson.asJsObject)
    }

  private def configOf(p: JsObject): JsObject = p.fields("config").asJsObject
  private def idOf(p: JsObject): String =
    p.fields.getOrElse("id", fail(s"no id in response: ${p.compactPrint.take(300)}")).convertTo[String]
  private def contentOf(p: JsObject): Option[JsValue] = configOf(p).fields.get("content")

  "a markdown panel" should {
    "carry literal content only in config.content, with no top-level content, and round-trip through export" in {
      val d = createDashboard("md-content")
      val (st, p) = create(d, "markdown", """{"content":"# Hello\nWorld"}""")
      st shouldBe StatusCodes.Created
      p.fields.contains("content") shouldBe false
      contentOf(p) shouldBe Some(JsString("# Hello\nWorld"))
      Get(s"/api/dashboards/$d/export").addHeader(sessionCookie) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val panels = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsObject]]
        panels should have size 1
        panels.head.fields.contains("content") shouldBe false
        contentOf(panels.head) shouldBe Some(JsString("# Hello\nWorld"))
      }
    }

    "update content on PATCH, leave it unchanged when config.content is absent, and clear it to \"\" on null" in {
      val d = createDashboard("md-patch")
      val id = idOf(create(d, "markdown", """{"content":"orig"}""")._2)
      val (s1, p1) = patch(id, """{"content":"## Updated"}""")
      s1 shouldBe StatusCodes.OK
      contentOf(p1) shouldBe Some(JsString("## Updated"))
      // absent config.content (config present but empty object)
      val (s2, p2) = patch(id, """{}""")
      s2 shouldBe StatusCodes.OK
      contentOf(p2) shouldBe Some(JsString("## Updated"))
      // explicit null clears to the empty string, never null
      val (s3, p3) = patch(id, """{"content":null}""")
      s3 shouldBe StatusCodes.OK
      contentOf(p3) shouldBe Some(JsString(""))
    }
  }

  "a text panel" should {
    "keep its own literal content in config.content" in {
      val d = createDashboard("text-content")
      val (st, p) = create(d, "text", """{"content":"Hello"}""")
      st shouldBe StatusCodes.Created
      contentOf(p) shouldBe Some(JsString("Hello"))
      p.fields.contains("content") shouldBe false
    }
  }

  "a content key sent for a non-content panel kind" should {
    "never become stored content on create (image, output, divider dropped; form rejected 400)" in {
      val d = createDashboard("other-create")
      val (si, pi) = create(d, "image", """{"imageUrl":"https://example.test/a.png","content":"x"}""")
      si shouldBe StatusCodes.Created
      contentOf(pi) shouldBe None
      val (so, po) = create(d, "output", s"""{"outputId":"$pipelineOutputId","content":"x"}""")
      so shouldBe StatusCodes.Created
      contentOf(po) shouldBe None
      val (sd, pd) = create(d, "divider", """{"content":"x"}""")
      sd shouldBe StatusCodes.Created
      contentOf(pd) shouldBe None
      val (sf, pf) = create(d, "form", formCfg + ""","content":"x"}""")
      sf shouldBe StatusCodes.BadRequest
      info(s"form create with content -> $sf ${pf.compactPrint}")
      pf.fields.get("message").map(_.convertTo[String]).getOrElse("") should include("content")
    }

    "never become stored content on update (image, output, divider, form)" in {
      val d = createDashboard("other-update")
      val img = idOf(create(d, "image", """{"imageUrl":"https://example.test/a.png"}""")._2)
      val out = idOf(create(d, "output", s"""{"outputId":"$pipelineOutputId"}""")._2)
      val div = idOf(create(d, "divider", """{}""")._2)
      val frm = idOf(create(d, "form", formCfg + "}")._2)
      Vector(img, out, div, frm).foreach { id =>
        val (st, p) = patch(id, """{"content":"x"}""")
        info(s"PATCH config.content on $id -> $st ${p.compactPrint.take(200)}")
        st shouldBe StatusCodes.OK
        contentOf(p) shouldBe None
      }
    }
  }
}
