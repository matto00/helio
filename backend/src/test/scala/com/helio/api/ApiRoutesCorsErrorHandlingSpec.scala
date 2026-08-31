package com.helio.api

import com.helio.api.http.{AuthDirectives, SessionCookies, TopLevelErrorHandlers}
import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{HttpResponse, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, HttpOrigin, Origin, RawHeader}
import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.JdbcBackend

import scala.concurrent.Future
import scala.jdk.CollectionConverters._

/** HEL-750: every response `ApiRoutes` returns -- success, curated error, or a
 *  response produced by handling an otherwise-unhandled exception/rejection -- must
 *  carry CORS headers for an allowed origin. Split into its own focused file rather
 *  than growing the already-oversized `ApiRoutesSpec.scala` further (mirrors
 *  `MfaApiRoutesSpec`'s precedent).
 *
 *  Simulates an unhandled exception with a `UserSessionRepository` whose
 *  `findValidSession` throws synchronously for one designated "poison" token. This
 *  reproduces the real incident's failure shape (a downstream repository call that
 *  fails outside any route's own `onComplete`/`Try` handling -- e.g. a HikariCP
 *  connection-acquisition failure) without requiring a real DB outage.
 */
class ApiRoutesCorsErrorHandlingSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var apiRoutes: Route                   = _

  // Matches ApiRoutes' own default `corsAllowedOrigins` (unspecified in the
  // construction below), so a request carrying this Origin is treated as an allowed
  // cross-origin caller.
  private val allowedOrigin    = "http://localhost:5173"
  // Not in ApiRoutes' default `corsAllowedOrigins` allowlist -- exercises the
  // `CorsRejection` `cors()` mints itself (design.md D6).
  private val disallowedOrigin = "http://evil.example.com"
  private val validToken    = "valid-test-token"
  private val poisonToken   = "poison-test-token"
  private val testUser      = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000099"))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))

    val ctx                = new DbContext(db, db)(typedSystem.executionContext)
    val dashboardRepo       = new DashboardRepository(ctx)(typedSystem.executionContext)
    val panelRepo           = new PanelRepository(ctx)(typedSystem.executionContext)
    val dataSourceRepo      = new DataSourceRepository(ctx)(typedSystem.executionContext)
    val userRepo            = new UserRepository(db)(typedSystem.executionContext)
    val userPreferenceRepo  = new UserPreferenceRepository(db)(typedSystem.executionContext)
    val permissionRepo      = new ResourcePermissionRepository(ctx)(typedSystem.executionContext)
    val pipelineRepo        = new PipelineRepository(ctx, dataSourceRepo)(typedSystem.executionContext)
    val pipelineStepRepo    = new PipelineStepRepository(ctx)(typedSystem.executionContext)

    val stubFileSystem: FileSystem = new FileSystem {
      def write(path: String, bytes: Array[Byte]): Future[Unit]                                       = Future.successful(())
      def read(path: String): Future[Array[Byte]]                                                       = Future.successful(Array.empty)
      def delete(path: String): Future[Unit]                                                            = Future.successful(())
      def exists(path: String): Future[Boolean]                                                         = Future.successful(false)
      def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
    }
    val connector = new RestApiConnectorDriver(Some(_ => Future.successful(Left("no real HTTP in tests"))))

    // HEL-750: `validToken` resolves normally; `poisonToken` throws synchronously
    // from inside the identity-resolution directive chain (before any Future/
    // onComplete wraps it), reproducing an unhandled exception that escapes route
    // evaluation exactly like a downstream HikariCP connection-acquisition failure
    // would.
    val poisonableSessionRepo: UserSessionRepository = new UserSessionRepository {
      override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
        token match {
          case `validToken`  => Future.successful(Some(testUser))
          case `poisonToken` => throw new RuntimeException("simulated DB connection failure (HEL-750 test)")
          case _             => Future.successful(None)
        }
    }

    apiRoutes = new ApiRoutes(
      dashboardRepo,
      panelRepo,
      dataSourceRepo,
      permissionRepo,
      stubFileSystem,
      connector,
      userRepo,
      poisonableSessionRepo,
      userPreferenceRepo,
      pipelineRepo,
      pipelineStepRepo,
      new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext)
    ).routes
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private val csrfHeader   = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
  private val originHeader = Origin(HttpOrigin(allowedOrigin))

  /** Attaches the session cookie for `token`, the CSRF header, and an allowed
   *  `Origin` header -- mirrors what a real cross-site browser request sends, so
   *  `cors()` actually has a cross-origin request to attach response headers for. */
  private def withCredentials(token: String): Route =
    mapRequest { req =>
      req.withHeaders(req.headers ++ Seq(Cookie(SessionCookies.Name -> token), csrfHeader, originHeader))
    } {
      apiRoutes
    }

  private def corsAllowOriginValue(response: HttpResponse): Option[String] =
    response.headers.find(_.is("access-control-allow-origin")).map(_.value)

  "ApiRoutes CORS + error handling (HEL-750)" should {

    "carry CORS headers on a response produced by an unhandled exception" in {
      Get("/api/dashboards") ~> withCredentials(poisonToken) ~> check {
        status shouldBe StatusCodes.InternalServerError
        corsAllowOriginValue(response) shouldBe Some(allowedOrigin)
      }
    }

    "return a generic ErrorResponse body with no raw exception/driver detail for an unhandled exception" in {
      Get("/api/dashboards") ~> withCredentials(poisonToken) ~> check {
        status shouldBe StatusCodes.InternalServerError
        val body = responseAs[ErrorResponse]
        body shouldBe ErrorResponse("Internal server error")
        body.message should not include "RuntimeException"
        body.message should not include "simulated DB connection failure"
      }
    }

    "carry CORS headers on a response produced by a rejection (no matching route)" in {
      Get("/api/this-route-does-not-exist") ~> withCredentials(validToken) ~> check {
        status shouldBe StatusCodes.NotFound
        corsAllowOriginValue(response) shouldBe Some(allowedOrigin)
        // Still a curated JSON ErrorResponse body, not Pekko's default plain-text.
        responseAs[ErrorResponse].message should not be empty
      }
    }

    "leave a successful response unaffected" in {
      Get("/api/dashboards") ~> withCredentials(validToken) ~> check {
        status shouldBe StatusCodes.OK
        corsAllowOriginValue(response) shouldBe Some(allowedOrigin)
      }
    }

    "leave an existing curated-error response unaffected" in {
      Delete("/api/dashboards/does-not-exist") ~> withCredentials(validToken) ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
        corsAllowOriginValue(response) shouldBe Some(allowedOrigin)
      }
    }

    // HEL-750 fold-in (design.md D6): `cors()` mints its own `CorsRejection` for a
    // disallowed Origin *before* control reaches the pair registered inside it, so
    // this exercises the outer `handleRejections(TopLevelErrorHandlers.corsRejectionHandler)`
    // wrapper specifically -- no session cookie/auth needed, since `cors()`'s origin
    // check runs ahead of the whole route tree (including `/health`).

    "reject a disallowed-Origin request with a curated 403 and no CORS headers" in {
      Get("/health").withHeaders(Origin(HttpOrigin(disallowedOrigin))) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.Forbidden
        corsAllowOriginValue(response) shouldBe None
        val body = responseAs[ErrorResponse]
        body.message should include("CORS request rejected")
        body.message should include(disallowedOrigin)
      }
    }

    "return no raw exception/stack detail in the disallowed-Origin response body" in {
      Get("/health").withHeaders(Origin(HttpOrigin(disallowedOrigin))) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.Forbidden
        val body = responseAs[ErrorResponse]
        body.message should not include "Exception"
        body.message should not include "RuntimeException"
        body.message should not include "at org.apache.pekko"
      }
    }

    "log a disallowed-Origin rejection at WARN with no stack trace, never ERROR" in {
      val logbackLogger = LoggerFactory.getLogger(TopLevelErrorHandlers.getClass).asInstanceOf[LogbackLogger]
      val appender       = new ListAppender[ILoggingEvent]()
      appender.start()
      logbackLogger.addAppender(appender)

      try {
        Get("/health").withHeaders(Origin(HttpOrigin(disallowedOrigin))) ~> apiRoutes ~> check {
          status shouldBe StatusCodes.Forbidden
        }

        val events     = appender.list.asScala.toSeq
        val corsEvents = events.filter(_.getFormattedMessage.contains("CORS request rejected"))
        corsEvents should not be empty
        corsEvents.foreach { e =>
          e.getLevel shouldBe Level.WARN
          Option(e.getThrowableProxy) shouldBe None
        }
        events.exists(_.getLevel == Level.ERROR) shouldBe false
      } finally {
        logbackLogger.detachAppender(appender)
      }
    }
  }
}
