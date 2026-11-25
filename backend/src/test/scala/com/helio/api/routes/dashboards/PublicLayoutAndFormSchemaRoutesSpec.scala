package com.helio.api.routes.dashboards

import com.helio.api.JsonProtocols
import com.helio.api.routes.panels.FormPanelRouteFixture
import com.helio.domain.model.{DashboardId, ShareToken, ShareTokenId, UserId}
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.sharing.ShareTokenRepository
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext.Implicits.global

/** HEL-1587: the public panel list carries the dashboard's stored layout (filtered to the page's panels, exact keys), and
 *  `GET /api/dashboards/:dashboardId/panels/:panelId/form-schema` serves a form's bound-field declarations behind the same
 *  sharing gate. Driven through the real `ApiRoutes` tree. The form-owner-does-not-own-the-dataset case is proven twice: here
 *  in the ordinary (BYPASSRLS) harness by the owner-scoped read, and under a NOBYPASSRLS role in `PublicFormSchemaRlsSpec`. */
class PublicLayoutAndFormSchemaRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with FormPanelRouteFixture {

  private lazy val shareTokenRepo = new ShareTokenRepository(ctx)

  private def seedToken(dashboardId: String): String = {
    val raw = "tok-" + UUID.randomUUID()
    await(shareTokenRepo.insert(ShareToken(ShareTokenId(UUID.randomUUID().toString), DashboardId(dashboardId), UserId(ownerId), TokenHashing.sha256Hex(raw), None, None, Instant.now())))
    raw
  }

  private def setLayout(dashboardId: String, layoutJson: String): Unit =
    await(ctx.withSystemContext(sqlu"""UPDATE dashboards SET layout = $layoutJson::jsonb WHERE id = $dashboardId""")): Unit

  private def item(panelId: String, x: Int, y: Int, w: Int, h: Int): String =
    s"""{"panelId":"$panelId","x":$x,"y":$y,"w":$w,"h":$h}"""

  private val bothFields = """[{"sourceField":"note","control":"text"},{"sourceField":"quantity","control":"number"}]"""

  "GET /api/dashboards/:id/panels layout" should {
    "give a share-token viewer the stored layout, filtered to the response's panels, with exactly the item keys" in {
      val dash  = seedDashboard(ownerId)
      val p1    = seedTextPanel(dash, ownerId)
      val p2    = seedTextPanel(dash, ownerId)
      val stale = UUID.randomUUID().toString
      val lay   = s"""{"lg":[${item(p1, 0, 0, 6, 5)},${item(p2, 6, 0, 6, 5)},${item(stale, 0, 9, 4, 4)}],
                      |"md":[${item(p1, 0, 0, 5, 5)},${item(p2, 5, 2, 5, 5)}],"sm":[${item(p1, 0, 0, 8, 3)}],"xs":[${item(stale, 0, 0, 2, 2)}]}""".stripMargin
      setLayout(dash, lay)
      val tok = seedToken(dash)
      Get(s"/api/dashboards/$dash/panels?token=$tok") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[JsObject]
        body.fields.keySet shouldBe Set("items", "total", "offset", "limit", "layout")
        val layout = body.fields("layout").asJsObject
        layout.fields.keySet shouldBe Set("lg", "md", "sm", "xs")
        val lg = layout.fields("lg").convertTo[Vector[JsObject]]
        lg.map(_.fields("panelId").convertTo[String]).toSet shouldBe Set(p1, p2)
        lg.foreach(_.fields.keySet shouldBe Set("panelId", "x", "y", "w", "h"))
        lg.find(_.fields("panelId") == JsString(p2)).get shouldBe item(p2, 6, 0, 6, 5).parseJson
        layout.fields("md").convertTo[Vector[JsObject]].size shouldBe 2
        layout.fields("sm").convertTo[Vector[JsObject]].map(_.fields("panelId")) shouldBe Vector(JsString(p1))
        layout.fields("xs") shouldBe JsArray.empty
        responseAs[String] should not include stale
        responseAs[String] should not include "layoutVersion"
      }
    }

    "give an anonymous viewer of a public dashboard the layout too" in {
      val dash = seedDashboard(ownerId)
      val p1   = seedTextPanel(dash, ownerId)
      setLayout(dash, s"""{"lg":[${item(p1, 1, 2, 3, 4)}],"md":[],"sm":[],"xs":[]}""")
      makePublic(dash)
      Get(s"/api/dashboards/$dash/panels") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsObject].fields("layout").asJsObject.fields("lg") shouldBe JsArray(item(p1, 1, 2, 3, 4).parseJson)
      }
    }

    "answer a caller with a wrong token the single 404, with no layout" in {
      val dash = seedDashboard(ownerId)
      val p1   = seedTextPanel(dash, ownerId)
      setLayout(dash, s"""{"lg":[${item(p1, 0, 0, 6, 5)}],"md":[],"sm":[],"xs":[]}""")
      Get(s"/api/dashboards/$dash/panels?token=wrong") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[String] should not include "layout"
        responseAs[String] should not include p1
      }
    }
  }

  "GET /api/dashboards/:dashboardId/panels/:panelId/form-schema" should {
    "return only the bound fields, in declared order, with exactly name/type/required and no default" in {
      val src  = seedDataset(ownerId, s"src-${UUID.randomUUID()}")
      val dash = seedDashboard(ownerId)
      val form = seedFormPanel(dash, ownerId, formConfig(src, bothFields))
      val tok  = seedToken(dash)
      Get(s"/api/dashboards/$dash/panels/$form/form-schema?token=$tok") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[JsObject]
        body.fields.keySet shouldBe Set("fields")
        val fields = body.fields("fields").convertTo[Vector[JsObject]]
        fields.map(_.fields("name").convertTo[String]) shouldBe Vector("quantity", "note")
        fields.foreach(_.fields.keySet shouldBe Set("name", "type", "required"))
        fields.head shouldBe """{"name":"quantity","type":"integer","required":true}""".parseJson
        val text = responseAs[String]
        text should not include "extra"
        text should not include "status"
        text should not include "def-value"
        text should not include src
      }
    }

    "serve an anonymous caller of a public dashboard" in {
      val src  = seedDataset(ownerId, s"src-${UUID.randomUUID()}")
      val dash = seedDashboard(ownerId)
      val form = seedFormPanel(dash, ownerId, formConfig(src, bothFields))
      makePublic(dash)
      Get(s"/api/dashboards/$dash/panels/$form/form-schema") ~> routes ~> check { status shouldBe StatusCodes.OK }
    }

    "answer the same 404 for a non-form panel, a panel of another dashboard, an unknown panel and a deleted dataset" in {
      val src   = seedDataset(ownerId, s"src-${UUID.randomUUID()}")
      val dash  = seedDashboard(ownerId)
      val other = seedDashboard(ownerId)
      val form  = seedFormPanel(dash, ownerId, formConfig(src, bothFields))
      val text  = seedTextPanel(dash, ownerId)
      val gone  = seedDataset(ownerId, s"gone-${UUID.randomUUID()}")
      val goneForm = seedFormPanel(dash, ownerId, formConfig(gone, bothFields))
      await(ctx.withSystemContext(sqlu"""DELETE FROM data_sources WHERE id = $gone"""))
      val tok = seedToken(dash)
      val bodies = Vector(
        s"/api/dashboards/$dash/panels/$text/form-schema?token=$tok",
        s"/api/dashboards/$other/panels/$form/form-schema?token=${seedToken(other)}",
        s"/api/dashboards/$dash/panels/${UUID.randomUUID()}/form-schema?token=$tok",
        s"/api/dashboards/$dash/panels/$goneForm/form-schema?token=$tok"
      ).map { uri =>
        Get(uri) ~> routes ~> check {
          status shouldBe StatusCodes.NotFound
          responseAs[String]
        }
      }
      bodies.distinct.size shouldBe 1
      bodies.head should include("Panel not found")
    }

    "answer a denied caller the dashboard's existing 404" in {
      val src  = seedDataset(ownerId, s"src-${UUID.randomUUID()}")
      val dash = seedDashboard(ownerId)
      val form = seedFormPanel(dash, ownerId, formConfig(src, bothFields))
      Get(s"/api/dashboards/$dash/panels/$form/form-schema") ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      Get(s"/api/dashboards/$dash/panels/$form/form-schema?token=wrong") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[String] should not include "quantity"
      }
    }

    "answer 404 and reveal nothing when the form's dataset belongs to a user other than the form's owner" in {
      // The dataset is the dashboard owner's; the form panel's owner is the editor, who does not own it.
      val foreign = seedDataset(ownerId, s"foreign-${UUID.randomUUID()}")
      val dash    = seedDashboard(ownerId)
      val form    = seedFormPanel(dash, editorId, formConfig(foreign, bothFields))
      val tok     = seedToken(dash)
      Get(s"/api/dashboards/$dash/panels/$form/form-schema?token=$tok") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[String] should not include "quantity"
        responseAs[String] should not include "note"
      }
    }

    "leave POST /api/panels/:id/submit closed to an anonymous token viewer (exact status) and append no row" in {
      val src  = seedDataset(ownerId, s"src-${UUID.randomUUID()}")
      val dash = seedDashboard(ownerId)
      val form = seedFormPanel(dash, ownerId, formConfig(src, bothFields))
      val tok  = seedToken(dash)
      Post(s"/api/panels/$form/submit?token=$tok", HttpEntity(ContentTypes.`application/json`, validValuesJson)) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
      rowCount(src) shouldBe 0
    }
  }
}
