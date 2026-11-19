package com.helio.api.routes.dashboards

import com.helio.testsupport.{JsonSchemaValidation, OutputHistoryFixtures, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.{Files, Paths}
import java.util.UUID

/** HEL-1785 seam: helio-mcp's `get_dashboard` reads a viewer grantee's panels from `GET /api/dashboards/:id/panels`
 *  and maps each item to the export's panel shape. This spec pins the SHAPE of that real response (key names and JSON
 *  types, recursively, values ignored) to `shared-test-fixtures/dashboards/viewer-panels-response.json`, which the
 *  helio-mcp tests read. A change to the route's panel fields (sibling HEL-1780 owns the route) turns this red here,
 *  not silently in the MCP client. */
class SharedDashboardPanelsSeamSpec extends TwoUserRlsApiFixture with OutputHistoryFixtures {

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private def fixture: JsValue = {
    val dir = JsonSchemaValidation.schemaFile("workspace/workspace-context.schema.json").getParentFile.getParentFile.getParentFile
    Files.readString(Paths.get(dir.getPath, "shared-test-fixtures", "dashboards", "viewer-panels-response.json")).parseJson
  }

  /** `{key -> type}` recursively; arrays by their first element. */
  private def shape(v: JsValue): JsValue = v match {
    case JsObject(f) => JsObject(f.map { case (k, x) => k -> shape(x) })
    case JsArray(e)  => JsArray(e.headOption.map(shape).toVector)
    case JsString(_) => JsString("string")
    case JsNumber(_) => JsString("number")
    case JsBoolean(_) => JsString("boolean")
    case JsNull      => JsString("null")
  }

  "GET /api/dashboards/:id/panels for a viewer grantee" should {
    "have the shape helio-mcp's viewer branch maps from (the shared fixture)" in {
      await(privilegedDb.run(sqlu"TRUNCATE dashboards, pipelines, data_sources, resource_permissions CASCADE"))
      val (_, outputId) = seedPipelineWithOutput(userA, "table")
      val dash = seedDashboard(userA, "Shared board")
      val textId, outId = UUID.randomUUID().toString
      await(privilegedDb.run(DBIO.seq(
        sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
               VALUES ($textId, $dash, 'Notes', $userA, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}', 'text', $userA::uuid)""",
        sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
               VALUES ($outId, $dash, 'Bound', $userA, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}', 'output', $outputId, $userA::uuid)""",
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $dash, $userB::uuid, 'viewer', now())"""
      )))
      req(HttpMethods.GET, s"/api/dashboards/$dash/panels?limit=500", userB) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[String].parseJson.asJsObject
        println(s"[HEL-1785 SEAM] viewer /panels body: ${body.compactPrint}")
        body.fields.keySet should contain allOf ("items", "total")
        val items = body.fields("items").asInstanceOf[JsArray].elements
        items.size shouldBe 2
        val expected = fixture.asJsObject
        // Items are unordered and `config` is keyed by kind, so compare per `type`, plus the envelope's own keys.
        def byType(v: JsValue) = v.asJsObject.fields("items").asInstanceOf[JsArray].elements
          .map(i => i.asJsObject.fields("type").convertTo[String] -> shape(i)).toMap
        byType(body) shouldBe byType(expected)
        shape(JsObject(body.fields - "items")) shouldBe shape(JsObject(expected.asJsObject.fields - "items"))
        // The fields the MCP mapping copies must be present on every real item.
        items.foreach(i => i.asJsObject.fields.keySet should contain allOf ("id", "title", "type", "appearance", "config"))
      }
    }
  }
}
