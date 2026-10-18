package com.helio.api.routes.sources

import com.helio.testsupport.{DatasetRowsTestSupport, JsonSchemaValidation, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, HttpResponse, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.{Files, Paths}
import java.util.UUID

/** HEL-1648: `GET /api/data-sources/:id/sample?pipelineId=P` over the full route tree on the restricted (non-BYPASSRLS)
 *  application role. An editor grantee (B) of a pipeline owned by A may sample exactly the sources P uses; EVERY other
 *  case is the byte-identical 404 an unknown source id gets (status, body and content type). Datasets only: the
 *  fixture's stub file system turns an uploaded CSV into a post-authorization "Data file not found" 404 that would
 *  masquerade as a denial (standing constraint C1).
 *
 *  Request budget: one limiter per spec, 30 per user per window. B makes well under 30 requests across the
 *  functional tests; the limiter proof uses user C only, which no other test sends requests as. */
class SourceScopedSampleRoutesSpec extends TwoUserRlsApiFixture {

  private val schema = JsonSchemaValidation.compile("sources/source-sample-response.schema.json")

  /** The scoped-request URL shape the client builds, shared with the frontend's seam test. */
  private val urlTemplate: String =
    Files.readString(Paths.get("../shared-test-fixtures/source-sample/scoped-sample-request-url.json")).parseJson.asJsObject
      .fields("template").convertTo[String]

  private def scopedPath(source: String, pipeline: String): String =
    urlTemplate.replace("{sourceId}", source).replace("{pipelineId}", pipeline)

  private def seedDataset(owner: String, name: String): String = {
    val id = UUID.randomUUID().toString
    val payload = JsObject(
      "columns" -> JsArray(JsObject("name" -> JsString("n"), "type" -> JsString("float")), JsObject("name" -> JsString("label"), "type" -> JsString("string"))),
      "rows"    -> JsArray(Vector(JsArray(JsNumber(1), JsString(s"secret-$name-1")), JsArray(JsNumber(2), JsString(s"secret-$name-2"))))
    )
    await(privilegedDb.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($id, $name, 'dataset', '{}', $owner::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActions(id, payload)
    )))
    id
  }

  /** A pipeline owned by A with the given root sources (position order). */
  private def seedPipeline(roots: String*): String = {
    val pid = UUID.randomUUID().toString
    val actions = Vector[DBIO[Int]](
      sqlu"INSERT INTO pipelines (id, name, created_at, updated_at, owner_id) VALUES ($pid, 'scoped', now(), now(), $userA::uuid)"
    ) ++ roots.zipWithIndex.map { case (src, pos) =>
      val rid = rootIdOf(pid, pos)
      sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position, created_at) VALUES ($rid, $pid, $src, $pos, now())"
    }
    await(privilegedDb.run(DBIO.sequence(actions).transactionally))
    pid
  }

  private def rootIdOf(pid: String, pos: Int) = s"$pid-root$pos"

  /** A root-level `limit` step on the first root, then a child step `op` with `config` (e.g. a join whose secondary is a source). */
  private def addStep(pid: String, op: String, config: String, enabled: Boolean = true): String = {
    val id = UUID.randomUUID().toString
    val parent = s"$pid-t1"
    val ensureTrunk =
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, enabled, parent_step_id, root_id)
             VALUES ($parent, $pid, 0, 'limit', '{"count":1}', now(), now(), true, NULL, ${rootIdOf(pid, 0)})
             ON CONFLICT (id) DO NOTHING"""
    val step =
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, enabled, parent_step_id, root_id)
             VALUES ($id, $pid, 0, $op, $config, now(), now(), $enabled, $parent, NULL)"""
    await(privilegedDb.run(DBIO.seq(ensureTrunk, step).transactionally))
    id
  }

  private def joinOn(source: String)   = s"""{"joinKey":"n","joinType":"inner","secondaryInput":{"kind":"source","dataSourceId":"$source"}}"""
  private def unionOn(source: String)  = s"""{"mode":"byName","secondaryInput":{"kind":"source","dataSourceId":"$source"}}"""
  private def lookupOn(source: String) = s"""{"secondaryInput":{"kind":"source","dataSourceId":"$source"},"sourceKey":"n","lookupKey":"n","columns":["label"]}"""

  private def grant(pid: String, user: String, role: String): Unit =
    await(privilegedDb.run(
      sqlu"INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role) VALUES ('pipeline', $pid, $user::uuid, $role)"
    ))

  private def revoke(pid: String, user: String): Unit =
    await(privilegedDb.run(
      sqlu"DELETE FROM resource_permissions WHERE resource_type = 'pipeline' AND resource_id = $pid AND grantee_id = $user::uuid"
    ))

  private def count(table: String): Int = await(superDb.run(sql"SELECT count(*) FROM #$table".as[Int])).head
  private def requestSum(): Int =
    await(superDb.run(sql"SELECT COALESCE(SUM(request_count), 0) FROM pipeline_run_rate_window".as[Int])).head

  /** (status, body, content type): what "byte-identical" compares. */
  private def get(path: String, user: String): (Int, String, String) = {
    var out: (Int, String, String) = null
    req(HttpMethods.GET, path, user) ~> routes ~> check {
      val r: HttpResponse = response
      out = (r.status.intValue, responseAs[String], r.entity.contentType.toString)
    }
    out
  }

  // The unknown-id answer for B, captured once (one request of B's budget).
  private lazy val unknownForB: (Int, String, String) = get(s"/api/data-sources/${UUID.randomUUID()}/sample", userB)

  private def assertDenied(path: String, hint: String = ""): Unit = {
    val got = get(path, userB)
    withClue(s"$hint ($path): ") {
      got._1 shouldBe 404
      got shouldBe unknownForB
      got._2 should not include "secret-"
    }
  }

  "GET /api/data-sources/:id/sample?pipelineId=" should {

    "serve an editor grantee a schema-valid sample of a ROOT source (the client's URL shape)" in {
      val s = seedDataset(userA, "root-src")
      val p = seedPipeline(s)
      grant(p, userB, "editor")
      val (status, body, _) = get(scopedPath(s, p), userB)
      status shouldBe 200
      JsonSchemaValidation.validationErrors(schema, body) shouldBe empty
      val j = body.parseJson.asJsObject
      j.fields("rows").convertTo[Vector[JsValue]] should have size 2
      j.fields("live") shouldBe JsBoolean(false)
    }

    "serve join, union and lookup SECONDARY sources, including a third user's, as an editor (disabled steps too)" in {
      val root   = seedDataset(userA, "root2")
      val joinS  = seedDataset(userA, "join-src")
      val unionS = seedDataset(userC, "union-src-of-third-user")
      val lookS  = seedDataset(userA, "lookup-src")
      val ownS   = seedDataset(userB, "editor-own-secondary")
      val offS   = seedDataset(userA, "disabled-step-src")
      val p      = seedPipeline(root)
      addStep(p, "join", joinOn(joinS))
      addStep(p, "union", unionOn(unionS))
      addStep(p, "lookup", lookupOn(lookS))
      addStep(p, "union", unionOn(ownS))
      addStep(p, "union", unionOn(offS), enabled = false)
      grant(p, userB, "editor")
      Seq(joinS, unionS, lookS, offS).foreach { src =>
        val (status, body, _) = get(scopedPath(src, p), userB)
        withClue(s"secondary $src: ") { status shouldBe 200 }
        JsonSchemaValidation.validationErrors(schema, body) shouldBe empty
      }
    }

    "serve the pipeline OWNER a collaborator's secondary (a source they do not own) through the scoped path" in {
      val root = seedDataset(userA, "owner-root")
      val bs   = seedDataset(userB, "editors-own-secondary")
      val p    = seedPipeline(root)
      addStep(p, "lookup", lookupOn(bs))
      val (status, body, _) = get(scopedPath(bs, p), userA)
      status shouldBe 200
      JsonSchemaValidation.validationErrors(schema, body) shouldBe empty
      // and without the pipeline scope the owner has no access to B's source
      get(s"/api/data-sources/$bs/sample", userA)._1 shouldBe 404
    }

    "answer every denial with the byte-identical 404 of an unknown id" in {
      val used      = seedDataset(userA, "used")
      val other     = seedDataset(userA, "unrelated-source")
      val sec       = seedDataset(userA, "secondary")
      val p         = seedPipeline(used)
      val stepId    = addStep(p, "join", joinOn(sec))
      grant(p, userB, "editor")

      // sanity: the same grant admits the used sources (so the denials below are the rule, not a broken setup)
      get(scopedPath(used, p), userB)._1 shouldBe 200
      get(scopedPath(sec, p), userB)._1 shouldBe 200

      assertDenied(scopedPath(other, p), "unrelated source")
      assertDenied(s"/api/data-sources/$used/sample", "no pipelineId")
      assertDenied(s"/api/data-sources/$used/sample?pipelineId=", "empty pipelineId")
      assertDenied(s"/api/data-sources/$used/sample?pipelineId=${UUID.randomUUID()}", "unknown pipelineId")
      assertDenied(s"/api/data-sources/$used/sample?pipelineId=not%20a%20uuid%00", "malformed pipelineId")

      // a source removed from the pipeline: as a secondary (the join step is deleted) ...
      await(privilegedDb.run(sqlu"DELETE FROM pipeline_steps WHERE id = $stepId"))
      assertDenied(scopedPath(sec, p), "source removed as secondary")

      // ... and as a root (a second root keeps the pipeline valid)
      val dropRoot = seedPipeline(seedDataset(userA, "keep"), used)
      grant(dropRoot, userB, "editor")
      get(scopedPath(used, dropRoot), userB)._1 shouldBe 200
      await(privilegedDb.run(sqlu"DELETE FROM pipeline_roots WHERE id = ${rootIdOf(dropRoot, 1)}"))
      assertDenied(scopedPath(used, dropRoot), "source removed as root")

      // a revoked grant
      revoke(p, userB)
      assertDenied(scopedPath(used, p), "revoked grant")
    }

    "refuse a viewer and a stranger with the same 404" in {
      val s      = seedDataset(userA, "viewer-src")
      val viewed = seedPipeline(s)
      grant(viewed, userB, "viewer")
      assertDenied(scopedPath(s, viewed), "viewer")

      val strangerSrc = seedDataset(userA, "stranger-src")
      val ungranted   = seedPipeline(strangerSrc)
      assertDenied(scopedPath(strangerSrc, ungranted), "stranger (no grant at all)")
    }

    "treat a pipeline whose step config cannot be decoded as using nothing beyond its roots (404, never 500)" in {
      val root = seedDataset(userA, "legacy-root")
      val sec  = seedDataset(userA, "legacy-secondary")
      val p    = seedPipeline(root)
      addStep(p, "join", "this is not json")
      grant(p, userB, "editor")
      get(scopedPath(root, p), userB)._1 shouldBe 200
      assertDenied(scopedPath(sec, p), "undecodable legacy step")
    }

    "keep the owner path unchanged: the owner of the source needs no pipeline, and a bad pipelineId is ignored" in {
      val s = seedDataset(userA, "owner-src")
      get(s"/api/data-sources/$s/sample", userA)._1 shouldBe 200
      get(s"/api/data-sources/$s/sample?pipelineId=garbage", userA)._1 shouldBe 200
    }

    "charge scoped requests to the caller's own source-fetch bucket (shared with /preview, 429 + Retry-After), never the run guard" in {
      val s = seedDataset(userA, "limited")
      val p = seedPipeline(s)
      grant(p, userC, "editor")
      val runsBefore   = count("pipeline_runs")
      val windowBefore = count("pipeline_run_rate_window")
      val sumBefore    = requestSum()
      (1 to 29).foreach { _ =>
        req(HttpMethods.GET, scopedPath(s, p), userC) ~> routes ~> check { status shouldBe StatusCodes.OK }
      }
      // The 30th request is a /preview (a 404 for a non-owner, but charged): sample and preview draw on one bucket.
      req(HttpMethods.GET, s"/api/data-sources/$s/preview", userC) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      req(HttpMethods.GET, scopedPath(s, p), userC) ~> routes ~> check {
        status shouldBe StatusCodes.TooManyRequests
        header("Retry-After") should not be empty
      }
      // The owner's bucket is separate: A is unaffected by C's exhaustion.
      req(HttpMethods.GET, s"/api/data-sources/$s/sample", userA) ~> routes ~> check { status shouldBe StatusCodes.OK }
      count("pipeline_runs") shouldBe runsBefore
      count("pipeline_run_rate_window") shouldBe windowBefore
      requestSum() shouldBe sumBefore
    }
  }
}
