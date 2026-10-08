package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.routes.dashboards.PublicDashboardRoutes
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository
import com.helio.services.pipelines.OutputService
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{JsonSchemaValidation, OutputHistoryApiHarness}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.net.URLEncoder
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1326: the metric value over the FULL filtered set rides on the rows responses (authenticated
 *  `GET /outputs/:id/rows` and the public `.../panels/:panelId/rows`), so a filtered metric headline
 *  does not aggregate only the first loaded page. 500 rows, 250 matching `region = east`, page
 *  limit 200: the loaded east rows and the full east set give different sums. */
class OutputFilteredMetricRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var ownerId: String             = _
  private var rowsService: OutputService  = _

  override def beforeAll(): Unit = {
    super.beforeAll()
    startHarness()
    ownerId = seedUser()
    rowsService = new OutputService(outputRepo, panelRepo, accessChecker, nodeSnapshotRepo = snapshotRepo)(harnessEc)
  }
  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private def authRoutes(): Route = new OutputRoutes(rowsService, AuthenticatedUser(UserId(ownerId)))(harnessEc).routes

  private def publicRoutes(): Route =
    new PublicDashboardRoutes(panelRepo, aclDirective, userOpt = None, outputRepo, Some(pipelineRepo), Some(snapshotRepo))(typedSystem).routes

  private def encode(json: String): String = URLEncoder.encode(json, "UTF-8")
  private val eastFilter: String = encode("""{"ops":[{"column":"region","op":"eq","value":"east"}]}""")

  private val Total     = 500
  private val eastRows  = (0 until Total).filter(_ % 2 == 0)
  /** `amount = i + 1`, so the east set sums to a number no first-200 slice reproduces. */
  private val eastSum   = eastRows.map(i => (i + 1).toDouble).sum
  private val loaded200 = eastRows.take(100).map(i => (i + 1).toDouble).sum // the east rows inside the first 200 rows

  private val schemaFields = Vector(SchemaField("region", "string"), SchemaField("amount", "integer"))

  private def metricConfig(extra: String): JsObject = s"""{$extra}""".parseJson.asJsObject

  private val sumConfig = """"fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"sum"}"""

  /** (pipelineId, outputId) with 500 rows (region east/west alternating, amount = i + 1). */
  private def seedOutput(kind: OutputKind, config: JsObject): (String, String) = {
    val (pid, _) = seedPipelineWithOutput(ownerId)
    val out = awaitDb(outputRepo.insertInternal(PipelineId(pid), None, UserId(ownerId), "o", kind, config, schemaFields, explicitRootId = Some(PipelineRootId(pid))))
    val rows = (0 until Total).map(i => JsObject("region" -> JsString(if (i % 2 == 0) "east" else "west"), "amount" -> JsNumber(i + 1)))
    awaitDb(snapshotRepo.overwriteRows(pid, None, rows, explicitRootId = Some(pid)))
    (pid, out.id.value)
  }

  private def seedPublicPanel(outputId: String): (String, String) = {
    val dashId  = UUID.randomUUID().toString
    val panelId = UUID.randomUUID().toString
    awaitDb(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($dashId, 'Dash', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}',
                       '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
    ))
    awaitDb(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                          VALUES ('dashboard', $dashId, NULL, 'viewer', now())"""))
    awaitDb(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, output_controls, owner_id)
               VALUES ($panelId, $dashId, 'P', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       'output', $outputId, '[{"id":"c1","kind":"dropdown","column":"region","label":"Region"}]'::jsonb, ${ownerId}::uuid)"""
    ))
    (dashId, panelId)
  }

  private val authSchema   = JsonSchemaValidation.compile("outputs/output-rows-response.schema.json")
  private val publicSchema = JsonSchemaValidation.compile("dashboards/public-panel-rows-response.schema.json")

  private def metricOf(raw: String): Option[JsValue] = raw.parseJson.asJsObject.fields.get("metric")

  "the sanity of the fixture" should {
    "have a full-filtered sum that differs from any first-page slice" in {
      eastSum should not be loaded200
      eastRows.size should be > 200
    }
  }

  "NodeSnapshotRepository.listFieldCells (HEL-1326 task 1.2)" should {
    "return one projected cell per matching row in row_index order, keeping absent distinct from JSON null" in {
      val (pid, _) = seedPipelineWithOutput(ownerId)
      val rows = Seq(
        JsObject("region" -> JsString("east"), "amount" -> JsNumber(3)),
        JsObject("region" -> JsString("west"), "amount" -> JsNumber(99)),
        JsObject("region" -> JsString("east"), "amount" -> JsNull),
        JsObject("region" -> JsString("east"))
      )
      awaitDb(snapshotRepo.overwriteRows(pid, None, rows, explicitRootId = Some(pid)))
      val filter = Some(NodeSnapshotRepository.FilterSpec(None, Vector.empty, Map("region" -> "east")))
      awaitDb(snapshotRepo.listFieldCells(pid, None, Some(pid), "amount", filter)) shouldBe
        Vector(JsObject("amount" -> JsNumber(3)), JsObject("amount" -> JsNull), JsObject())
      awaitDb(snapshotRepo.listFieldCells(pid, None, Some(pid), "amount", None)).size shouldBe 4
    }
  }

  "GET /outputs/:id/rows on a metric Output with a filter" should {
    "return the aggregate over ALL matching rows, not the loaded page (RED on main: no `metric` key at all)" in {
      val (_, oid) = seedOutput(OutputKind.Metric, metricConfig(sumConfig))
      Get(s"/outputs/$oid/rows?filter=$eastFilter&limit=200") ~> authRoutes() ~> check {
        status shouldBe StatusCodes.OK
        val raw  = responseAs[String]
        val body = raw.parseJson.asJsObject
        body.fields("total") shouldBe JsNumber(eastRows.size)
        body.fields("items").convertTo[Vector[JsValue]].size shouldBe 200
        val metric = body.fields("metric").asJsObject
        metric.fields.keySet shouldBe Set("field", "agg", "value")
        metric.fields("field") shouldBe JsString("amount")
        metric.fields("agg") shouldBe JsString("sum")
        metric.fields("value") shouldBe JsNumber(eastSum)
        JsonSchemaValidation.validationErrors(authSchema, raw) shouldBe Vector.empty
      }
    }

    "use the config's own aggregation (avg) over the full filtered set" in {
      val (_, oid) = seedOutput(OutputKind.Metric, metricConfig(""""fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"avg"}"""))
      Get(s"/outputs/$oid/rows?filter=$eastFilter&limit=5") ~> authRoutes() ~> check {
        responseAs[JsObject].fields("metric").asJsObject.fields("value") shouldBe JsNumber(eastSum / eastRows.size)
      }
    }

    "return an explicit `\"metric\": null` for a metric whose config resolves to no field (RED on main: key absent)" in {
      val (_, oid) = seedOutput(OutputKind.Metric, metricConfig(""""fieldMapping":{"label":"region"}"""))
      Get(s"/outputs/$oid/rows?filter=$eastFilter") ~> authRoutes() ~> check {
        val raw = responseAs[String]
        raw.parseJson.asJsObject.fields.get("metric") shouldBe Some(JsNull)
        JsonSchemaValidation.validationErrors(authSchema, raw) shouldBe Vector.empty
      }
    }

    "GUARD: omit the `metric` key when no filter applies" in {
      val (_, oid) = seedOutput(OutputKind.Metric, metricConfig(sumConfig))
      Get(s"/outputs/$oid/rows") ~> authRoutes() ~> check {
        responseAs[JsObject].fields.keySet shouldBe Set("items", "total", "offset", "limit", "materialized")
      }
      // A filter that resolves to none (empty quick term) also applies nothing.
      Get(s"/outputs/$oid/rows?filter=${encode("""{"quick":""}""")}") ~> authRoutes() ~> check {
        responseAs[JsObject].fields.keySet should not contain "metric"
      }
    }

    "GUARD: omit the `metric` key on a later page (offset > 0)" in {
      val (_, oid) = seedOutput(OutputKind.Metric, metricConfig(sumConfig))
      Get(s"/outputs/$oid/rows?filter=$eastFilter&offset=200&limit=200") ~> authRoutes() ~> check {
        responseAs[JsObject].fields.keySet should not contain "metric"
      }
    }

    "GUARD: omit the `metric` key for a non-metric Output under a filter" in {
      val (_, oid) = seedOutput(OutputKind.Table, JsObject.empty)
      Get(s"/outputs/$oid/rows?filter=$eastFilter") ~> authRoutes() ~> check {
        val raw = responseAs[String]
        metricOf(raw) shouldBe None
        JsonSchemaValidation.validationErrors(authSchema, raw) shouldBe Vector.empty
      }
    }
  }

  "GET /dashboards/:d/panels/:p/rows on a metric Output with a filter" should {
    "return the same full-filtered-set metric as the authenticated route (RED on main: no `metric` key)" in {
      val (_, oid)           = seedOutput(OutputKind.Metric, metricConfig(sumConfig))
      val (dashId, panelId)  = seedPublicPanel(oid)
      Get(s"/dashboards/$dashId/panels/$panelId/rows?filter=$eastFilter&limit=200") ~> publicRoutes() ~> check {
        status shouldBe StatusCodes.OK
        val raw  = responseAs[String]
        val body = raw.parseJson.asJsObject
        body.fields.keySet shouldBe Set("items", "total", "offset", "limit", "metric")
        body.fields("total") shouldBe JsNumber(eastRows.size)
        body.fields("metric") shouldBe JsObject("field" -> JsString("amount"), "agg" -> JsString("sum"), "value" -> JsNumber(eastSum))
        JsonSchemaValidation.validationErrors(publicSchema, raw) shouldBe Vector.empty
      }
    }

    "GUARD: an unfiltered public response keeps EXACTLY the four original keys" in {
      val (_, oid)          = seedOutput(OutputKind.Metric, metricConfig(sumConfig))
      val (dashId, panelId) = seedPublicPanel(oid)
      Get(s"/dashboards/$dashId/panels/$panelId/rows") ~> publicRoutes() ~> check {
        val raw = responseAs[String]
        raw.parseJson.asJsObject.fields.keySet shouldBe Set("items", "total", "offset", "limit")
        JsonSchemaValidation.validationErrors(publicSchema, raw) shouldBe Vector.empty
      }
    }

    "return an explicit `\"metric\": null` for a field-less metric (RED on main: key absent)" in {
      val (_, oid)          = seedOutput(OutputKind.Metric, metricConfig(""""fieldMapping":{"unit":"region"}"""))
      val (dashId, panelId) = seedPublicPanel(oid)
      Get(s"/dashboards/$dashId/panels/$panelId/rows?filter=$eastFilter") ~> publicRoutes() ~> check {
        responseAs[JsObject].fields.get("metric") shouldBe Some(JsNull)
      }
    }
  }

  // ---- HEL-1182: fieldMapping key order must never decide the metric field -------------------------------
  // jsonb stores object keys sorted by length then bytewise (`unit` < `label` < `value`), so any config
  // written `value`-first reads back with `value` LAST. D1: the `rank` column is numeric and differs from
  // `amount`, so a positional pick yields a plausible wrong sum rather than a coincidentally equal one.

  private val rankOffset = 1000
  private val rankEastSum = eastRows.map(i => (i + 1 + rankOffset).toDouble).sum

  private def seedRankedOutput(config: JsObject): (String, String) = {
    val (pid, _) = seedPipelineWithOutput(ownerId)
    val fields   = schemaFields :+ SchemaField("rank", "integer")
    val out = awaitDb(outputRepo.insertInternal(PipelineId(pid), None, UserId(ownerId), "o", OutputKind.Metric, config, fields, explicitRootId = Some(PipelineRootId(pid))))
    val rows = (0 until Total).map(i =>
      JsObject("region" -> JsString(if (i % 2 == 0) "east" else "west"), "amount" -> JsNumber(i + 1), "rank" -> JsNumber(i + 1 + rankOffset))
    )
    awaitDb(snapshotRepo.overwriteRows(pid, None, rows, explicitRootId = Some(pid)))
    (pid, out.id.value)
  }

  /** (case name, written fieldMapping JSON). The first is written `value`-first; the rest label/unit-first. */
  private val keyOrderCases = Seq(
    "value-first written"       -> """{"value":"amount","label":"rank"}""",
    "label-first written"       -> """{"label":"rank","value":"amount"}""",
    "unit-first written"        -> """{"unit":"rank","value":"amount"}""",
    "unit+label-first written"  -> """{"unit":"rank","label":"region","value":"amount"}"""
  )

  private def orderConfig(mapping: String): JsObject =
    s"""{"fieldMapping":$mapping,"aggregation":{"agg":"sum"}}""".parseJson.asJsObject

  /** D3: the config as Postgres returns it must NOT list `value` first, or the test has degraded to value-first. */
  private def assertStoredNotValueFirst(outputId: String): Unit = {
    val stored  = awaitDb(outputRepo.findConfigsByIdsInternal(Vector(outputId)))(outputId)
    val mapping = stored.fields("fieldMapping").asJsObject
    mapping.fields.keys.head should not be "value"
    mapping.fields.keySet should contain("value")
  }

  "HEL-1182 fieldMapping key order on GET /outputs/:id/rows" should {
    keyOrderCases.foreach { case (name, mapping) =>
      s"resolve the value column and its full-filtered sum ($name)" in {
        val (_, oid) = seedRankedOutput(orderConfig(mapping))
        assertStoredNotValueFirst(oid)
        Get(s"/outputs/$oid/rows?filter=$eastFilter&limit=200") ~> authRoutes() ~> check {
          status shouldBe StatusCodes.OK
          val metric = responseAs[JsObject].fields("metric").asJsObject
          metric.fields("field") shouldBe JsString("amount")
          metric.fields("value") shouldBe JsNumber(eastSum)
          metric.fields("value") should not be JsNumber(rankEastSum)
        }
      }
    }
  }

  "HEL-1182 fieldMapping key order on GET /dashboards/:d/panels/:p/rows" should {
    keyOrderCases.foreach { case (name, mapping) =>
      s"resolve the value column and its full-filtered sum ($name)" in {
        val (_, oid)          = seedRankedOutput(orderConfig(mapping))
        assertStoredNotValueFirst(oid)
        val (dashId, panelId) = seedPublicPanel(oid)
        Get(s"/dashboards/$dashId/panels/$panelId/rows?filter=$eastFilter&limit=200") ~> publicRoutes() ~> check {
          status shouldBe StatusCodes.OK
          val metric = responseAs[JsObject].fields("metric").asJsObject
          metric.fields("field") shouldBe JsString("amount")
          metric.fields("value") shouldBe JsNumber(eastSum)
          metric.fields("value") should not be JsNumber(rankEastSum)
        }
      }
    }
  }
}
