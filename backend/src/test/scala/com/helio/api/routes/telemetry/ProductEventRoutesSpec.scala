package com.helio.api.routes.telemetry

import com.helio.api.{ApiRoutes, JsonProtocols}
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.services.telemetry.ProductTelemetryConfig
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.HelioRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1208: `POST /api/events` over the real `ApiRoutes` mount -- auth, allow-list 400s, dedupe,
 *  and its own rate limiter (separate from the general `/api` one). */
class ProductEventRoutesSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var repos: Repos                       = _

  private final case class Repos(
      dashboard: DashboardRepository, panel: PanelRepository, dataSource: DataSourceRepository,
      permission: ResourcePermissionRepository, user: UserRepository, pref: UserPreferenceRepository,
      pipeline: PipelineRepository, step: PipelineStepRepository
  )

  private val testUserId = "00000000-0000-0000-0000-0000000000a1"
  private val testToken  = "valid-events-token"
  private val testUser   = AuthenticatedUser(UserId(testUserId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    val e = typedSystem.executionContext
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)(e)
    val dataSource = new DataSourceRepository(ctx)(e)
    repos = Repos(new DashboardRepository(ctx)(e), new PanelRepository(ctx)(e), dataSource, new ResourcePermissionRepository(ctx)(e),
      new UserRepository(db)(e), new UserPreferenceRepository(db)(e), new PipelineRepository(ctx, dataSource)(e), new PipelineStepRepository(ctx)(e))
    Await.result(db.run(sqlu"INSERT INTO users (id, email, created_at) VALUES ($testUserId::uuid, 'events-spec@test.local', now())"), 5.seconds)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                       = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                     = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                          = Future.successful(())
    def exists(path: String): Future[Boolean]                                                       = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  private val sessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == testToken) Some(testUser) else None)
  }

  private def rawRoutes(limit: Int): Route =
    new ApiRoutes(
      repos.dashboard, repos.panel, repos.dataSource, repos.permission, stubFileSystem,
      new RestApiConnectorDriver(Some(_ => Future.successful(Left("no http")))),
      repos.user, sessionRepo, repos.pref, repos.pipeline, repos.step,
      new PipelineRunCache(), new SparkJobSubmitter("local", repos.dataSource, repos.pipeline)(typedSystem.executionContext),
      dbContext = ctx,
      productTelemetryConfig = ProductTelemetryConfig(rateLimitPerWindow = limit, retentionDays = 90)
    ).routes

  private def authed(limit: Int = 100): Route = {
    val csrf = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
    mapRequest((req: HttpRequest) => req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> testToken) :+ csrf))(rawRoutes(limit))
  }

  private def body(json: String) = HttpEntity(ContentTypes.`application/json`, json)
  private def storedCount(event: String): Int =
    Await.result(db.run(sql"SELECT COUNT(*) FROM product_events WHERE event = $event AND user_id = $testUserId::uuid".as[Int].head), 5.seconds)
  private def clean(): Unit = Await.result(db.run(sqlu"DELETE FROM product_events"), 5.seconds)

  "POST /api/events" should {

    "store a valid batch for the caller and return 202" in {
      clean()
      Post("/api/events", body("""{"events":[{"event":"provenance_opened"},{"event":"firstrun_file_dropped","properties":{"source":"paste"}}]}""")) ~> authed() ~> check {
        status shouldBe StatusCodes.Accepted
      }
      storedCount("provenance_opened") shouldBe 1
      storedCount("firstrun_file_dropped") shouldBe 1
    }

    "reject an unknown event with 400 and store nothing" in {
      clean()
      Post("/api/events", body("""{"events":[{"event":"provenance_opened"},{"event":"page_viewed"}]}""")) ~> authed() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      storedCount("provenance_opened") shouldBe 0
    }

    "reject an unknown property with 400" in {
      Post("/api/events", body("""{"events":[{"event":"provenance_opened","properties":{"url":"https://x"}}]}""")) ~> authed() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject a forged signup_completed with 400" in {
      clean()
      Post("/api/events", body("""{"events":[{"event":"signup_completed"}]}""")) ~> authed() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      storedCount("signup_completed") shouldBe 0
    }

    "reject an empty batch and an oversize batch with 400" in {
      Post("/api/events", body("""{"events":[]}""")) ~> authed() ~> check { status shouldBe StatusCodes.BadRequest }
      val big = (1 to 26).map(_ => """{"event":"provenance_opened"}""").mkString("""{"events":[""", ",", "]}")
      Post("/api/events", body(big)) ~> authed() ~> check { status shouldBe StatusCodes.BadRequest }
    }

    "accept a repeated first_dashboard_rendered with 202 both times and store one row" in {
      clean()
      val payload = """{"events":[{"event":"first_dashboard_rendered","properties":{"panelCount":2}}]}"""
      Post("/api/events", body(payload)) ~> authed() ~> check { status shouldBe StatusCodes.Accepted }
      Post("/api/events", body(payload)) ~> authed() ~> check { status shouldBe StatusCodes.Accepted }
      storedCount("first_dashboard_rendered") shouldBe 1
    }

    "require authentication" in {
      Post("/api/events", body("""{"events":[{"event":"provenance_opened"}]}""")) ~> rawRoutes(100) ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "return 429 with Retry-After once the events-specific budget is exhausted" in {
      val route = authed(limit = 2)
      val payload = """{"events":[{"event":"provenance_opened"}]}"""
      Post("/api/events", body(payload)) ~> route ~> check { status shouldBe StatusCodes.Accepted }
      Post("/api/events", body(payload)) ~> route ~> check { status shouldBe StatusCodes.Accepted }
      Post("/api/events", body(payload)) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
        header("Retry-After") should not be empty
      }
    }
  }
}
