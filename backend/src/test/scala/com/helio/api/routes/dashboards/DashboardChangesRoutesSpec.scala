package com.helio.api.routes.dashboards

import com.helio.testsupport.{OutputHistoryFixtures, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, HttpRequest, StatusCodes}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/** HEL-1575: `GET /api/dashboard-changes` on the NOBYPASSRLS app pool, and the panel-delete content bump. */
class DashboardChangesRoutesSpec extends TwoUserRlsApiFixture with OutputHistoryFixtures {

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private val T0 = Instant.parse("2026-10-01T10:00:00Z")
  private val T1 = Instant.parse("2026-10-02T11:30:00Z")
  private val T2 = Instant.parse("2026-10-03T12:45:00Z")

  private def changes(user: String, ids: String): JsObject =
    req(HttpMethods.GET, s"/api/dashboard-changes?ids=$ids", user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject
    }

  private def items(user: String, ids: String): Vector[JsObject] =
    changes(user, ids).fields("items").asInstanceOf[JsArray].elements.map(_.asJsObject)

  private def seedPanel(dashboardId: String, owner: String, outputId: Option[String], lastUpdated: Instant = T0): String = {
    val id = UUID.randomUUID().toString
    val ts   = Timestamp.from(lastUpdated)
    val kind = if (outputId.isDefined) "output" else "text"
    await(privilegedDb.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
             VALUES ($id, $dashboardId, 'P', $owner, now(), $ts,
                     '{"background":"transparent","color":"inherit","transparency":0.0}', $kind, $outputId, $owner::uuid)"""
    ))
    id
  }

  private def setDashboardUpdated(id: String, at: Instant): Unit =
    await(privilegedDb.run(sqlu"UPDATE dashboards SET last_updated = ${Timestamp.from(at)} WHERE id = $id"))

  private def dashboardUpdated(id: String): Instant =
    await(privilegedDb.run(sql"SELECT last_updated FROM dashboards WHERE id = $id".as[Timestamp].head)).toInstant

  private def record(outputId: String, pipelineId: String, at: Instant): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO output_snapshot_history (output_id, pipeline_id, root_id, run_id, trigger_source, captured_at, row_count, summary)
             VALUES ($outputId, $pipelineId, $pipelineId, ${UUID.randomUUID().toString}, 'manual', ${Timestamp.from(at)}, 1, '{"v":1}'::jsonb)"""
    ))

  private def share(resourceType: String, resourceId: String, grantee: String): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ($resourceType, $resourceId, $grantee::uuid, 'viewer', now())"""
    ))

  private def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE dashboards, pipelines, data_sources, resource_permissions CASCADE"))

  "GET /api/dashboard-changes" should {

    "prove the app pool is genuinely non-BYPASSRLS" in {
      await(ctx.withUserContext(userA)(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = 'helio_app_test'".as[Boolean].head)) shouldBe false
    }

    "report the newest history capture per Output and the max across Outputs for an owned dashboard" in {
      reset()
      val (p1, o1) = seedPipelineWithOutput(userA)
      val (p2, o2) = seedPipelineWithOutput(userA)
      val d        = seedDashboard(userA, "Owned")
      setDashboardUpdated(d, T0)
      seedPanel(d, userA, Some(o1))
      seedPanel(d, userA, Some(o1))
      seedPanel(d, userA, Some(o2))
      seedPanel(d, userA, None)
      record(o1, p1, T0)
      record(o1, p1, T1)
      record(o2, p2, T2)

      val body = changes(userA, d)
      Instant.parse(body.fields("serverNow").convertTo[String]) should be > T2
      val item = body.fields("items").asInstanceOf[JsArray].elements.head.asJsObject
      item.fields("dashboardId") shouldBe JsString(d)
      Instant.parse(item.fields("dataUpdatedAt").convertTo[String]) shouldBe T2
      val outputs = item.fields("outputs").asInstanceOf[JsArray].elements.map(_.asJsObject)
      outputs.map(o => o.fields("outputId").convertTo[String] -> Instant.parse(o.fields("dataUpdatedAt").convertTo[String])).toMap shouldBe
        Map(o1 -> T1, o2 -> T2)
    }

    "report contentUpdatedAt as the later of the dashboard and its newest panel edit" in {
      reset()
      val d = seedDashboard(userA, "Content")
      setDashboardUpdated(d, T1)
      seedPanel(d, userA, None, lastUpdated = T0)
      Instant.parse(items(userA, d).head.fields("contentUpdatedAt").convertTo[String]) shouldBe T1
      seedPanel(d, userA, None, lastUpdated = T2)
      Instant.parse(items(userA, d).head.fields("contentUpdatedAt").convertTo[String]) shouldBe T2
    }

    "give null data times for a dashboard whose Outputs have no history" in {
      reset()
      val (_, o) = seedPipelineWithOutput(userA)
      val d      = seedDashboard(userA, "NoHistory")
      seedPanel(d, userA, Some(o))
      val item = items(userA, d).head
      item.fields("dataUpdatedAt") shouldBe JsNull
      item.fields("outputs").asInstanceOf[JsArray].elements.head.asJsObject.fields("dataUpdatedAt") shouldBe JsNull
    }

    "show a dashboard-only grantee the dashboard but no data time, and a pipeline grantee the data time" in {
      reset()
      val (p, o) = seedPipelineWithOutput(userA)
      val d      = seedDashboard(userA, "Shared")
      seedPanel(d, userA, Some(o))
      record(o, p, T1)
      share("dashboard", d, userB)

      val dashboardOnly = items(userB, d)
      dashboardOnly should have size 1
      dashboardOnly.head.fields("dataUpdatedAt") shouldBe JsNull
      dashboardOnly.head.fields("outputs") shouldBe JsArray()

      share("pipeline", p, userB)
      val withPipeline = items(userB, d).head
      Instant.parse(withPipeline.fields("dataUpdatedAt").convertTo[String]) shouldBe T1
    }

    "omit another user's private dashboard and an unknown id without an error" in {
      reset()
      val dA = seedDashboard(userA, "A private")
      val dB = seedDashboard(userB, "B own")
      items(userB, dA) shouldBe empty
      items(userB, s"$dA,${UUID.randomUUID()},$dB").map(_.fields("dashboardId").convertTo[String]) shouldBe Vector(dB)
    }

    "answer in the order of the requested ids and collapse a repeated id" in {
      reset()
      val d1 = seedDashboard(userA, "One")
      val d2 = seedDashboard(userA, "Two")
      items(userA, s"$d2,$d1,$d2").map(_.fields("dashboardId").convertTo[String]) shouldBe Vector(d2, d1)
    }

    "reject an empty list, an empty id and 21 ids with 400, and accept exactly 20" in {
      reset()
      val d = seedDashboard(userA, "Limits")
      Seq("", s"$d,", s",$d", (1 to 21).map(_ => UUID.randomUUID()).mkString(",")).foreach { ids =>
        withClue(ids) {
          req(HttpMethods.GET, s"/api/dashboard-changes?ids=$ids", userA) ~> routes ~> check {
            status shouldBe StatusCodes.BadRequest
          }
        }
      }
      items(userA, (1 to 19).map(_ => UUID.randomUUID()).mkString(",") + "," + d) should have size 1
    }

    "return 401 with no session" in {
      HttpRequest(HttpMethods.GET, "/api/dashboard-changes?ids=x") ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }

  "Deleting a panel" should {

    "advance the dashboard's last_updated and its contentUpdatedAt" in {
      reset()
      val d = seedDashboard(userA, "Delete bump")
      setDashboardUpdated(d, T0)
      val keep  = seedPanel(d, userA, None)
      val gone  = seedPanel(d, userA, None)
      val before = Instant.now()
      req(HttpMethods.DELETE, s"/api/panels/$gone", userA) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      dashboardUpdated(d) should be >= before.minusSeconds(1)
      Instant.parse(items(userA, d).head.fields("contentUpdatedAt").convertTo[String]) should be >= before.minusSeconds(1)
      keep should not be gone
    }

    "leave last_updated alone when the panel does not exist" in {
      reset()
      val d = seedDashboard(userA, "No bump")
      setDashboardUpdated(d, T0)
      req(HttpMethods.DELETE, s"/api/panels/${UUID.randomUUID()}", userA) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      dashboardUpdated(d) shouldBe T0
    }
  }
}
