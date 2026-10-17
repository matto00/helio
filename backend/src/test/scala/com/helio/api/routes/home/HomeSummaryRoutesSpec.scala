package com.helio.api.routes.home

import com.helio.testsupport.{HomeSummarySeeding, JsonSchemaValidation, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, HttpRequest, StatusCodes}
import spray.json._

import java.time.Instant

/** HEL-1578: `GET /api/home-summary` over the route tree on a non-BYPASSRLS app pool. */
class HomeSummaryRoutesSpec extends TwoUserRlsApiFixture with HomeSummarySeeding {

  private val schema = JsonSchemaValidation.compile("home/home-summary-response.schema.json")

  private def get(user: String): (JsObject, String) =
    req(HttpMethods.GET, "/api/home-summary", user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      val body = responseAs[String]
      (body.parseJson.asJsObject, body)
    }

  private def getPath(path: String, user: String): (JsObject, String) =
    req(HttpMethods.GET, path, user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      val body = responseAs[String]
      (body.parseJson.asJsObject, body)
    }

  private def names(j: JsObject): Vector[String] =
    j.fields("pipelines").convertTo[Vector[JsObject]].map(_.fields("name").convertTo[String])

  "GET /api/home-summary" should {

    "return 401 without a session" in {
      HttpRequest(HttpMethods.GET, "/api/home-summary") ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "return an empty, schema-valid summary for a new user" in {
      resetPipelines()
      val (j, body) = get(userC)
      j.fields("pipelines") shouldBe JsArray()
      j.fields("attention") shouldBe JsArray()
      j.fields("upNext") shouldBe JsArray()
      j.fields("pipelinesWithActivity") shouldBe JsNumber(0)
      JsonSchemaValidation.validationErrors(schema, body) shouldBe empty
    }

    "return a real response that validates against the schema (explicit nulls included)" in {
      resetPipelines()
      val now = Instant.now()
      val p   = seedPipelineFor(userA, "orders-sync")
      seedRun(p, "succeeded", now.minusSeconds(2 * 3600), rowCount = Some(12))
      seedRun(p, "failed", now.minusSeconds(3 * 3600), errorLog = Some("source returned 0 rows"))
      seedRun(p, "running", now.minusSeconds(40 * 60))
      seedRun(p, "dry_run", now.minusSeconds(600))
      seedSchedule(p, "cron", "0 * * * *", Some(now.plusSeconds(1800)))
      val (j, body) = get(userA)
      JsonSchemaValidation.validationErrors(schema, body) shouldBe empty
      val item = j.fields("pipelines").convertTo[Vector[JsObject]].head
      item.fields("runs").convertTo[Vector[JsObject]].map(_.fields("status").convertTo[String]).toSet shouldBe Set("succeeded", "failed", "running")
      j.fields("attention").convertTo[Vector[JsObject]].map(_.fields("kind").convertTo[String]).toSet shouldBe Set("failed", "stuck")
      j.fields("upNext").convertTo[Vector[JsValue]] should have size 1
      j.fields("dashboardChanges") shouldBe JsArray()
    }

    "make another user's pipelines, runs, fires and attention items invisible" in {
      resetPipelines()
      val now = Instant.now()
      val a   = seedPipelineFor(userA, "a-secret")
      seedRun(a, "failed", now.minusSeconds(3600), errorLog = Some("a-only"))
      seedSchedule(a, "interval", "1h", Some(now.plusSeconds(600)))
      val (j, body) = get(userB)
      names(j) shouldBe empty
      j.fields("attention") shouldBe JsArray()
      j.fields("upNext") shouldBe JsArray()
      body should not include "a-secret"
      names(get(userA)._1) shouldBe Vector("a-secret")
    }

    "issue no per-pipeline work: a user with many pipelines still gets one bounded response" in {
      resetPipelines()
      val now = Instant.now()
      (1 to 12).foreach { i =>
        val p = seedPipelineFor(userA, s"p$i")
        seedRun(p, "succeeded", now.minusSeconds(i * 600L))
      }
      val (j, _) = get(userA)
      j.fields("pipelines").convertTo[Vector[JsValue]] should have size 8
      j.fields("pipelinesWithActivity") shouldBe JsNumber(12)
    }

    // Phase B (design D5): `dashboardIds` reuses HEL-1575's change-signal service and queries.
    "return dashboardChanges only for the requested, readable dashboards" in {
      resetPipelines()
      val mine  = seedDashboard(userA, "mine")
      val other = seedDashboard(userA, "not requested")
      val (j, body) = getPath(s"/api/home-summary?dashboardIds=$mine", userA)
      JsonSchemaValidation.validationErrors(schema, body) shouldBe empty
      val items = j.fields("dashboardChanges").convertTo[Vector[JsObject]]
      items.map(_.fields("dashboardId").convertTo[String]) shouldBe Vector(mine)
      items.head.fields("dataUpdatedAt") shouldBe JsNull
      items.head.fields("contentUpdatedAt").convertTo[String] should not be empty
      items.map(_.fields("dashboardId")) should not contain JsString(other)
    }

    "leave dashboardChanges empty without the parameter" in {
      seedDashboard(userA, "no param")
      getPath("/api/home-summary", userA)._1.fields("dashboardChanges") shouldBe JsArray()
    }

    "omit a dashboard the caller cannot read, with a 200 (RLS on the non-bypassing pool)" in {
      val private_ = seedDashboard(userA, "A private")
      val (j, _)   = getPath(s"/api/home-summary?dashboardIds=$private_", userB)
      j.fields("dashboardChanges") shouldBe JsArray()
    }

    "reject more than 20 dashboard ids and an empty id with 400" in {
      val ids21 = (1 to 21).map(i => s"d$i").mkString(",")
      req(HttpMethods.GET, s"/api/home-summary?dashboardIds=$ids21", userA) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      req(HttpMethods.GET, "/api/home-summary?dashboardIds=a,,b", userA) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      req(HttpMethods.GET, "/api/home-summary?dashboardIds=", userA) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }
}
