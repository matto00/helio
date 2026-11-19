package com.helio.api.routes.dashboards

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputHistoryRepository, PipelineRunRepository}
import com.helio.testsupport.{JsonSchemaValidation, OutputHistoryFixtures, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.HttpMethods
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1786: `GET /api/dashboards/:id/panel-status`, the dashboard-scoped source a dashboard-only grantee's client reads
 *  for the freshness line, the run-finish refresh trigger and the data-invalid badge (it may not read `/api/outputs/:id` routes or
 *  `/api/pipelines/:id` routes). Every request runs through the full route tree over the NOBYPASSRLS app pool (`helio_app_test`),
 *  exactly as `DashboardSharedListRoutesSpec` does.
 *
 *  Users (TwoUserRlsApiFixture): A owns the dashboard and the pipeline. B is a dashboard-only viewer (re-granted editor), and
 *  is the stranger on a second, ungranted dashboard of A's. C is the dual-grant user (pipeline grant plus dashboard grant). */
class DashboardPanelStatusRoutesSpec extends TwoUserRlsApiFixture with OutputHistoryFixtures {

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  override protected def pipelineRunRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunRepository =
    new PipelineRunRepository(ctx)(ec)

  private def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE dashboards, pipelines, data_sources, resource_permissions CASCADE"))

  private def grant(resourceType: String, resourceId: String, grantee: String, role: String): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ($resourceType, $resourceId, $grantee::uuid, $role, now())"""
    ))

  private def setDashboardRole(dashboardId: String, grantee: String, role: String): Unit =
    await(privilegedDb.run(
      sqlu"""UPDATE resource_permissions SET role = $role
             WHERE resource_type = 'dashboard' AND resource_id = $dashboardId AND grantee_id = $grantee::uuid"""
    ))

  private def seedPanel(dashboardId: String, owner: String, outputId: String): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, output_controls, owner_id)
             VALUES ($id, $dashboardId, 'P', $owner, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', 'output', $outputId,
                     '[]'::jsonb, $owner::uuid)"""
    ))
    id
  }

  private def seedRun(pipelineId: String, status: String, startedAt: Instant, errorLog: Option[String] = None): String = {
    val runId = UUID.randomUUID().toString
    val at    = Timestamp.from(startedAt)
    await(privilegedDb.run(
      sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, trigger_source, error_log)
             VALUES ($runId, $pipelineId, $status, $at, 'manual', $errorLog)"""
    ))
    runId
  }

  private def seedAssertion(runId: String, stepId: String, severity: String, passed: Boolean): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO pipeline_run_assertions (id, run_id, step_id, kind, field, severity, passed, message)
             VALUES (${UUID.randomUUID().toString}, $runId, $stepId, 'not_null', 'id', $severity, $passed, '')"""
    ))

  private def setPipelineRun(pipelineId: String, status: String, at: Instant): Unit = {
    val ts = Timestamp.from(at)
    await(privilegedDb.run(sqlu"UPDATE pipelines SET last_run_status = $status, last_run_at = $ts WHERE id = $pipelineId"))
  }

  private def addHistory(outputId: String, pipelineId: String, at: Instant): Unit =
    await(privilegedDb.run(new OutputHistoryRepository(ctx).insertAction(Seq(historyEntry(outputId, pipelineId, at)))))

  private val tableName    = "Sales CSV"
  private val otherSource  = "Unread Second Source"
  private val pipelineName = "Secret-Pipeline-Name"
  private val errorText    = "SECRET-ERROR-LOG-TEXT"

  /** A pipeline P with two roots (root 1 = `Sales CSV`, root 2 = `Unread Second Source`); `tableOut` is root-bound to root 1;
   *  `assertOut` is bound to an `assert` step (id `stepId`) on root 1. Both panels sit on `dash`; `otherDash` carries
   *  `tableOut` again. */
  private case class World(dash: String, otherDash: String, tablePanel: String, assertPanel: String, otherPanel: String,
                           pipeline: String, tableOut: String, assertOut: String, stepId: String, rootTwo: String)

  private def seedWorld(): World = {
    reset()
    val (pipe, tableOut) = seedPipelineWithOutput(userA, "table")
    val stepId  = UUID.randomUUID().toString
    val rootTwo = UUID.randomUUID().toString
    val srcTwo  = UUID.randomUUID().toString
    val assertOut = UUID.randomUUID().toString
    await(privilegedDb.run(DBIO.seq(
      sqlu"UPDATE data_sources SET name = $tableName",
      sqlu"UPDATE pipelines SET name = $pipelineName WHERE id = $pipe",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($srcTwo, $otherSource, 'dataset', '{}', $userA::uuid, now(), now())""",
      sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($rootTwo, $pipe, $srcTwo, 1)",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($stepId, $pipe, 0, 'assert', '{}', true, now(), now(), NULL, $pipe)""",
      sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, root_id)
             VALUES ($assertOut, $pipe, $stepId, $userA::uuid, 'checked', 'table', '{}'::jsonb, NULL)"""
    )))
    val dash  = seedDashboard(userA, "Shared board")
    val other = seedDashboard(userA, "Ungranted board")
    World(dash, other, seedPanel(dash, userA, tableOut), seedPanel(dash, userA, assertOut), seedPanel(other, userA, tableOut),
      pipe, tableOut, assertOut, stepId, rootTwo)
  }

  private def get(user: String, path: String): (Int, String) =
    req(HttpMethods.GET, path, user) ~> routes ~> check { (response.status.intValue, responseAs[String]) }

  private def status(w: World, user: String): (Int, String) = get(user, s"/api/dashboards/${w.dash}/panel-status")

  private def items(body: String): Vector[JsObject] =
    body.parseJson.asJsObject.fields("items").asInstanceOf[JsArray].elements.map(_.asJsObject)

  private def item(body: String, panelId: String): JsObject =
    items(body).find(_.fields("panelId") == JsString(panelId)).getOrElse(fail(s"no item for panel $panelId in $body"))

  private def log(line: String): Unit = println(s"[HEL-1786 RLS] $line")

  "GET /api/dashboards/:id/panel-status" should {

    "answer a dashboard-only viewer, editor and dual-grant user 200 with the run facts, a stranger and an unknown id the same 404, no session 401" in {
      val w   = seedWorld()
      val run = Instant.parse("2026-11-10T10:00:00Z")
      setPipelineRun(w.pipeline, "succeeded", run)
      addHistory(w.tableOut, w.pipeline, run.plusSeconds(1))
      grant("dashboard", w.dash, userB, "viewer")
      grant("dashboard", w.dash, userC, "viewer")
      grant("pipeline", w.pipeline, userC, "editor")
      def check200(who: String, user: String): Unit = {
        val (code, body) = status(w, user)
        log(s"role=helio_app_test panel-status as $who: $code")
        withClue(s"$who: ") { code shouldBe 200 }
        val it = item(body, w.tablePanel)
        it.fields("lastRunAt") shouldBe JsString(run.toString)
        it.fields("runStatus") shouldBe JsString("succeeded")
        it.fields("dataUpdatedAt") shouldBe JsString(run.plusSeconds(1).toString)
        it.fields("invalid") shouldBe JsBoolean(false)
        body.parseJson.asJsObject.fields("sources") shouldBe JsArray(JsString(tableName))
      }
      check200("owner", userA)
      check200("viewer", userB)
      setDashboardRole(w.dash, userB, "editor")
      check200("editor", userB)
      check200("dual-grant", userC)

      val grantlessDash = w.otherDash
      val stranger      = get(userB, s"/api/dashboards/$grantlessDash/panel-status")
      val unknown       = get(userB, s"/api/dashboards/${UUID.randomUUID()}/panel-status")
      log(s"role=helio_app_test stranger=${stranger._1} unknown=${unknown._1}")
      stranger._1 shouldBe 404
      unknown._1 shouldBe 404
      stranger._2 shouldBe unknown._2
      import org.apache.pekko.http.scaladsl.model.HttpRequest
      HttpRequest(HttpMethods.GET, s"/api/dashboards/${w.dash}/panel-status") ~> routes ~> check { response.status.intValue shouldBe 401 }
    }

    "report invalid after a real run failed an error-severity assertion on the Output's step, not for a dry run, a warn or another step" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      val t0 = Instant.parse("2026-11-10T10:00:00Z")
      setPipelineRun(w.pipeline, "succeeded", t0)

      // Only a DRY run failed: the dry-run exclusion keeps it valid.
      val real = seedRun(w.pipeline, "succeeded", t0)
      seedAssertion(real, w.stepId, "error", passed = true)
      val dry = seedRun(w.pipeline, "dry_run", t0.plusSeconds(60))
      seedAssertion(dry, w.stepId, "error", passed = false)
      item(status(w, userB)._2, w.assertPanel).fields("invalid") shouldBe JsBoolean(false)

      // A warn-severity failure on the latest real run: still valid.
      val warnRun = seedRun(w.pipeline, "succeeded", t0.plusSeconds(120))
      seedAssertion(warnRun, w.stepId, "warn", passed = false)
      item(status(w, userB)._2, w.assertPanel).fields("invalid") shouldBe JsBoolean(false)

      // An error failure on ANOTHER step does not invalidate this Output.
      val otherStepRun = seedRun(w.pipeline, "succeeded", t0.plusSeconds(180))
      seedAssertion(otherStepRun, "some-other-step", "error", passed = false)
      item(status(w, userB)._2, w.assertPanel).fields("invalid") shouldBe JsBoolean(false)

      // An error failure on its own step on the newest real run: invalid, only for the assert panel.
      val bad = seedRun(w.pipeline, "succeeded", t0.plusSeconds(240))
      seedAssertion(bad, w.stepId, "error", passed = false)
      val body = status(w, userB)._2
      item(body, w.assertPanel).fields("invalid") shouldBe JsBoolean(true)
      item(body, w.tablePanel).fields("invalid") shouldBe JsBoolean(false)
    }

    "keep dataUpdatedAt on the committed history point: lastRunAt advancing alone does not move it" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      val t0 = Instant.parse("2026-11-10T10:00:00Z")
      setPipelineRun(w.pipeline, "succeeded", t0)
      addHistory(w.tableOut, w.pipeline, t0)
      val before = item(status(w, userB)._2, w.tablePanel)

      setPipelineRun(w.pipeline, "succeeded", t0.plusSeconds(30)) // updateMeta committed, rows not yet
      val during = item(status(w, userB)._2, w.tablePanel)
      during.fields("lastRunAt") shouldBe JsString(t0.plusSeconds(30).toString)
      during.fields("dataUpdatedAt") shouldBe before.fields("dataUpdatedAt")

      addHistory(w.tableOut, w.pipeline, t0.plusSeconds(31)) // the snapshot+history transaction commits
      item(status(w, userB)._2, w.tablePanel).fields("dataUpdatedAt") shouldBe JsString(t0.plusSeconds(31).toString)

      // An Output with no history point at all.
      item(status(w, userB)._2, w.assertPanel).fields("dataUpdatedAt") shouldBe JsNull
    }

    "map a failed run to failed and a never-run pipeline to nulls" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      item(status(w, userB)._2, w.tablePanel).fields("lastRunAt") shouldBe JsNull
      item(status(w, userB)._2, w.tablePanel).fields("runStatus") shouldBe JsNull
      setPipelineRun(w.pipeline, "failed", Instant.parse("2026-11-10T10:00:00Z"))
      item(status(w, userB)._2, w.tablePanel).fields("runStatus") shouldBe JsString("failed")
    }

    "list only the sources the dashboard's Outputs read, not every root of the pipeline" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      val body = status(w, userB)._2
      body should include(tableName)
      body should not include otherSource
      body.parseJson.asJsObject.fields("sources") shouldBe JsArray(JsString(tableName))
    }

    "carry only the allow-listed keys and no identifier, step name or error text" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      val t0  = Instant.parse("2026-11-10T10:00:00Z")
      val bad = seedRun(w.pipeline, "failed", t0, Some(errorText))
      seedAssertion(bad, w.stepId, "error", passed = false)
      setPipelineRun(w.pipeline, "failed", t0)
      addHistory(w.tableOut, w.pipeline, t0)
      val (code, body) = status(w, userB)
      code shouldBe 200
      val json = body.parseJson.asJsObject
      json.fields.keySet shouldBe Set("items", "sources")
      items(body).foreach(_.fields.keySet shouldBe Set("panelId", "lastRunAt", "runStatus", "dataUpdatedAt", "invalid"))
      val forbidden = Seq(w.pipeline, w.stepId, bad, w.tableOut, w.assertOut, w.rootTwo, userA, errorText, pipelineName, "assert")
      forbidden.foreach(f => withClue(s"body must not contain '$f': ") { body should not include f })
    }

    "list the dashboard's own panels only" in {
      val w    = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      val ids  = items(status(w, userB)._2).map(_.fields("panelId").convertTo[String])
      ids should not contain w.otherPanel
      ids.toSet shouldBe Set(w.tablePanel, w.assertPanel)
    }

    "conform to dashboard-panel-status-response.schema.json" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      val t0 = Instant.parse("2026-11-10T10:00:00Z")
      setPipelineRun(w.pipeline, "succeeded", t0)
      addHistory(w.tableOut, w.pipeline, t0)
      val schema = JsonSchemaValidation.compile("dashboards/dashboard-panel-status-response.schema.json")
      JsonSchemaValidation.validationErrors(schema, status(w, userB)._2) shouldBe empty
      JsonSchemaValidation.validationErrors(schema, """{"items":[{"panelId":"x","lastRunAt":null,"runStatus":null,"dataUpdatedAt":null,"invalid":false,"pipelineId":"leak"}],"sources":[]}""") should not be empty
    }

    "work for a dashboard-only grantee because of the internal reads, not because RLS is bypassed" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      val t0 = Instant.parse("2026-11-10T10:00:00Z")
      setPipelineRun(w.pipeline, "succeeded", t0)
      addHistory(w.tableOut, w.pipeline, t0)
      def count(q: DBIO[Int]): Int = await(ctx.withUserContext(userB)(q))
      val outputs   = count(sql"SELECT count(*) FROM outputs WHERE id = ${w.tableOut}".as[Int].head)
      val pipelines = count(sql"SELECT count(*) FROM pipelines WHERE id = ${w.pipeline}".as[Int].head)
      val history   = count(sql"SELECT count(*) FROM output_snapshot_history WHERE output_id = ${w.tableOut}".as[Int].head)
      val (code, body) = status(w, userB)
      log(s"(a) dashboard-only viewer SELECT outputs=$outputs pipelines=$pipelines output_snapshot_history=$history")
      log(s"(b) dashboard-only viewer GET panel-status=$code lastRunAt=${item(body, w.tablePanel).fields("lastRunAt")} dataUpdatedAt=${item(body, w.tablePanel).fields("dataUpdatedAt")} sources=${body.parseJson.asJsObject.fields("sources")}")
      (outputs, pipelines, history) shouldBe ((0, 0, 0))
      code shouldBe 200
      item(body, w.tablePanel).fields("lastRunAt") should not be JsNull
      item(body, w.tablePanel).fields("dataUpdatedAt") should not be JsNull
      body.parseJson.asJsObject.fields("sources") should not be JsArray.empty
    }
  }
}
