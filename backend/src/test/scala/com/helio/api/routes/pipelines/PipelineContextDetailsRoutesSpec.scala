package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository
import com.helio.testsupport.{JsonSchemaValidation, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1619: `GET /api/pipelines/context-details` over the full route tree on a non-BYPASSRLS app pool.
 *
 *  Covers the owner-scoped item set (4.1), step and latest-run-assertion parity with the per-pipeline
 *  reads (4.2), no cross-user leak under RLS (4.3), and the real body validating against the committed
 *  schema (4.4, the backend half of the client/server seam guard). */
class PipelineContextDetailsRoutesSpec extends TwoUserRlsApiFixture {

  // The fixture wires no run repository by default; run history and assertions need a real one.
  override protected def pipelineRunRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunRepository =
    new PipelineRunRepository(ctx)

  private val SchemaPath = "pipelines/pipeline-context-details-response.schema.json"

  private def getJson(path: String, user: String): JsValue =
    req(HttpMethods.GET, path, user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson
    }

  private def details(user: String): JsObject = getJson("/api/pipelines/context-details", user).asJsObject
  private def items(user: String): Vector[JsObject] = details(user).fields("items").convertTo[Vector[JsObject]]
  private def listedIds(user: String): Vector[String] =
    getJson("/api/pipelines", user).convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String])

  private def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE pipelines, data_sources CASCADE"))

  private def seedSource(owner: String, name: String): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($id::uuid, $name, 'csv', '{"path":"x.csv"}'::jsonb, $owner::uuid, now(), now())"""
    ))
    id
  }

  /** Seeds a pipeline with `rootCount` roots; returns (pipelineId, rootIds). `createdAt` orders `GET /api/pipelines`. */
  private def seedPipeline(owner: String, name: String, rootCount: Int = 1): (String, Vector[String]) = {
    val id      = UUID.randomUUID().toString
    val rootIds = Vector.fill(rootCount)(UUID.randomUUID().toString)
    val sources = rootIds.map(_ => seedSource(owner, s"$name-src"))
    await(privilegedDb.run(DBIO.seq(
      sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($id, $name, $owner::uuid, now(), now())",
      DBIO.seq(rootIds.zip(sources).zipWithIndex.map { case ((rootId, src), i) =>
        sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($rootId, $id, $src::uuid, $i)"
      }: _*)
    )))
    (id, rootIds)
  }

  /** Only a parentless step carries a root id (V98's CHECK), exactly as the API writes it. */
  private def seedStep(pipelineId: String, id: String, op: String, position: Int, parent: Option[String], root: Option[String]): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($id, $pipelineId, $position, $op, '{}', true, now(), now(), $parent, $root)"""
    ))

  private case class Failure(kind: String, field: String, severity: String, message: String)

  private def seedRun(pipelineId: String, status: String, startedAt: String, passed: Int, failures: Seq[Failure]): String = {
    val runId = UUID.randomUUID().toString
    val at    = Timestamp.from(Instant.parse(startedAt))
    await(privilegedDb.run(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, trigger_source)
                                  VALUES ($runId, $pipelineId, $status, $at, 'manual')"""))
    val rows = Seq.fill(passed)(None) ++ failures.map(Some(_))
    rows.foreach { f =>
      val (kind, field, severity, message, ok) = f match {
        case Some(x) => (x.kind, x.field, x.severity, x.message, false)
        case None    => ("not_null", "id", "error", "", true)
      }
      await(privilegedDb.run(
        sqlu"""INSERT INTO pipeline_run_assertions (id, run_id, step_id, kind, field, severity, passed, message)
               VALUES (${UUID.randomUUID().toString}, $runId, 'step', $kind, $field, $severity, $ok, $message)"""
      ))
    }
    runId
  }

  private def grantViewer(pipelineId: String, grantee: String): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', $pipelineId, $grantee::uuid, 'viewer', now())"""
    ))

  "GET /api/pipelines/context-details" should {

    "respond 401 without a credential, like GET /api/pipelines" in {
      Get("/api/pipelines/context-details") ~> routes ~> check { status shouldBe StatusCodes.Unauthorized }
      Get("/api/pipelines") ~> routes ~> check { status shouldBe StatusCodes.Unauthorized }
    }

    "return exactly the owner-scoped pipelines GET /api/pipelines lists, in the same order; a viewer-granted pipeline is absent" in {
      reset()
      seedPipeline(userA, "A1")
      seedPipeline(userA, "A2")
      val (bPipeline, _) = seedPipeline(userB, "B1")
      grantViewer(bPipeline, userA)

      val ids = items(userA).map(_.fields("pipelineId").convertTo[String])
      ids should have size 2
      ids shouldBe listedIds(userA)
      ids should not contain bPipeline
      items(userB).map(_.fields("pipelineId").convertTo[String]) shouldBe listedIds(userB)
    }

    "include a pipeline with no steps and no runs as steps: [] with no latestRunAssertions key" in {
      reset()
      val (id, _) = seedPipeline(userA, "Empty")
      val item    = items(userA).find(_.fields("pipelineId") == JsString(id)).get
      item.fields("steps") shouldBe JsArray()
      item.fields.keySet should not contain "latestRunAssertions"
    }

    "return steps equal to GET /:id/steps (branched, multi-root) and latestRunAssertions equal to run-history[0]" in {
      reset()
      val (pid, Vector(rootA, rootB)) = seedPipeline(userA, "Branched", rootCount = 2)
      val Seq(s1, s2, s3, s4)         = Seq.fill(4)(UUID.randomUUID().toString)
      seedStep(pid, s1, "filter", 0, None, Some(rootA))
      seedStep(pid, s2, "sort", 0, Some(s1), None)
      seedStep(pid, s3, "limit", 1, Some(s1), None) // a branch: two children of s1
      seedStep(pid, s4, "select", 0, None, Some(rootB))
      seedRun(pid, "succeeded", "2026-10-01T10:00:00Z", 3, Seq(Failure("range", "score", "warn", "old")))
      // newest run is a dry run with two failures: history[0] is the latest of ANY status
      seedRun(pid, "dry_run", "2026-10-02T10:00:00Z", 2, Seq(
        Failure("not_null", "amount", "error", "amount is null"),
        Failure("range", "score", "warn", "score above 100")
      ))
      val (never, _) = seedPipeline(userA, "Never run")

      val all  = items(userA)
      val item = all.find(_.fields("pipelineId") == JsString(pid)).get
      item.fields("steps") shouldBe getJson(s"/api/pipelines/$pid/steps", userA)
      item.fields("steps").convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String]).toSet shouldBe Set(s1, s2, s3, s4)

      val history = getJson(s"/api/pipelines/$pid/run-history", userA).convertTo[Vector[JsObject]]
      history should have size 2
      history.head.fields("status") shouldBe JsString("dry_run")
      history.head.fields("assertions").asJsObject.fields("failures").convertTo[Vector[JsValue]] should have size 2
      item.fields("latestRunAssertions") shouldBe history.head.fields("assertions")

      val neverItem = all.find(_.fields("pipelineId") == JsString(never)).get
      neverItem.fields.keySet should not contain "latestRunAssertions"
    }

    "never expose another user's pipelines, steps or assertions on a non-BYPASSRLS pool" in {
      reset()
      val (aPipeline, Vector(aRoot)) = seedPipeline(userA, "A secret")
      val aStep                      = UUID.randomUUID().toString
      seedStep(aPipeline, aStep, "filter", 0, None, Some(aRoot))
      seedRun(aPipeline, "succeeded", "2026-10-02T10:00:00Z", 1, Seq(Failure("not_null", "ssn", "error", "A-ONLY-MESSAGE")))
      val (bPipeline, _) = seedPipeline(userB, "B own")

      val bBody = details(userB).compactPrint
      items(userB).map(_.fields("pipelineId").convertTo[String]) shouldBe Vector(bPipeline)
      bBody should not include aPipeline
      bBody should not include aStep
      bBody should not include "A-ONLY-MESSAGE"
      // and A still sees theirs, so the absence above is not an empty-database artifact
      details(userA).compactPrint should include("A-ONLY-MESSAGE")
      // user C owns nothing
      items(userC) shouldBe Vector.empty
    }

    "produce a body that validates against the committed schema (seam guard, backend half)" in {
      reset()
      val (pid, Vector(rootA)) = seedPipeline(userA, "Schema")
      val sid                  = UUID.randomUUID().toString
      seedStep(pid, sid, "filter", 0, None, Some(rootA))
      seedStep(pid, UUID.randomUUID().toString, "sort", 0, Some(sid), None)
      seedRun(pid, "succeeded", "2026-10-02T10:00:00Z", 2, Seq(Failure("range", "score", "warn", "high"), Failure("unique", "id", "error", "dup")))
      seedPipeline(userA, "Never run")

      val schema = JsonSchemaValidation.compile(SchemaPath)
      val body   = details(userA)
      JsonSchemaValidation.validationErrors(schema, body.compactPrint) shouldBe empty
      body.fields("items").convertTo[Vector[JsValue]] should have size 2

      // The guard can fail: renaming one key (envelope and item level) is rejected by the same schema.
      val renamedEnvelope = JsObject("results" -> body.fields("items"))
      JsonSchemaValidation.validationErrors(schema, renamedEnvelope.compactPrint) should not be empty
      val renamedItemKey = JsObject("items" -> JsArray(body.fields("items").convertTo[Vector[JsObject]].map { i =>
        JsObject(i.fields - "pipelineId" + ("pipeline_id" -> i.fields("pipelineId")))
      }))
      JsonSchemaValidation.validationErrors(schema, renamedItemKey.compactPrint) should not be empty
    }
  }
}
