package com.helio.api.routes.panels

import com.helio.api.JsonProtocols
import com.helio.services.dashboards.DashboardAccessMessages
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID

/** `POST /api/panels/:id/submit` for dashboard editors: who is admitted, what the response and the 400 bodies reveal to
 *  a submitter who is not the form's owner, and that a counter submit against a dataset that lost its counter shape
 *  writes nothing. */
class FormSubmitEditorRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with FormPanelRouteFixture {

  private val genericMessage  = "This form no longer matches its dataset. Ask its owner to update it."
  private val rowLimitMessage = "This form's dataset can't accept more entries"

  private def sharedForm(role: Option[(String, String)], fieldsJson: String = validFieldsJson, schemaJson: String = declaredSchemaJson) = {
    val src         = seedDataset(ownerId, s"src-${UUID.randomUUID()}", schemaJson)
    val dashboardId = seedDashboard(ownerId)
    role.foreach { case (userId, r) => grant(dashboardId, userId, r) }
    val panelId = seedFormPanel(dashboardId, ownerId, formConfig(src, fieldsJson))
    (src, dashboardId, panelId)
  }

  private def rowKeys(body: String): Vector[Set[String]] =
    body.parseJson.asJsObject.fields("rows").convertTo[Vector[JsObject]].map(_.fields.keySet)

  private def auditEvents(actor: String, panelId: String): Vector[JsObject] = {
    val deadline = System.currentTimeMillis() + 5000
    def read() = await(ctx.withSystemContext(
      sql"""SELECT metadata::text FROM audit_events
            WHERE action = 'data_source.rows.append' AND actor_user_id = ${actor}::uuid AND metadata->>'panelId' = $panelId""".as[String]
    )).map(_.parseJson.asJsObject).toVector
    var found = read()
    while (found.isEmpty && System.currentTimeMillis() < deadline) { Thread.sleep(50); found = read() }
    found
  }

  "POST /api/panels/:id/submit — admission" should {
    "admit an editor, write one row on the owner's source and omit seq from every returned row" in {
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"))
      submit(panelId, validValuesJson, editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        rowKeys(responseAs[String]) shouldBe Vector(Set("id", "updatedAt"))
      }
      rowCount(src) shouldBe 1
    }

    "still return seq to the form's owner" in {
      val (_, _, panelId) = sharedForm(None)
      submit(panelId, validValuesJson) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        rowKeys(responseAs[String]) shouldBe Vector(Set("id", "seq", "updatedAt"))
      }
    }

    "refuse a viewer with the view-only message and write nothing" in {
      val (src, _, panelId) = sharedForm(Some(viewerId -> "viewer"))
      submit(panelId, validValuesJson, viewerToken) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[String] should include(DashboardAccessMessages.ViewOnly)
      }
      rowCount(src) shouldBe 0
    }

    "answer 404 to a signed-in stranger and write nothing" in {
      val (src, _, panelId) = sharedForm(None)
      submit(panelId, validValuesJson, strangerToken) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      rowCount(src) shouldBe 0
    }

    "answer 404 to a signed-in stranger on a PUBLIC dashboard" in {
      val (src, dashboardId, panelId) = sharedForm(None)
      makePublic(dashboardId)
      submit(panelId, validValuesJson, strangerToken) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      rowCount(src) shouldBe 0
    }

    "refuse an editor on the next submit once they were downgraded to viewer" in {
      val (src, dashboardId, panelId) = sharedForm(Some(editorId -> "editor"))
      submit(panelId, validValuesJson, editorToken) ~> routes ~> check { status shouldBe StatusCodes.Created }
      changeRole(dashboardId, editorId, "viewer")
      submit(panelId, validValuesJson, editorToken) ~> routes ~> check { status shouldBe StatusCodes.Forbidden }
      rowCount(src) shouldBe 1
    }

    "let the dashboard owner submit a form an editor created, onto the editor's source, with no seq" in {
      val editorSource = seedDataset(editorId, "editor-src")
      val dashboardId  = seedDashboard(ownerId)
      grant(dashboardId, editorId, "editor")
      val panelId = seedFormPanel(dashboardId, editorId, formConfig(editorSource, validFieldsJson))
      submit(panelId, validValuesJson, ownerToken) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        rowKeys(responseAs[String]) shouldBe Vector(Set("id", "updatedAt"))
      }
      rowCount(editorSource) shouldBe 1
    }

    "answer 404 and write nothing when the form's owner does not own its bound source (a duplicated binding)" in {
      val ownersSource = seedDataset(ownerId, "owners-src")
      val editorsDash  = seedDashboard(editorId)
      val panelId      = seedFormPanel(editorsDash, editorId, formConfig(ownersSource, validFieldsJson))
      submit(panelId, validValuesJson, editorToken) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      rowCount(ownersSource) shouldBe 0
    }

    "admit an editor's file-attached submit" in {
      val fileSchema =
        """[{"name":"quantity","type":"integer","required":true},{"name":"photo","type":"binary-ref","required":false}]"""
      val fields = """[{"sourceField":"quantity","control":"number","required":true},{"sourceField":"photo","control":"file"}]"""
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"), fields, fileSchema)
      val before = writtenPaths.size
      submitMultipart(panelId, """{"quantity":3}""", Seq(("photo", "report.pdf", "bytes".getBytes("UTF-8"))), editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        rowKeys(responseAs[String]) shouldBe Vector(Set("id", "updatedAt"))
      }
      rowCount(src) shouldBe 1
      writtenPaths.size shouldBe before + 1
    }
  }

  "POST /api/panels/:id/submit — audit" should {
    "record the editor as the actor with the panel and the source owner" in {
      val (_, _, panelId) = sharedForm(Some(editorId -> "editor"))
      submit(panelId, validValuesJson, editorToken) ~> routes ~> check { status shouldBe StatusCodes.Created }
      val events = auditEvents(editorId, panelId)
      events should have size 1
      events.head.fields("sourceOwnerId") shouldBe JsString(ownerId)
    }
  }

  "POST /api/panels/:id/submit — what a non-owner is told" should {
    val strictSchema =
      """[{"name":"quantity","type":"integer","required":true},{"name":"must","type":"string","required":true}]"""
    val quantityOnly = """[{"sourceField":"quantity","control":"number","required":true}]"""

    "name no unconfigured required field, while the owner still gets the precise error" in {
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"), quantityOnly, strictSchema)
      submit(panelId, """{"values":{"quantity":3}}""", editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val body = responseAs[String]
        body.parseJson.asJsObject.fields("message") shouldBe JsString(genericMessage)
        body should not include "must"
      }
      submit(panelId, """{"values":{"quantity":3}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("must")
      }
      rowCount(src) shouldBe 0
    }

    "give byte-equal 400 bodies for a declared-but-unconfigured key and an undeclared key" in {
      val (_, _, panelId) = sharedForm(Some(editorId -> "editor"))
      val declaredExtra   = submit(panelId, """{"values":{"quantity":3,"note":"x","extra":"y"}}""", editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest; responseAs[String]
      }
      val undeclared = submit(panelId, """{"values":{"quantity":3,"note":"x","zzz":"y"}}""", editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest; responseAs[String]
      }
      declaredExtra shouldBe undeclared
      declaredExtra should not include "extra"
    }

    "keep the field errors of configured fields" in {
      val (_, _, panelId) = sharedForm(Some(editorId -> "editor"))
      submit(panelId, """{"values":{"quantity":3}}""", editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsObject]].map(_.fields("field")) shouldBe Vector(JsString("note"))
      }
    }

    "say nothing of a file-attached submit's unconfigured required field, and store no file" in {
      val fileSchema =
        """[{"name":"quantity","type":"integer","required":true},{"name":"must","type":"string","required":true},{"name":"photo","type":"binary-ref","required":false}]"""
      val fields = """[{"sourceField":"quantity","control":"number","required":true},{"sourceField":"photo","control":"file"}]"""
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"), fields, fileSchema)
      val before = writtenPaths.size
      submitMultipart(panelId, """{"quantity":3}""", Seq(("photo", "report.pdf", "bytes".getBytes("UTF-8"))), editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val body = responseAs[String]
        body.parseJson.asJsObject.fields("message") shouldBe JsString(genericMessage)
        body should not include "must"
      }
      writtenPaths.size shouldBe before
      rowCount(src) shouldBe 0
    }

    "state no row-limit number to an editor, but keep it for the owner" in {
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"))
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at)
               SELECT gen_random_uuid()::text, $src, g, '[1,"x",null,null]'::jsonb, now(), now() FROM generate_series(1, 500) g"""
      ))
      submit(panelId, validValuesJson, editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].parseJson.asJsObject.fields("message") shouldBe JsString(rowLimitMessage)
      }
      submit(panelId, validValuesJson) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("500")
      }
    }
  }

  "POST /api/panels/:id/submit — counter shape" should {
    val counterFields = """[{"sourceField":"delta","control":"counter"}]"""
    val renamed = """[{"name":"delta","type":"integer","required":true},{"name":"happened","type":"timestamp","required":true},{"name":"value","type":"integer","required":false}]"""
    val noValue = """[{"name":"delta","type":"integer","required":true},{"name":"occurred_at","type":"timestamp","required":true}]"""

    "write nothing and give an editor the generic message when occurred_at was renamed, and give the owner the precise one" in {
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"), counterFields, renamed)
      submit(panelId, """{"values":{"delta":1}}""", editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].parseJson.asJsObject.fields("message") shouldBe JsString(genericMessage)
      }
      submit(panelId, """{"values":{"delta":1}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("occurred_at")
      }
      rowCount(src) shouldBe 0
    }

    "refuse a counter submit when the dataset dropped value" in {
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"), counterFields, noValue)
      submit(panelId, """{"values":{"delta":1}}""", editorToken) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      submit(panelId, """{"values":{"delta":1}}""") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      rowCount(src) shouldBe 0
    }

    "still accept an editor's counter submit against an intact counter dataset" in {
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"), counterFields, counterSchemaJson)
      submit(panelId, """{"values":{"delta":1}}""", editorToken) ~> routes ~> check { status shouldBe StatusCodes.Created }
      rowCount(src) shouldBe 1
    }
  }
}
