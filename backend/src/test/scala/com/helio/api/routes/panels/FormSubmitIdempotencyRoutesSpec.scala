package com.helio.api.routes.panels

import com.helio.api.JsonProtocols
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.io.Source

/** HEL-1175: `POST /api/panels/:id/submit` with an optional `submitKey`. A same-key re-send by the same submitter through
 *  the same panel appends nothing and replays the original row (`200`); a different submitter or panel is `409`; a
 *  malformed key is `400`; no key behaves exactly as before. Driven through the real HTTP route on a real database. */
class FormSubmitIdempotencyRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with FormPanelRouteFixture {

  private def newKey(): String = UUID.randomUUID().toString

  private def body(key: Option[String], quantity: Int = 3): String =
    key match {
      case Some(k) => s"""{"values":{"quantity":$quantity,"note":"hello"},"submitKey":"$k"}"""
      case None    => s"""{"values":{"quantity":$quantity,"note":"hello"}}"""
    }

  /** A form on the owner's source; `role` optionally grants a second user on the dashboard. */
  private def sharedForm(role: Option[(String, String)] = None) = {
    val src         = seedDataset(ownerId, s"src-${UUID.randomUUID()}")
    val dashboardId = seedDashboard(ownerId)
    role.foreach { case (userId, r) => grant(dashboardId, userId, r) }
    val panelId = seedFormPanel(dashboardId, ownerId, formConfig(src, validFieldsJson))
    (src, dashboardId, panelId)
  }

  private def rowIds(body: String): Vector[String] =
    body.parseJson.asJsObject.fields("rows").convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String])

  private def rowKeys(body: String): Vector[Set[String]] =
    body.parseJson.asJsObject.fields("rows").convertTo[Vector[JsObject]].map(_.fields.keySet)

  private def appendAuditCount(panelId: String): Int =
    await(ctx.withSystemContext(
      sql"""SELECT count(*) FROM audit_events WHERE action = 'data_source.rows.append' AND metadata->>'panelId' = $panelId""".as[Int].head
    ))

  "a keyed JSON submit" should {
    "append exactly one row for a same-key re-send and replay the original row with 200" in {
      val (src, _, panelId) = sharedForm()
      val key               = newKey()
      val first = submit(panelId, body(Some(key))) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[String]
      }
      val second = submit(panelId, body(Some(key))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String]
      }
      rowCount(src) shouldBe 1
      rowIds(second) shouldBe rowIds(first)
      rowKeys(second) shouldBe Vector(Set("id", "seq", "updatedAt"))
      second.parseJson.asJsObject.fields("deniedPipelines") shouldBe JsArray()
    }

    "answer a counter lost-ack re-send with the original row, one row in the dataset" in {
      val src         = seedDataset(ownerId, s"src-counter-${UUID.randomUUID()}", counterSchemaJson)
      val dashboardId = seedDashboard(ownerId)
      val panelId     = seedFormPanel(dashboardId, ownerId, formConfig(src, """[{"sourceField":"delta","control":"counter"}]"""))
      val key         = newKey()
      val payload     = s"""{"values":{"delta":1},"submitKey":"$key"}"""
      submit(panelId, payload) ~> routes ~> check { status shouldBe StatusCodes.Created }
      submit(panelId, payload) ~> routes ~> check { status shouldBe StatusCodes.OK }
      rowCount(src) shouldBe 1
    }

    "still append for two different keys" in {
      val (src, _, panelId) = sharedForm()
      submit(panelId, body(Some(newKey()))) ~> routes ~> check { status shouldBe StatusCodes.Created }
      submit(panelId, body(Some(newKey()))) ~> routes ~> check { status shouldBe StatusCodes.Created }
      rowCount(src) shouldBe 2
    }

    "replay with 200 even when the dataset's shape changed since the original (the lookup comes first)" in {
      val src         = seedDataset(ownerId, s"src-counter-${UUID.randomUUID()}", counterSchemaJson)
      val dashboardId = seedDashboard(ownerId)
      val panelId     = seedFormPanel(dashboardId, ownerId, formConfig(src, """[{"sourceField":"delta","control":"counter"}]"""))
      val key         = newKey()
      val payload     = s"""{"values":{"delta":1},"submitKey":"$key"}"""
      submit(panelId, payload) ~> routes ~> check { status shouldBe StatusCodes.Created }
      replaceSchema(src, """[{"name":"delta","type":"integer","required":true}]""")
      submit(panelId, payload) ~> routes ~> check { status shouldBe StatusCodes.OK }
      // The same shape change refuses a NEW keyed submit, so the 200 above is the lookup, not a passing build.
      submit(panelId, s"""{"values":{"delta":1},"submitKey":"${newKey()}"}""") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      rowCount(src) shouldBe 1
    }

    "record one audit event for the append and none for the replay" in {
      val (_, _, panelId) = sharedForm()
      val key             = newKey()
      submit(panelId, body(Some(key))) ~> routes ~> check { status shouldBe StatusCodes.Created }
      val deadline = System.currentTimeMillis() + 5000
      while (appendAuditCount(panelId) < 1 && System.currentTimeMillis() < deadline) Thread.sleep(50)
      submit(panelId, body(Some(key))) ~> routes ~> check { status shouldBe StatusCodes.OK }
      Thread.sleep(500)
      appendAuditCount(panelId) shouldBe 1
    }

    "replay to a non-owner editor without a seq" in {
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"))
      val key               = newKey()
      submit(panelId, body(Some(key)), editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        rowKeys(responseAs[String]) shouldBe Vector(Set("id", "updatedAt"))
      }
      submit(panelId, body(Some(key)), editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        rowKeys(responseAs[String]) shouldBe Vector(Set("id", "updatedAt"))
      }
      rowCount(src) shouldBe 1
    }

    "refuse a different submitter's same-key submit with 409 and reveal no row" in {
      val (src, _, panelId) = sharedForm(Some(editorId -> "editor"))
      val key               = newKey()
      val ownersRowId = submit(panelId, body(Some(key))) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        rowIds(responseAs[String]).head
      }
      submit(panelId, body(Some(key)), editorToken) ~> routes ~> check {
        status shouldBe StatusCodes.Conflict
        val text = responseAs[String]
        text should not include ownersRowId
        text.parseJson.asJsObject.fields.keySet should not contain "rows"
        text should not include "seq"
      }
      rowCount(src) shouldBe 1
    }

    "refuse the same submitter's same-key submit through a different panel with 409" in {
      val (src, dashboardId, panelId) = sharedForm()
      val otherPanel                  = seedFormPanel(dashboardId, ownerId, formConfig(src, validFieldsJson))
      val key                         = newKey()
      submit(panelId, body(Some(key))) ~> routes ~> check { status shouldBe StatusCodes.Created }
      submit(otherPanel, body(Some(key))) ~> routes ~> check { status shouldBe StatusCodes.Conflict }
      rowCount(src) shouldBe 1
    }
  }

  "the shared seam fixture (the body the web client sends)" should {
    "be read by the server under the same field name: the second post replays" in {
      val fixture = Source.fromFile("../shared-test-fixtures/panels/form-submit-keyed-request.json").mkString
      val (src, _, panelId) = sharedForm()
      submit(panelId, fixture) ~> routes ~> check { status shouldBe StatusCodes.Created }
      submit(panelId, fixture) ~> routes ~> check { status shouldBe StatusCodes.OK }
      rowCount(src) shouldBe 1
    }
  }

  "an unkeyed or malformed-key submit" should {
    "append one row per submit and answer 201 each time, exactly as before" in {
      val (src, _, panelId) = sharedForm()
      submit(panelId, body(None)) ~> routes ~> check { status shouldBe StatusCodes.Created }
      submit(panelId, body(None)) ~> routes ~> check { status shouldBe StatusCodes.Created }
      rowCount(src) shouldBe 2
    }

    Seq(
      "a non-UUID string"        -> "\"not-a-uuid\"",
      "a number"                 -> "42",
      "null"                     -> "null",
      "a short-form UUID string" -> "\"1-1-1-1-1\"",
      "an empty string"          -> "\"\""
    ).foreach { case (label, json) =>
      s"reject $label as a submitKey with 400 and write nothing" in {
        val (src, _, panelId) = sharedForm()
        submit(panelId, s"""{"values":{"quantity":3,"note":"hello"},"submitKey":$json}""") ~> routes ~> check {
          status shouldBe StatusCodes.BadRequest
        }
        rowCount(src) shouldBe 0
      }
    }

    "still reject an unknown top-level key" in {
      val (src, _, panelId) = sharedForm()
      submit(panelId, s"""{"values":{"quantity":3,"note":"hello"},"submitKey":"${newKey()}","dataSourceId":"x"}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      rowCount(src) shouldBe 0
    }
  }
}
