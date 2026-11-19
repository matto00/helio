package com.helio.api.routes.panels

import com.helio.api.JsonProtocols
import com.helio.services.dashboards.DashboardAccessMessages
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.{Files, Paths}
import java.util.UUID

/** `GET /api/panels/:id/form-schema`: only the declarations of the fields the form binds, for a dashboard owner or
 *  editor. The counter response is also the fixture the web client's tests read, so the two sides cannot drift. */
class FormSchemaRouteSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with FormPanelRouteFixture {

  private def fieldNames(body: String): Vector[String] =
    body.parseJson.asJsObject.fields("fields").convertTo[Vector[JsObject]].map(_.fields("name").convertTo[String])

  private def form(role: Option[(String, String)], fieldsJson: String, schemaJson: String = declaredSchemaJson) = {
    val src         = seedDataset(ownerId, s"src-${UUID.randomUUID()}", schemaJson)
    val dashboardId = seedDashboard(ownerId)
    role.foreach { case (userId, r) => grant(dashboardId, userId, r) }
    (src, dashboardId, seedFormPanel(dashboardId, ownerId, formConfig(src, fieldsJson)))
  }

  "GET /api/panels/:id/form-schema" should {
    "return only the bound fields' declarations, in the dataset's declared order" in {
      val (_, _, panelId) = form(Some(editorId -> "editor"),
        """[{"sourceField":"note","control":"text"},{"sourceField":"quantity","control":"number"}]""")
      getFormSchema(panelId, editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        fieldNames(responseAs[String]) shouldBe Vector("quantity", "note")
        responseAs[String] should not include "extra"
        responseAs[String] should not include "status"
      }
    }

    "serve the dashboard owner and the form's owner" in {
      val (_, _, panelId) = form(None, """[{"sourceField":"quantity","control":"number"}]""")
      getFormSchema(panelId, ownerToken) ~> routes ~> check { status shouldBe StatusCodes.OK }
    }

    "answer a viewer 403 with the view-only message" in {
      val (_, _, panelId) = form(Some(viewerId -> "viewer"), """[{"sourceField":"quantity","control":"number"}]""")
      getFormSchema(panelId, viewerToken) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[String] should include(DashboardAccessMessages.ViewOnly)
      }
    }

    "answer a signed-in stranger 404, on a public dashboard too" in {
      val (_, dashboardId, panelId) = form(None, """[{"sourceField":"quantity","control":"number"}]""")
      getFormSchema(panelId, strangerToken) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      makePublic(dashboardId)
      getFormSchema(panelId, strangerToken) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
    }

    "answer 400 for a panel that is not a form" in {
      val dashboardId = seedDashboard(ownerId)
      getFormSchema(seedTextPanel(dashboardId, ownerId), ownerToken) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
    }

    "answer 404 once the bound source is deleted" in {
      val (src, _, panelId) = form(None, """[{"sourceField":"quantity","control":"number"}]""")
      await(ctx.withSystemContext(sqlu"""DELETE FROM data_sources WHERE id = $src"""))
      getFormSchema(panelId, ownerToken) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
    }

    "re-check access on every request" in {
      val (_, dashboardId, panelId) = form(Some(editorId -> "editor"), """[{"sourceField":"quantity","control":"number"}]""")
      getFormSchema(panelId, editorToken) ~> routes ~> check { status shouldBe StatusCodes.OK }
      changeRole(dashboardId, editorId, "viewer")
      getFormSchema(panelId, editorToken) ~> routes ~> check { status shouldBe StatusCodes.Forbidden }
    }

    "match the shared counter fixture the web client reads" in {
      val (_, _, panelId) = form(Some(editorId -> "editor"), """[{"sourceField":"delta","control":"counter"}]""", counterSchemaJson)
      val fixture = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/panels/form-schema-counter.json")))
      getFormSchema(panelId, editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson shouldBe fixture
      }
    }
  }
}
