package com.helio.api.routes.dashboards

import com.helio.testsupport.{OutputHistoryFixtures, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID

/** HEL-1785 D5 item 6: helio-mcp's `get_dashboard` hands a dashboard-only grantee the id of an Output bound to a panel.
 *  Naming that id must not open the Output's data. On the NOBYPASSRLS app pool (`helio_app_test`) every `/api/outputs` route
 *  data route answers a dashboard-only VIEWER and EDITOR with the same `404` as an unknown id, while the pipeline OWNER on
 *  the same pool gets the data (the positive control, so the `404`s are not vacuous). Lines are labelled
 *  `[HEL-1785 RLS6]` with role and pool.
 *
 *  Output A (a `table`) is gated by RLS `outputs_select` alone; Output B (an `insight`) is gated twice, by RLS and by the
 *  app-level pipeline access check in `InsightAccess.resolve`. */
class SharedDashboardOutputRoutesRlsSpec extends TwoUserRlsApiFixture with OutputHistoryFixtures {

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private val Pool = "helio_app_test"

  private def log(line: String): Unit = println(s"[HEL-1785 RLS6] $line")

  private def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE dashboards, pipelines, data_sources, resource_permissions CASCADE"))

  private def grant(dashboardId: String, grantee: String, role: String): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashboardId, $grantee::uuid, $role, now())"""
    ))

  private def bind(dashboardId: String, owner: String, outputId: String): Unit = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
             VALUES ($id, $dashboardId, 'Bound', $owner, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', 'output', $outputId, $owner::uuid)"""
    ))
  }

  private final case class Fixture(dash: String, outputA: String, pointId: String, outputB: String)

  private def seed(): Fixture = {
    reset()
    val (pidA, outA) = seedPipelineWithOutput(userA, "table")
    val (pidB, outB) = seedPipelineWithOutput(userA, "insight")
    val payloadId, pointId = UUID.randomUUID().toString
    await(privilegedDb.run(DBIO.seq(
      sqlu"""UPDATE outputs SET schema = '[{"name":"region","type":"string"},{"name":"amount","type":"integer"}]'::jsonb WHERE id = $outA""",
      sqlu"""INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data, root_id)
             SELECT $pidA, NULL, g, jsonb_build_object('region', CASE WHEN g % 2 = 0 THEN 'east' ELSE 'west' END, 'amount', g + 1), $pidA
             FROM generate_series(0, 3) AS g""",
      sqlu"""INSERT INTO node_payload_history (id, pipeline_id, node_step_id, root_id, run_id, trigger_source, captured_at, row_count, byte_size, rows)
             VALUES ($payloadId::uuid, $pidA, NULL, $pidA, 'seed', 'manual', now(), 1, 10, '[{"a":1}]'::jsonb)""",
      sqlu"""INSERT INTO output_snapshot_history (id, output_id, pipeline_id, node_step_id, root_id, run_id, trigger_source, captured_at, row_count, summary, payload_id)
             VALUES ($pointId::uuid, $outA, $pidA, NULL, $pidA, 'seed', 'manual', now(), 1, '{"v":1}'::jsonb, $payloadId::uuid)""",
      sqlu"""INSERT INTO output_insights (output_id, pipeline_id, trigger, status, markdown, citations, created_at)
             VALUES ($outB, $pidB, 'manual', 'ok', 'Revenue held steady.', '[]'::jsonb, now())"""
    )))
    val dash = seedDashboard(userA, "Shared board")
    bind(dash, userA, outA); bind(dash, userA, outB)
    grant(dash, userB, "viewer"); grant(dash, userC, "editor")
    Fixture(dash, outA, pointId, outB)
  }

  private def get(user: String, path: String): (Int, String) =
    req(HttpMethods.GET, path, user) ~> routes ~> check { (response.status.intValue, responseAs[String]) }

  private def statusesAs(user: String, paths: Seq[String]): Seq[(String, Int)] =
    paths.map(p => p -> get(user, p)._1)

  "the Output routes for an Output bound to a shared dashboard" should {

    "serve a dashboard-only viewer and editor the same 404 as an unknown id, and the pipeline owner the data" in {
      val fx = seed()
      val a = fx.outputA
      val paths = Seq(
        s"/api/outputs/$a", s"/api/outputs/$a/rows", s"/api/outputs/$a/history",
        s"/api/outputs/$a/history/${fx.pointId}/rows", s"/api/outputs/$a/distinct-values?column=region"
      )
      val unknown = get(userB, s"/api/outputs/${UUID.randomUUID()}")
      unknown._1 shouldBe 404
      Seq(userB -> "viewer", userC -> "editor").foreach { case (u, role) =>
        val seen = statusesAs(u, paths)
        log(s"role=$Pool dashboard-only $role GET Output A routes: ${seen.map { case (p, s) => s"${p.replace(a, "A").replace(fx.pointId, "P")}=$s" }.mkString(" ")}")
        seen.foreach { case (p, s) => withClue(s"$role $p: ")(s shouldBe 404) }
      }

      // Positive control: the pipeline OWNER on the same pool gets the data.
      val owner = paths.map(p => p -> get(userA, p))
      log(s"role=$Pool pipeline-owner GET Output A routes: ${owner.map { case (p, (s, _)) => s"${p.replace(a, "A").replace(fx.pointId, "P")}=$s" }.mkString(" ")}")
      owner.foreach { case (p, (s, _)) => withClue(s"owner $p: ")(s shouldBe 200) }
      val rows = owner(1)._2._2.parseJson.asJsObject.fields("items").asInstanceOf[JsArray].elements
      rows should not be empty
      owner(3)._2._2 should include("\"a\":1")
      owner(4)._2._2 should include("east")
    }

    "serve a dashboard-only viewer and editor the same 404 as an unknown id for an insight Output, and the owner its render" in {
      val fx = seed()
      val path = s"/api/outputs/${fx.outputB}/insight"
      Seq(userB -> "viewer", userC -> "editor").foreach { case (u, role) =>
        val (s, _) = get(u, path)
        log(s"role=$Pool dashboard-only $role GET insight Output B: /insight=$s")
        s shouldBe 404
      }
      val (s, body) = get(userA, path)
      log(s"role=$Pool pipeline-owner GET insight Output B: /insight=$s render-null=${body.parseJson.asJsObject.fields("render") == JsNull}")
      s shouldBe 200
      body.parseJson.asJsObject.fields("render") should not be JsNull
    }
  }
}
