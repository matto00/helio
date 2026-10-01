package com.helio.api.routes.admin

import com.helio.api.{ApiRoutes, JsonProtocols}
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.telemetry.ProductEventRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.services.telemetry.{ProductEventRollupService, ProductTelemetryConfig}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.{Instant, LocalDate, ZoneOffset}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1211: `GET /api/admin/usage` over the real `ApiRoutes` mount. The 403 gate is asserted for
 *  free and beta (red-first: the first run of these tests used a permissive stub gate and failed
 *  with 200s), the owner gets 200, `days` validation is 400-not-clamped, and one end-to-end run
 *  drives events through the REAL `POST /api/events` write path and the REAL rollup service
 *  before asserting exact numbers over HTTP (no hand-inserted rollup rows). */
class AdminUsageRoutesSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var routes: Route                      = _

  private val freeId  = "00000000-0000-0000-0000-0000000011f1"
  private val betaId  = "00000000-0000-0000-0000-0000000011b1"
  private val ownerId = "00000000-0000-0000-0000-0000000011c1"
  private val tokens: Map[String, UserId] =
    Map("free-token" -> UserId(freeId), "beta-token" -> UserId(betaId), "owner-token" -> UserId(ownerId))

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                       = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                     = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                          = Future.successful(())
    def exists(path: String): Future[Boolean]                                                       = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  private val sessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(tokens.get(token).map(AuthenticatedUser(_)))
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    val e = typedSystem.executionContext
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)(e)
    val dataSource = new DataSourceRepository(ctx)(e)
    Seq((freeId, "free"), (betaId, "beta"), (ownerId, "owner")).foreach { case (id, tier) =>
      Await.result(db.run(sqlu"INSERT INTO users (id, email, tier, created_at) VALUES ($id::uuid, ${tier + "@admin-usage.local"}, $tier, now())"), 5.seconds)
    }
    routes = new ApiRoutes(
      new DashboardRepository(ctx)(e), new PanelRepository(ctx)(e), dataSource, new ResourcePermissionRepository(ctx)(e), stubFileSystem,
      new RestApiConnectorDriver(Some(_ => Future.successful(Left("no http")))),
      new UserRepository(db)(e), sessionRepo, new UserPreferenceRepository(db)(e), new PipelineRepository(ctx, dataSource)(e), new PipelineStepRepository(ctx)(e),
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSource, new PipelineRepository(ctx, dataSource)(e))(e),
      dbContext = ctx,
      productTelemetryConfig = ProductTelemetryConfig(rateLimitPerWindow = 1000, retentionDays = 90)
    ).routes
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def as(token: String): Route = {
    val csrf = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
    mapRequest((req: HttpRequest) => req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> token) :+ csrf))(routes)
  }

  private def json(s: String) = HttpEntity(ContentTypes.`application/json`, s)
  private def body: JsObject  = responseAs[String].parseJson.asJsObject
  private def n(v: JsValue): Long = v.asInstanceOf[JsNumber].value.toLongExact

  "GET /api/admin/usage" should {

    "return 403 TIER_FORBIDDEN for a free-tier user and no aggregate data" in {
      Get("/api/admin/usage") ~> as("free-token") ~> check {
        status shouldBe StatusCodes.Forbidden
        body.fields("code") shouldBe JsString("TIER_FORBIDDEN")
        body.fields.keySet should not contain "signupsPerDay"
      }
    }

    "return 403 for a beta-tier user" in {
      Get("/api/admin/usage") ~> as("beta-token") ~> check {
        status shouldBe StatusCodes.Forbidden
        body.fields("code") shouldBe JsString("TIER_FORBIDDEN")
      }
    }

    "return 403 (not a 400) for a non-owner even with an invalid days value" in {
      Get("/api/admin/usage?days=abc") ~> as("beta-token") ~> check { status shouldBe StatusCodes.Forbidden }
    }

    "return 401 without a session" in {
      Get("/api/admin/usage") ~> routes ~> check { status shouldBe StatusCodes.Unauthorized }
    }

    "return 200 for an owner, with a zero-filled window ending today when nothing is rolled up" in {
      Get("/api/admin/usage?days=7") ~> as("owner-token") ~> check {
        status shouldBe StatusCodes.OK
        val b = body
        b.fields("rolledThrough") shouldBe JsNull
        b.fields("signupsPerDay").asInstanceOf[JsArray].elements.size shouldBe 7
        b.fields("signupsPerDay").asInstanceOf[JsArray].elements.map(e => n(e.asJsObject.fields("count"))).sum shouldBe 0
        b.fields("templateChoices") shouldBe JsArray()
        b.fields("ttfd").asJsObject.fields("latest") shouldBe JsNull
        b.fields("ttfd").asJsObject.fields("newUsersOnly") shouldBe JsTrue
        b.fields("funnel").asInstanceOf[JsArray].elements.map(e => n(e.asJsObject.fields("users"))) shouldBe Vector(0L, 0L, 0L)
        b.fields("activeUsers").asInstanceOf[JsArray].elements.head.asJsObject.fields("weeklyActiveUsers") shouldBe JsNull
      }
    }

    "default to a 30-day window" in {
      Get("/api/admin/usage") ~> as("owner-token") ~> check {
        status shouldBe StatusCodes.OK
        body.fields("days") shouldBe JsNumber(30)
        body.fields("signupsPerDay").asInstanceOf[JsArray].elements.size shouldBe 30
      }
    }

    "accept the 1 and 90 day bounds" in {
      Get("/api/admin/usage?days=1") ~> as("owner-token") ~> check { status shouldBe StatusCodes.OK }
      Get("/api/admin/usage?days=90") ~> as("owner-token") ~> check { status shouldBe StatusCodes.OK }
    }

    "reject a non-numeric, zero, negative or over-90 days with 400 (never clamped)" in {
      Seq("abc", "0", "-3", "91", "1000", "2.5").foreach { d =>
        Get(s"/api/admin/usage?days=$d") ~> as("owner-token") ~> check { withClue(s"days=$d: ") { status shouldBe StatusCodes.BadRequest } }
      }
    }

    "report exact numbers for events written through POST /api/events and rolled up by the real rollup" in {
      Await.result(db.run(sqlu"DELETE FROM product_events"), 5.seconds)
      val svcClock = new Clock { def now(): Instant = Instant.now() }
      Post("/api/events", json("""{"events":[{"event":"provenance_opened"},{"event":"provenance_opened"},{"event":"firstrun_file_dropped","properties":{"source":"drop"}},{"event":"firstrun_template_chosen","properties":{"template":"streamer"}}]}""")) ~> as("owner-token") ~> check {
        status shouldBe StatusCodes.Accepted
      }
      Post("/api/events", json("""{"events":[{"event":"provenance_opened"},{"event":"firstrun_dashboard_created","properties":{"panelCount":3}}]}""")) ~> as("beta-token") ~> check {
        status shouldBe StatusCodes.Accepted
      }
      val e       = typedSystem.executionContext
      val rollup  = new ProductEventRollupService(new ProductEventRepository(ctx)(e), ProductTelemetryConfig(1000, 90), svcClock)(e)
      val today   = svcClock.now().atOffset(ZoneOffset.UTC).toLocalDate
      Await.result(rollup.tickAt(svcClock.now().plusSeconds(3 * 86400L)), 20.seconds)
      Get("/api/admin/usage?days=7") ~> as("owner-token") ~> check {
        status shouldBe StatusCodes.OK
        val b    = body
        val opens = b.fields("provenanceOpensPerDay").asInstanceOf[JsArray].elements.map(_.asJsObject)
        opens.map(o => o.fields("day").convertTo[String] -> n(o.fields("count"))).filter(_._2 > 0) shouldBe Vector(today.toString -> 3L)
        b.fields("funnel").asInstanceOf[JsArray].elements.map(e => n(e.asJsObject.fields("users"))) shouldBe Vector(1L, 1L, 0L)
        b.fields("templateChoices") shouldBe JsArray(JsObject("template" -> JsString("streamer"), "count" -> JsNumber(1)))
        n(b.fields("activeUsers").asInstanceOf[JsArray].elements.map(_.asJsObject).find(_.fields("day") == JsString(today.toString)).get.fields("dailyActiveUsers")) shouldBe 2L
      }
      Await.result(db.run(sqlu"DELETE FROM product_events"), 5.seconds)
    }
  }
}
