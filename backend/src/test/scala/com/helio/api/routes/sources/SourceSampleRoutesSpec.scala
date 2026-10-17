package com.helio.api.routes.sources

import com.helio.testsupport.{DatasetRowsTestSupport, JsonSchemaValidation, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, HttpRequest, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID

/** HEL-1628 tasks 3.1-3.3: `GET /api/data-sources/:id/sample` over the full route tree on the restricted
 *  (non-BYPASSRLS) application role. Users share one limiter per spec, so the request-count tests use user C only. */
class SourceSampleRoutesSpec extends TwoUserRlsApiFixture {

  private val schema = JsonSchemaValidation.compile("sources/source-sample-response.schema.json")

  private def seedDataset(owner: String, name: String, rowCount: Int): String = {
    val id = UUID.randomUUID().toString
    val payload = JsObject(
      "columns" -> JsArray(JsObject("name" -> JsString("n"), "type" -> JsString("float")), JsObject("name" -> JsString("label"), "type" -> JsString("string"))),
      "rows"    -> JsArray((1 to rowCount).map(i => JsArray(JsNumber(i), JsString(s"secret-$name-$i"))).toVector)
    )
    await(privilegedDb.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($id, $name, 'dataset', '{}', $owner::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActions(id, payload)
    )))
    id
  }

  private def sampleOf(path: String, user: String) = req(HttpMethods.GET, path, user)

  private def count(table: String): Int =
    await(superDb.run(sql"SELECT count(*) FROM #$table".as[Int])).head

  private def requestSum(): Int =
    await(superDb.run(sql"SELECT COALESCE(SUM(request_count), 0) FROM pipeline_run_rate_window".as[Int])).head

  "GET /api/data-sources/:id/sample" should {

    "return 401 without a session" in {
      HttpRequest(HttpMethods.GET, s"/api/data-sources/${UUID.randomUUID()}/sample") ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "serve the owner a schema-valid sample, and another user the same 404 as an unknown id, with no rows (restricted role)" in {
      val id = seedDataset(userA, "orders", 3)
      sampleOf(s"/api/data-sources/$id/sample", userA) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[String]
        JsonSchemaValidation.validationErrors(schema, body) shouldBe empty
        val j = body.parseJson.asJsObject
        j.fields("rows").convertTo[Vector[JsValue]] should have size 3
        j.fields("sourceRowCount") shouldBe JsNumber(3)
        j.fields("truncated") shouldBe JsBoolean(false)
        j.fields("live") shouldBe JsBoolean(false)
      }
      sampleOf(s"/api/data-sources/$id/sample", userB) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[String] should not include "secret-orders"
      }
      var unknownBody = ""
      sampleOf(s"/api/data-sources/${UUID.randomUUID()}/sample", userB) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
        unknownBody = responseAs[String]
      }
      sampleOf(s"/api/data-sources/$id/sample", userB) ~> routes ~> check {
        responseAs[String] shouldBe unknownBody
      }
    }

    "cap a dataset sample at 1000 rows and report the true total" in {
      val id = seedDataset(userA, "big", 1200)
      sampleOf(s"/api/data-sources/$id/sample", userA) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val j = responseAs[String].parseJson.asJsObject
        j.fields("rows").convertTo[Vector[JsValue]] should have size 1000
        j.fields("sourceRowCount") shouldBe JsNumber(1200)
        j.fields("truncated") shouldBe JsBoolean(true)
      }
    }

    "charge the source-fetch limiter (31st request is 429 + Retry-After, shared with /preview) and never the run guard" in {
      val id = seedDataset(userC, "limited", 2)
      val runsBefore   = count("pipeline_runs")
      val windowBefore = count("pipeline_run_rate_window")
      val sumBefore    = requestSum()
      (1 to 29).foreach { _ =>
        sampleOf(s"/api/data-sources/$id/sample", userC) ~> routes ~> check { status shouldBe StatusCodes.OK }
      }
      // The 30th request is a /preview: the sample and the preview draw on one bucket.
      sampleOf(s"/api/data-sources/$id/preview", userC) ~> routes ~> check { status shouldBe StatusCodes.OK }
      sampleOf(s"/api/data-sources/$id/sample", userC) ~> routes ~> check {
        status shouldBe StatusCodes.TooManyRequests
        header("Retry-After") should not be empty
      }
      sampleOf(s"/api/data-sources/$id/preview", userC) ~> routes ~> check { status shouldBe StatusCodes.TooManyRequests }
      count("pipeline_runs") shouldBe runsBefore
      count("pipeline_run_rate_window") shouldBe windowBefore
      requestSum() shouldBe sumBefore
    }
  }
}
