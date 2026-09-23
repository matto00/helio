package com.helio.api

import com.helio.api.http.{AuthDirectives, SessionCookies}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.services.pipelines.PipelineRunGuardConfig
import spray.json._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.util.UUID
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** HEL-505 tasks.md 5.1/5.2/8.5/8.6 -- proves `SourcePreviewRoutes`/`DataSourcePreviewRoutes` are
 *  actually wrapped with the TIGHTER `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW` limit at their
 *  `ApiRoutes` mount site (design.md Decision 6), and that pipeline `analyze` is deliberately NOT
 *  (design.md Decision 5, C5) -- a regression guard against a future reader "fixing" that as a
 *  missed AC. Mirrors `ApiRoutesSpec`'s minimal `rawRoutes()`-construction pattern. */
class ApiRoutesPipelineRunGuardSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var dashboardRepo: DashboardRepository           = _
  private var panelRepo: PanelRepository                   = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var userRepo: UserRepository                     = _
  private var userPreferenceRepo: UserPreferenceRepository = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository             = _
  private var pipelineStepRepo: PipelineStepRepository     = _
  private var ctx: DbContext                               = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)(typedSystem.executionContext)
    dashboardRepo      = new DashboardRepository(ctx)(typedSystem.executionContext)
    panelRepo           = new PanelRepository(ctx)(typedSystem.executionContext)
    dataSourceRepo      = new DataSourceRepository(ctx)(typedSystem.executionContext)
    userRepo            = new UserRepository(db)(typedSystem.executionContext)
    userPreferenceRepo   = new UserPreferenceRepository(db)(typedSystem.executionContext)
    permissionRepo       = new ResourcePermissionRepository(ctx)(typedSystem.executionContext)
    pipelineRepo         = new PipelineRepository(ctx, dataSourceRepo)(typedSystem.executionContext)
    pipelineStepRepo     = new PipelineStepRepository(ctx)(typedSystem.executionContext)

    import slick.jdbc.PostgresProfile.api._
    Await.result(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($testUserId::uuid, 'guard-spec@test.local', now())"""), 5.seconds)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                       = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                     = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                          = Future.successful(())
    def exists(path: String): Future[Boolean]                                                       = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  private val stubConnector: RestApiConnectorDriver =
    new RestApiConnectorDriver(Some(_ => Future.successful(Left("no real HTTP in tests"))))

  private val testUserId = "00000000-0000-0000-0000-000000000099"
  private val testToken  = "valid-test-token"
  private val testUser   = AuthenticatedUser(UserId(testUserId))

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == testToken) Some(testUser) else None)
  }

  /** Builds routes with a caller-supplied `PipelineRunGuardConfig` -- lets each test inject a
   *  tiny `sourceFetchRateLimitPerWindow` so the tighter limit can be exercised deterministically
   *  in a handful of requests, rather than needing 30 (the production default) per test. */
  private def routesWith(guardConfig: PipelineRunGuardConfig): Route = {
    val raw = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo, stubFileSystem, stubConnector,
      userRepo, stubSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
      dbContext = ctx,
      pipelineRunGuardConfig = guardConfig
    ).routes
    val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
    def withDefaultCredentials(req: HttpRequest): HttpRequest = {
      val withCookie =
        if (req.header[Cookie].exists(_.cookies.exists(_.name == SessionCookies.Name))) req
        else req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> testToken))
      if (withCookie.headers.exists(_.is(AuthDirectives.CsrfHeaderName.toLowerCase))) withCookie
      else withCookie.withHeaders(withCookie.headers :+ csrfHeader)
    }
    mapRequest(withDefaultCredentials)(raw)
  }

  private def seedDataset(): String = {
    import slick.jdbc.PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{"columns":[],"rows":[]}', $testUserId::uuid, now(), now())"""
    ))
    dsId
  }

  private def seedPipeline(dsId: String): String = {
    import slick.jdbc.PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $testUserId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    pid
  }

  "DataSourcePreviewRoutes (HEL-505 Decision 6)" should {

    "is wrapped with the tighter SOURCE_FETCH_RATE_LIMIT_PER_WINDOW limit -- rejects the (limit+1)th preview with 429 + Retry-After" in {
      val dsId = seedDataset()
      val guardConfig = PipelineRunGuardConfig(rateLimitPerWindow = 100, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 2)
      val route = routesWith(guardConfig)

      Get(s"/api/data-sources/$dsId/preview") ~> route ~> check { status shouldBe StatusCodes.OK }
      Get(s"/api/data-sources/$dsId/preview") ~> route ~> check { status shouldBe StatusCodes.OK }
      Get(s"/api/data-sources/$dsId/preview") ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
        header("Retry-After") should not be empty
      }
    }

    "normal usage strictly under the tighter limit is unaffected" in {
      val dsId = seedDataset()
      val guardConfig = PipelineRunGuardConfig(rateLimitPerWindow = 100, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 5)
      val route = routesWith(guardConfig)

      (1 to 4).foreach { _ =>
        Get(s"/api/data-sources/$dsId/preview") ~> route ~> check { status shouldBe StatusCodes.OK }
      }
    }
  }

  "SourcePreviewRoutes (HEL-505 Decision 6)" should {

    "is wrapped with the tighter SOURCE_FETCH_RATE_LIMIT_PER_WINDOW limit -- rejects the (limit+1)th test with 429 + Retry-After" in {
      val guardConfig = PipelineRunGuardConfig(rateLimitPerWindow = 100, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 1)
      val route = routesWith(guardConfig)
      val body = """{"type":"rest_api","url":"http://example.invalid","method":"GET"}"""

      Post("/api/sources/test", HttpEntity(ContentTypes.`application/json`, body)) ~> route ~> check {
        status should not be StatusCodes.TooManyRequests
      }
      Post("/api/sources/test", HttpEntity(ContentTypes.`application/json`, body)) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
        header("Retry-After") should not be empty
      }
    }
  }

  "Pipeline analyze (HEL-505 Decision 5, C5)" should {

    "is deliberately NOT subject to the tighter source-fetch limit -- exceeds it with zero 429s" in {
      val dsId = seedDataset()
      val pid  = seedPipeline(dsId)
      // A tighter limit low enough that `analyze` would 429 on the 2nd call if it were (wrongly)
      // wrapped the same way source-fetch/preview is.
      val guardConfig = PipelineRunGuardConfig(rateLimitPerWindow = 100, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 1)
      val route = routesWith(guardConfig)

      (1 to 3).foreach { _ =>
        Get(s"/api/pipelines/$pid/analyze") ~> route ~> check {
          status should not be StatusCodes.TooManyRequests
        }
      }
    }
  }
}
