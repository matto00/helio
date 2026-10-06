package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{JsonSchemaValidation, OutputHistoryApiHarness}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{StatusCode, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.time.{Duration => JDuration}
import java.util.UUID
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

/** HEL-1273: `GET /api/outputs/:id/history` -- the D6 comparison resolution (nearest-before,
 *  no-baseline + availableFrom, previous_run), limit/since, the explicit-null wire shape, and
 *  sharing visibility under an app pool that does NOT bypass RLS. Fixtures put the newest point T at
 *  least 3 days before now and use distinct earliest / earliest+w / current+w instants so that a
 *  now-relative or earliest-relative implementation is killable (C7). */
class OutputHistoryRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var ownerId: String   = _
  private var granteeId: String = _
  private var otherId: String   = _
  private def user(id: String)  = AuthenticatedUser(UserId(id))

  override def beforeAll(): Unit = {
    super.beforeAll()
    startHarness()
    ownerId = seedUser(); granteeId = seedUser(); otherId = seedUser()
  }
  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private def routesFor(id: String): Route = new OutputRoutes(outputService, user(id), Some(historyService))(harnessEc).routes

  /** T: the newest point, >= 3 days before now (C7), millisecond precision. */
  private val T: Instant = Instant.now().minus(3, ChronoUnit.DAYS).minus(5, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MILLIS)
  private def ago(d: Instant, days: Long = 0, hours: Long = 0): Instant = d.minus(days, ChronoUnit.DAYS).minus(hours, ChronoUnit.HOURS)

  private def history(outputId: String, query: String = "", as: String = ownerId): JsObject =
    Get(s"/outputs/$outputId/history$query") ~> routesFor(as) ~> check {
      status shouldBe StatusCodes.OK
      responseAs[JsObject]
    }

  private def at(o: JsObject, key: String): Option[String] = o.fields(key) match {
    case JsNull => None
    case v      => Some(v.asJsObject.fields("capturedAt").convertTo[String])
  }
  private def num(o: JsValue): Option[Double] = o match { case JsNumber(n) => Some(n.toDouble); case _ => None }

  /** The D6 fixture: points at T-9d, T-8d, T-6d, T with distinct headline values. */
  private def seedWindowFixture(compare: String): (String, String) = {
    val (pid, oid) = seedMetricOutput(ownerId, Some(compare))
    addPoint(oid, pid, ago(T, days = 9), Some(10))
    addPoint(oid, pid, ago(T, days = 8), Some(20))
    addPoint(oid, pid, ago(T, days = 6), Some(30))
    addPoint(oid, pid, T, Some(50))
    (pid, oid)
  }

  "the app pool used by this spec" should {
    "not bypass row-level security (asserted before any 200/404 below)" in {
      appPoolBypassesRls() shouldBe false
    }
  }

  "GET /outputs/:id/history -- window baseline (nearest at or before latest - w)" should {
    "pick the T-8d point (not the now-relative T-6d, not the earliest) and null availableFrom" in {
      val (_, oid) = seedWindowFixture("7d")
      val body     = history(oid)
      at(body, "current") shouldBe Some(T.toString)
      // T - 7d lies between T-8d and T-6d: nearest at-or-before is T-8d. A target measured from now
      // (now - 7d = ~T-4d) would select T-6d; an earliest-relative one T-9d.
      at(body, "baseline") shouldBe Some(ago(T, days = 8).toString)
      num(body.fields("delta")) shouldBe Some(30.0)
      num(body.fields("pct")) shouldBe Some(150.0)
      body.fields("availableFrom") shouldBe JsNull
      body.fields("compare") shouldBe JsString("7d")
    }

    "limit=1 narrows points and sparkline to the T point while the baseline is unchanged" in {
      val (_, oid) = seedWindowFixture("7d")
      val body     = history(oid, "?limit=1")
      body.fields("points").convertTo[Vector[JsObject]].map(_.fields("capturedAt")) shouldBe Vector(JsString(T.toString))
      body.fields("sparkline").convertTo[Vector[JsObject]].map(_.fields("capturedAt")) shouldBe Vector(JsString(T.toString))
      at(body, "baseline") shouldBe Some(ago(T, days = 8).toString)
      num(body.fields("delta")) shouldBe Some(30.0)
    }

    "list points newest first and the sparkline oldest first with the headline values" in {
      val (_, oid) = seedWindowFixture("7d")
      val body     = history(oid)
      body.fields("points").convertTo[Vector[JsObject]].map(_.fields("capturedAt").convertTo[String]) shouldBe
        Vector(T, ago(T, days = 6), ago(T, days = 8), ago(T, days = 9)).map(_.toString)
      val spark = body.fields("sparkline").convertTo[Vector[JsObject]]
      spark.map(_.fields("capturedAt").convertTo[String]) shouldBe Vector(ago(T, days = 9), ago(T, days = 8), ago(T, days = 6), T).map(_.toString)
      spark.map(p => num(p.fields("value"))) shouldBe Vector(Some(10.0), Some(20.0), Some(30.0), Some(50.0))
    }

    "work for a custom duration and a 1d window" in {
      val (_, oid) = seedWindowFixture("custom:P7DT12H")
      // T - 7.5d = T-7d-12h -> nearest at or before is T-8d
      at(history(oid), "baseline") shouldBe Some(ago(T, days = 8).toString)
      val (_, oid1) = seedWindowFixture("1d")
      // T - 1d: nearest at or before is T-6d
      at(history(oid1), "baseline") shouldBe Some(ago(T, days = 6).toString)
    }
  }

  "GET /outputs/:id/history -- window boundary" should {
    "pick a point exactly at latest - w (microsecond-exact), not the 1us-earlier decoy nor the 1us-later point" in {
      // Microsecond-exact: Postgres timestamptz stores micros, so every seeded instant has getNano % 1000 == 0
      // and a non-millisecond micro component; the wire read-back below proves nothing was rounded.
      val latest   = T.minus(JDuration.ofDays(1)).plus(JDuration.ofNanos(123_456_000L))
      val boundary = latest.minus(JDuration.ofDays(7))
      val before   = boundary.minus(JDuration.ofNanos(1000))
      val after    = boundary.plus(JDuration.ofNanos(1000))
      Seq(latest, boundary, before, after).foreach(_.getNano % 1000 shouldBe 0)
      boundary.getNano % 1000000 should not be 0
      val (pid, oid) = seedMetricOutput(ownerId, Some("7d"))
      addPoint(oid, pid, before, Some(10))
      addPoint(oid, pid, boundary, Some(20))
      addPoint(oid, pid, after, Some(40))
      addPoint(oid, pid, latest, Some(50))
      val body = history(oid)
      at(body, "current") shouldBe Some(latest.toString)
      // Under `<` the query would return the b-1us decoy (value 10); a b+1us pick would give delta 10.
      at(body, "baseline") shouldBe Some(boundary.toString)
      num(body.fields("delta")) shouldBe Some(30.0)
      num(body.fields("pct")) shouldBe Some(150.0)
      body.fields("availableFrom") shouldBe JsNull
    }
  }

  "GET /outputs/:id/history -- no baseline yet" should {
    "return a null baseline and availableFrom = earliest + w (not earliest, not current + w)" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("7d"))
      addPoint(oid, pid, ago(T, days = 3), Some(10))
      addPoint(oid, pid, T, Some(50))
      val body = history(oid)
      at(body, "current") shouldBe Some(T.toString)
      body.fields("baseline") shouldBe JsNull
      body.fields("delta") shouldBe JsNull
      body.fields("pct") shouldBe JsNull
      // earliest = T-3d, earliest + 7d = T+4d, current + 7d = T+7d: all three distinct.
      body.fields("availableFrom") shouldBe JsString(ago(T, days = 3).plus(7, ChronoUnit.DAYS).toString)
    }

    "return every resolved field null for an empty history, for any compare value" in {
      Seq("previous_run", "7d").foreach { c =>
        val (_, oid) = seedMetricOutput(ownerId, Some(c))
        val body     = history(oid)
        Seq("current", "baseline", "delta", "pct", "availableFrom").foreach(k => withClue(s"$c/$k: ")(body.fields(k) shouldBe JsNull))
        body.fields("compare") shouldBe JsString(c)
        body.fields("points") shouldBe JsArray()
        body.fields("sparkline") shouldBe JsArray()
      }
    }
  }

  "GET /outputs/:id/history -- previous_run" should {
    "use the second-newest retained point (not the newest)" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("previous_run"))
      addPoint(oid, pid, ago(T, hours = 2), Some(10))
      addPoint(oid, pid, ago(T, hours = 1), Some(40))
      addPoint(oid, pid, T, Some(50))
      val body = history(oid)
      at(body, "baseline") shouldBe Some(ago(T, hours = 1).toString)
      num(body.fields("delta")) shouldBe Some(10.0)
      body.fields("availableFrom") shouldBe JsNull
    }

    "return null baseline and null availableFrom with a single point" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("previous_run"))
      addPoint(oid, pid, T, Some(50))
      val body = history(oid)
      at(body, "current") shouldBe Some(T.toString)
      body.fields("baseline") shouldBe JsNull
      body.fields("availableFrom") shouldBe JsNull
    }
  }

  "GET /outputs/:id/history -- delta and pct arithmetic" should {
    "give a null pct (but a real delta) for a zero baseline" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("previous_run"))
      addPoint(oid, pid, ago(T, hours = 1), Some(0))
      addPoint(oid, pid, T, Some(5))
      val body = history(oid)
      num(body.fields("delta")) shouldBe Some(5.0)
      body.fields("pct") shouldBe JsNull
    }

    "use |baseline| for a negative baseline" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("previous_run"))
      addPoint(oid, pid, ago(T, hours = 1), Some(-10))
      addPoint(oid, pid, T, Some(-5))
      val body = history(oid)
      num(body.fields("delta")) shouldBe Some(5.0)
      num(body.fields("pct")) shouldBe Some(50.0)
    }

    "give null delta and pct when a point has no headline value, while rowCount stays present" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("previous_run"))
      addPoint(oid, pid, ago(T, hours = 1), None)
      addPoint(oid, pid, T, Some(5), rowCount = 7)
      val body = history(oid)
      body.fields("delta") shouldBe JsNull
      body.fields("pct") shouldBe JsNull
      body.fields("current").asJsObject.fields("rowCount") shouldBe JsNumber(7)
      body.fields("baseline").asJsObject.fields("value") shouldBe JsNull
    }
  }

  "GET /outputs/:id/history -- no compare configured" should {
    "give null compare/baseline/delta/pct/availableFrom but still the current point; explicit nulls on the wire" in {
      val (pid, oid) = seedMetricOutput(ownerId, None)
      addPoint(oid, pid, ago(T, hours = 1), Some(1))
      addPoint(oid, pid, T, Some(5))
      val body = history(oid)
      Seq("compare", "baseline", "delta", "pct", "availableFrom").foreach { k =>
        withClue(s"$k must be PRESENT as explicit null: ")(body.fields.get(k) shouldBe Some(JsNull))
      }
      at(body, "current") shouldBe Some(T.toString)
    }

    "degrade a stored unparsable compare to no comparison (200, never 500)" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("bogus"))
      addPoint(oid, pid, T, Some(5))
      val body = history(oid)
      body.fields("compare") shouldBe JsNull
      body.fields("baseline") shouldBe JsNull
      at(body, "current") shouldBe Some(T.toString)
    }
  }

  "GET /outputs/:id/history -- since and limit" should {
    "return the newest `limit` points and honour `since`" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("previous_run"))
      (0 until 5).foreach(i => addPoint(oid, pid, ago(T, hours = (4 - i).toLong), Some(i.toDouble)))
      def pointTimes(q: String): Vector[String] = history(oid, q).fields("points").convertTo[Vector[JsObject]].map(_.fields("capturedAt").convertTo[String])
      pointTimes("?limit=2") shouldBe Vector(T, ago(T, hours = 1)).map(_.toString)
      // `since` between the 2nd- and 3rd-newest points -> only the two newest.
      pointTimes(s"?since=${ago(T, hours = 1).minusSeconds(60)}") shouldBe Vector(T, ago(T, hours = 1)).map(_.toString)
      pointTimes(s"?since=${T.plusSeconds(1)}") shouldBe Vector.empty
      pointTimes(s"?limit=1&since=${ago(T, hours = 3)}") shouldBe Vector(T.toString)
      pointTimes("").size shouldBe 5
    }

    "400 an out-of-range or malformed limit/since, never clamping" in {
      val (_, oid) = seedMetricOutput(ownerId, None)
      Seq("?limit=0", "?limit=101", "?limit=abc", "?limit=-1", "?limit=", "?since=yesterday", "?since=2026-13-45T00:00:00Z", "?since=").foreach { q =>
        withClue(s"query '$q': ") {
          Get(s"/outputs/$oid/history$q") ~> routesFor(ownerId) ~> check { status shouldBe StatusCodes.BadRequest }
        }
      }
      Get(s"/outputs/$oid/history?limit=100") ~> routesFor(ownerId) ~> check { status shouldBe StatusCodes.OK }
      Get(s"/outputs/$oid/history?limit=1") ~> routesFor(ownerId) ~> check { status shouldBe StatusCodes.OK }
    }
  }

  "GET /outputs/:id/history -- sharing visibility (app pool does not bypass RLS)" should {
    def statusAndBody(id: String, as: String): (StatusCode, String) =
      Get(s"/outputs/$id/history") ~> routesFor(as) ~> check { (status, responseAs[String]) }

    "serve the owner and a viewer grantee, and 404 a non-grantee byte-identically to an unknown id" in {
      assertAppPoolEnforcesRls()
      val (pid, oid) = seedMetricOutput(ownerId, Some("previous_run"))
      addPoint(oid, pid, T, Some(5))
      grantPipeline(pid, granteeId, "viewer")

      statusAndBody(oid, ownerId)._1 shouldBe StatusCodes.OK
      statusAndBody(oid, granteeId)._1 shouldBe StatusCodes.OK
      val unknown     = statusAndBody(UUID.randomUUID().toString, otherId)
      val nonGrantee  = statusAndBody(oid, otherId)
      nonGrantee._1 shouldBe StatusCodes.NotFound
      nonGrantee shouldBe unknown
      statusAndBody(oid, otherId) shouldBe statusAndBody(UUID.randomUUID().toString, ownerId)
    }
  }

  "GET /outputs/:id/history -- wire contract (schema seam)" should {
    val schema = JsonSchemaValidation.compile("outputs/output-history-response.schema.json")
    def errors(raw: String): Vector[String] = JsonSchemaValidation.validationErrors(schema, raw)

    "validate a hand-seeded response, with every nullable field an explicit null" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("7d"))
      addPoint(oid, pid, T, Some(5))
      Get(s"/outputs/$oid/history") ~> routesFor(ownerId) ~> check {
        val raw = responseAs[String]
        errors(raw) shouldBe Vector.empty
        raw.parseJson.asJsObject.fields("baseline") shouldBe JsNull
      }
    }

    "validate the empty-history response" in {
      val (_, oid) = seedMetricOutput(ownerId, None)
      Get(s"/outputs/$oid/history") ~> routesFor(ownerId) ~> check { errors(responseAs[String]) shouldBe Vector.empty }
    }

    "the schema rejects a response with a nullable field omitted (guard has teeth)" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("7d"))
      addPoint(oid, pid, T, Some(5))
      Get(s"/outputs/$oid/history") ~> routesFor(ownerId) ~> check {
        val dropped = JsObject(responseAs[JsObject].fields - "availableFrom").compactPrint
        errors(dropped) should not be empty
      }
    }

    "validate a response produced by REAL pipeline runs through PipelineRunService" in {
      val (pipelineId, outputId) = seedRunnablePipeline(ownerId, "previous_run")
      val svc = runService()
      val u   = user(ownerId)
      awaitDb(svc.submit(pipelineId, isDry = false, u)) shouldBe a[Right[_, _]]
      awaitDb(svc.submit(pipelineId, isDry = false, u)) shouldBe a[Right[_, _]]
      Get(s"/outputs/${outputId.value}/history") ~> routesFor(ownerId) ~> check {
        status shouldBe StatusCodes.OK
        val raw  = responseAs[String]
        val body = raw.parseJson.asJsObject
        errors(raw) shouldBe Vector.empty
        body.fields("points").convertTo[Vector[JsObject]].size shouldBe 2
        // sum of 3,6,9,12,15, computed server-side over all rows and stored on the point.
        body.fields("current").asJsObject.fields("value") shouldBe JsNumber(45)
        body.fields("current").asJsObject.fields("rowCount") shouldBe JsNumber(5)
        body.fields("delta") shouldBe JsNumber(0)
        body.fields("pct") shouldBe JsNumber(0)
      }
    }
  }
}
