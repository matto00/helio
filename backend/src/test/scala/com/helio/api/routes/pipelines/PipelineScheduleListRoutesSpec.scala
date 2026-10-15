package com.helio.api.routes.pipelines

import com.helio.testsupport.TwoUserRlsApiFixture
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/** HEL-1574: `GET /api/pipeline-schedules` -- the caller's enabled schedules plus the sources feeding them. */
class PipelineScheduleListRoutesSpec extends TwoUserRlsApiFixture {

  private def get(user: String): JsObject =
    req(HttpMethods.GET, "/api/pipeline-schedules", user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject
    }

  private def seedSource(owner: String, name: String): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($id::uuid, $name, 'csv', '{"path":"x.csv"}'::jsonb, $owner::uuid, now(), now())"""
    ))
    id
  }

  private def seedPipeline(owner: String, name: String, sources: Seq[String], nextRun: Option[String], enabled: Boolean = true): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(DBIO.seq(
      sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($id, $name, $owner::uuid, now(), now())",
      DBIO.seq(sources.zipWithIndex.map { case (s, i) =>
        val rootId = UUID.randomUUID().toString
        sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($rootId, $id, $s::uuid, $i)"
      }: _*),
      sqlu"""INSERT INTO pipeline_schedules (id, pipeline_id, kind, expression, enabled, timezone, next_run_at)
             VALUES (${UUID.randomUUID().toString}, $id, 'interval', '3600', $enabled, 'UTC', ${nextRun.map(Instant.parse).map(Timestamp.from)})"""
    )))
    id
  }

  private def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE pipelines, data_sources CASCADE"))

  "GET /api/pipeline-schedules" should {

    "return 200 with empty items and sources when the caller has no schedules" in {
      reset()
      val r = get(userA)
      r.fields("items") shouldBe JsArray()
      r.fields("sources") shouldBe JsArray()
    }

    "list only the caller's enabled schedules, soonest first, nulls last" in {
      reset()
      val s = seedSource(userA, "src")
      seedPipeline(userA, "Late", Seq(s), Some("2030-01-01T14:00:00Z"))
      seedPipeline(userA, "Early", Seq(s), Some("2030-01-01T09:00:00Z"))
      seedPipeline(userA, "Unscheduled-time", Seq(s), None)
      seedPipeline(userA, "Disabled", Seq(s), Some("2030-01-01T01:00:00Z"), enabled = false)
      seedPipeline(userB, "Not mine", Seq(seedSource(userB, "bsrc")), Some("2030-01-01T00:30:00Z"))
      val names = get(userA).fields("items").convertTo[Vector[JsObject]].map(_.fields("pipelineName").convertTo[String])
      names shouldBe Vector("Early", "Late", "Unscheduled-time")
      get(userB).fields("items").convertTo[Vector[JsObject]].map(_.fields("pipelineName").convertTo[String]) shouldBe Vector("Not mine")
    }

    "show a source feeding several pipelines once, with the soonest run and that pipeline" in {
      reset()
      val s = seedSource(userA, "shared")
      seedPipeline(userA, "A", Seq(s), Some("2030-01-01T14:00:00Z"))
      val b = seedPipeline(userA, "B", Seq(s), Some("2030-01-01T09:00:00Z"))
      val sources = get(userA).fields("sources").convertTo[Vector[JsObject]]
      sources should have size 1
      sources.head.fields("sourceId") shouldBe JsString(s)
      sources.head.fields("pipelineId") shouldBe JsString(b)
      sources.head.fields("pipelineName") shouldBe JsString("B")
      sources.head.fields("nextRunAt").convertTo[String] should startWith("2030-01-01T09:00")
    }

    "omit a source that feeds only disabled schedules" in {
      reset()
      val s = seedSource(userA, "only-disabled")
      seedPipeline(userA, "Off", Seq(s), Some("2030-01-01T09:00:00Z"), enabled = false)
      get(userA).fields("sources") shouldBe JsArray()
    }

    "list every scheduled pipeline and source for a caller with many (two queries by construction, no per-row lookups)" in {
      reset()
      val sources = (1 to 5).map(i => seedSource(userA, s"s$i"))
      sources.foreach(s => seedPipeline(userA, s"p-$s", Seq(s), Some("2030-01-01T09:00:00Z")))
      val r = get(userA)
      r.fields("items").convertTo[Vector[JsValue]] should have size 5
      r.fields("sources").convertTo[Vector[JsValue]] should have size 5
    }
  }
}
