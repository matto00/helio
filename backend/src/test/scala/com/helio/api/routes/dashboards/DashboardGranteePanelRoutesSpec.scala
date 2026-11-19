package com.helio.api.routes.dashboards

import com.helio.domain.insights.{InsightStatus, InsightTrigger, OutputInsightInsert, StoredInsightCitation}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputHistoryRepository, OutputInsightRepository, PipelineRunRepository}
import com.helio.testsupport.{OutputHistoryFixtures, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.net.URLEncoder
import java.time.Instant
import java.util.UUID
import scala.collection.mutable
import scala.concurrent.ExecutionContext

/** HEL-1780: every per-panel route a dashboard GRANTEE's client now uses (`rows` with a control-column sort and filter,
 *  `filter-capabilities`, `distinct-values`, `history`, `insight`, `provenance`) answers a dashboard-only viewer, a
 *  dashboard-only editor and a dual-grant user (a pipeline grant AND a dashboard grant) with 200 and a stranger with 404,
 *  on the NOBYPASSRLS app pool (`helio_app_test`), plus the RLS facts the client's routing rests on (`[HEL-1780 RLS]` lines).
 *
 *  Users: A owns the dashboard and the pipeline. B is the dashboard-only grantee (a viewer, then re-granted an editor), and
 *  is also the stranger on a second dashboard of A's that carries no grant (B never holds a pipeline grant). C is the
 *  dual-grant user: a pipeline grant on A's pipeline plus a dashboard grant. */
class DashboardGranteePanelRoutesSpec extends TwoUserRlsApiFixture with OutputHistoryFixtures {

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

  private def seedPanel(dashboardId: String, owner: String, outputId: String, controls: String): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, output_controls, owner_id)
             VALUES ($id, $dashboardId, 'P', $owner, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', 'output', $outputId,
                     $controls::jsonb, $owner::uuid)"""
    ))
    id
  }

  private def seedRows(pipelineId: String, rows: Seq[(String, String, Int)]): Unit =
    rows.zipWithIndex.foreach { case ((region, team, amount), i) =>
      await(privilegedDb.run(
        sqlu"""INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data, root_id)
               VALUES ($pipelineId, NULL, $i, ${JsObject("region" -> JsString(region), "team" -> JsString(team), "amount" -> JsNumber(amount)).compactPrint}::jsonb, $pipelineId)"""
      ))
    }

  private def get(user: String, path: String): (Int, String) =
    req(HttpMethods.GET, path, user) ~> routes ~> check { (response.status.intValue, responseAs[String]) }

  private def enc(s: String): String = URLEncoder.encode(s, "UTF-8")

  private val controls = """[{"id":"team-ctl","kind":"dropdown","column":"team","label":"Team"}]"""

  private case class World(dash: String, otherDash: String, tablePanel: String, metricPanel: String, insightPanel: String,
                           tableOutput: String, pipeline: String, otherPanel: String)

  private def seedWorld(): World = {
    reset()
    val (pipe, tableOut) = seedPipelineWithOutput(userA, "table")
    val metricOut        = UUID.randomUUID().toString
    val insightOut       = UUID.randomUUID().toString
    await(privilegedDb.run(DBIO.seq(
      sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, root_id)
             VALUES ($metricOut, $pipe, NULL, $userA::uuid, 'metric', 'metric', '{"compare":"previous_run"}'::jsonb, $pipe)""",
      sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, root_id)
             VALUES ($insightOut, $pipe, NULL, $userA::uuid, 'insight', 'insight', '{}'::jsonb, $pipe)"""
    )))
    await(privilegedDb.run(
      sqlu"""UPDATE outputs SET schema = '[{"name":"region","type":"string"},{"name":"team","type":"string"},{"name":"amount","type":"integer"}]'::jsonb WHERE id = $tableOut"""
    ))
    seedRows(pipe, Seq(("East", "a", 1), ("West", "b", 2), ("North", "a", 3)))
    val now = Instant.now()
    await(privilegedDb.run(new OutputHistoryRepository(ctx).insertAction(Seq(
      historyEntry(metricOut, pipe, now.minusSeconds(120)), historyEntry(metricOut, pipe, now.minusSeconds(60))
    ))))
    val insights = new OutputInsightRepository(ctx)(ExecutionContext.global)
    await(privilegedDb.run(insights.insertAction(OutputInsightInsert(
      outputId = insightOut, pipelineId = pipe, runId = None, trigger = InsightTrigger.OnRun, status = InsightStatus.Ok,
      markdown = Some("Three regions [c1]."), citations = Vector(StoredInsightCitation("c1", tableOut, "region", Some(3.0), None, None, isPct = false)),
      inputDigest = None, model = None, inputTokens = None, outputTokens = None, cacheCreationTokens = None, cacheReadTokens = None,
      costMicros = None, createdAt = now
    ))))
    val dash      = seedDashboard(userA, "Shared board")
    val other     = seedDashboard(userA, "Ungranted board")
    val tablePnl  = seedPanel(dash, userA, tableOut, controls)
    val metricPnl = seedPanel(dash, userA, metricOut, "[]")
    val insightPn = seedPanel(dash, userA, insightOut, "[]")
    val otherPnl  = seedPanel(other, userA, tableOut, controls)
    World(dash, other, tablePnl, metricPnl, insightPn, tableOut, pipe, otherPnl)
  }

  /** Every per-panel route a grantee's client uses, as (label, path) pairs, all expected 200 for the grantees. */
  private def routesOf(w: World): Seq[(String, String)] = {
    val d = w.dash
    Seq(
      "rows"                -> s"/api/dashboards/$d/panels/${w.tablePanel}/rows",
      "rows control sort"   -> s"/api/dashboards/$d/panels/${w.tablePanel}/rows?sort=team:asc",
      "rows control filter" -> s"/api/dashboards/$d/panels/${w.tablePanel}/rows?filter=${enc("""{"ops":[{"column":"team","op":"eq","value":"a"}]}""")}",
      "filter-capabilities" -> s"/api/dashboards/$d/panels/${w.tablePanel}/filter-capabilities",
      "distinct-values"     -> s"/api/dashboards/$d/panels/${w.tablePanel}/distinct-values?column=team",
      "history"             -> s"/api/dashboards/$d/panels/${w.metricPanel}/history",
      "insight"             -> s"/api/dashboards/$d/panels/${w.insightPanel}/insight",
      "provenance"          -> s"/api/dashboards/$d/panels/${w.tablePanel}/provenance"
    )
  }

  private def log(line: String): Unit = println(s"[HEL-1780 RLS] $line")

  "the per-panel routes a dashboard grantee's client uses" should {

    "answer a dashboard-only viewer, a dashboard-only editor and a dual-grant user with 200 (no pipeline grant needed)" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      grant("dashboard", w.dash, userC, "viewer")
      grant("pipeline", w.pipeline, userC, "editor") // C: dual grant
      val perUser = mutable.Map.empty[String, Seq[(String, Int)]]
      def pass(who: String, user: String): Unit =
        perUser(who) = routesOf(w).map { case (label, path) => label -> get(user, path)._1 }
      pass("viewer", userB)
      setDashboardRole(w.dash, userB, "editor")
      pass("editor", userB)
      pass("dual-grant", userC)
      perUser.foreach { case (who, rs) =>
        log(s"(1) role=helio_app_test per-panel routes as $who: ${rs.map { case (l, s) => s"$l=$s" }.mkString(" ")}")
        withClue(s"$who: ") { rs.collect { case (l, s) if s != 200 => l -> s } shouldBe Nil }
      }
    }

    "answer a stranger 404 on every route, on every route" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userC, "viewer")
      // B holds NO grant on the dashboard (and never a pipeline grant): the stranger.
      val results = routesOf(w).map { case (l, p) => l -> get(userB, p)._1 }
      log(s"(2) role=helio_app_test per-panel routes as stranger: ${results.map { case (l, s) => s"$l=$s" }.mkString(" ")}")
      results.collect { case (l, s) if s != 404 => l -> s } shouldBe Nil
      // A second dashboard of A's with no grant at all: the grantee of the FIRST is a stranger here too.
      val ungranted = get(userC, s"/api/dashboards/${w.otherDash}/panels/${w.otherPanel}/rows")._1
      log(s"(2b) role=helio_app_test dashboard-grantee on an UNGRANTED dashboard rows=$ungranted")
      ungranted shouldBe 404
    }

    "refuse a sort or filter outside the panel's own control columns with 400, and `quick` outright" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      val base = s"/api/dashboards/${w.dash}/panels/${w.tablePanel}/rows"
      val bad = Seq(
        "non-control sort"    -> s"$base?sort=amount:asc",
        "non-control filter"  -> s"$base?filter=${enc("""{"ops":[{"column":"amount","op":"gte","value":"1"}]}""")}",
        "quick"               -> s"$base?filter=${enc("""{"quick":"east"}""")}"
      ).map { case (l, p) => l -> get(userB, p)._1 }
      log(s"(3) the client never sends these (splitForPanelScope): ${bad.map { case (l, s) => s"$l=$s" }.mkString(" ")}")
      bad.foreach { case (l, s) => withClue(l) { s shouldBe 400 } }
    }

    "serve a history with no point id and no hasPayload, and apply the control-column filter" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      val (hs, hbody) = get(userB, s"/api/dashboards/${w.dash}/panels/${w.metricPanel}/history")
      hs shouldBe 200
      hbody should not include "hasPayload"
      hbody should not include "\"id\""
      val (_, rows) = get(userB, s"/api/dashboards/${w.dash}/panels/${w.tablePanel}/rows?filter=${enc("""{"ops":[{"column":"team","op":"eq","value":"b"}]}""")}")
      rows.parseJson.asJsObject.fields("items").asInstanceOf[JsArray].elements.size shouldBe 1
    }
  }

  "the RLS facts behind the client's routing" should {
    "hold as the NOBYPASSRLS app role, labelled by role" in {
      val w = seedWorld()
      grant("dashboard", w.dash, userB, "viewer")
      grant("dashboard", w.dash, userC, "editor")
      val pointId = await(privilegedDb.run(sql"SELECT id::text FROM output_snapshot_history LIMIT 1".as[String].head))
      val metricOut = await(privilegedDb.run(sql"SELECT output_id FROM output_snapshot_history LIMIT 1".as[String].head))

      // (a) the bound Output as a dashboard-only viewer and editor (helio_app_test): 0 rows, so the client must not call /api/outputs/*.
      def outputs(user: String): Int =
        await(ctx.withUserContext(user)(sql"SELECT count(*) FROM outputs WHERE id = ${w.tableOutput}".as[Int].head))
      val (v, e, o) = (outputs(userB), outputs(userC), outputs(userA))
      log(s"(a) role=helio_app_test SELECT outputs WHERE id=<bound output>: dashboard-only viewer=$v dashboard-only editor=$e pipeline-owner=$o")
      (v, e, o) shouldBe ((0, 0, 1))

      // (b) the gate admits viewer and editor and refuses a stranger (see (1) and (2) above for every route).
      val gate = Seq(userB -> "viewer", userC -> "editor").map { case (u, r) =>
        r -> get(u, s"/api/dashboards/${w.dash}/panels/${w.tablePanel}/output-meta")._1
      }
      val stranger = get(userB, s"/api/dashboards/${w.otherDash}/panels/${w.otherPanel}/output-meta")._1
      log(s"(b) role=helio_app_test per-panel gate: ${gate.map { case (r, s) => s"$r=$s" }.mkString(" ")} stranger=$stranger")
      gate.foreach { case (_, s) => s shouldBe 200 }
      stranger shouldBe 404

      // (c) a history point's stored payload rows stay unreachable for a dashboard-only grantee (HEL-921 premise).
      val payloadRows = get(userB, s"/api/outputs/$metricOut/history/$pointId/rows")._1
      val outputRows  = get(userB, s"/api/outputs/${w.tableOutput}/rows")._1
      log(s"(c) role=helio_app_test dashboard-only viewer GET /api/outputs/<id>/history/<point>/rows=$payloadRows GET /api/outputs/<id>/rows=$outputRows")
      payloadRows shouldBe 404
      outputRows shouldBe 404
    }
  }
}
