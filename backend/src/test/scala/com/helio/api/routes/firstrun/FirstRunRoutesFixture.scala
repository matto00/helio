package com.helio.api.routes.firstrun

import com.helio.api._
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.api.protocols.firstrun.FirstRunDashboardResponse
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.ai._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.sources.DataSourceService
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.SystemMaterializer
import org.apache.pekko.stream.scaladsl.Source
import org.flywaydb.core.Flyway
import org.scalatest.{BeforeAndAfterAll, Suite}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** Shared full-`ApiRoutes` fixture for the first-run route specs: real RLS (embedded Postgres with a
 *  non-superuser app role), a real CSV filesystem, and a counting Claude transport wired through every
 *  Claude-bearing service so a spec can assert a build made zero model calls. */
trait FirstRunRoutesFixture
    extends Suite
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  protected implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  protected var embeddedPostgres: EmbeddedPostgres = _
  protected var appDb: JdbcBackend.Database        = _
  protected var privilegedDb: JdbcBackend.Database = _
  protected var ctx: DbContext                     = _
  protected var routes: Route                      = _
  protected var dataSourceService: DataSourceService = _

  protected val userId  = "00000000-0000-0000-0000-0000000000e1"
  protected val otherId = "00000000-0000-0000-0000-0000000000e2"
  protected val session = "valid-session"
  protected val otherSession = "other-session"
  protected val user    = AuthenticatedUser(UserId(userId))
  protected val other   = AuthenticatedUser(UserId(otherId))

  protected val claudeCalls = new AtomicInteger(0)

  protected class CountingTransport extends ClaudeTransport {
    protected def text(t: String) =
      ClaudeApiResponse("msg_test", Seq(ClaudeApiContentBlock("text", Some(t))), Some("end_turn"), ClaudeApiUsage(1, 1))
    override def send(request: ClaudeApiRequest) = { claudeCalls.incrementAndGet(); Future.successful(text("""{"dashboardName":"S","panels":[]}""")) }
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = {
      claudeCalls.incrementAndGet(); Source(List(ClaudeStreamEvent.MessageStop))
    }
    override def sendTool(request: ClaudeApiToolRequest) = { claudeCalls.incrementAndGet(); Future.successful(text("hi")) }
  }

  protected val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == session) Some(user) else if (token == otherSession) Some(other) else None)
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    val conn = superDs.getConnection
    try {
      val stmt = conn.createStatement()
      stmt.execute("""DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
        CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN; END IF; END $$""")
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally conn.close()
    def pool(role: String) = {
      val cfg = new HikariConfig(); cfg.setDataSource(superDs); cfg.setMaximumPoolSize(5)
      cfg.setConnectionInitSql(s"SET ROLE $role")
      JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(5))
    }
    privilegedDb = pool("helio_privileged"); appDb = pool("helio_app_test")
    ctx = new DbContext(appDb, privilegedDb)(typedSystem.executionContext)

    val ec               = typedSystem.executionContext
    val dashboardRepo    = new DashboardRepository(ctx)(ec)
    val panelRepo        = new PanelRepository(ctx)(ec)
    val dataSourceRepo   = new DataSourceRepository(ctx)(ec)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(ec)
    val fs               = new LocalFileSystem(newTempDir("helio-first-run-routes-spec"))
    dataSourceService    = new DataSourceService(dataSourceRepo, fs)(ec, SystemMaterializer(typedSystem).materializer, typedSystem)

    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, new ResourcePermissionRepository(ctx)(ec), fs,
      new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(appDb)(ec), stubSessionRepo, new UserPreferenceRepository(appDb)(ec), pipelineRepo,
      new PipelineStepRepository(ctx)(ec), new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(ec),
      pipelineRunRepo = new PipelineRunRepository(ctx)(ec), dbContext = ctx,
      claudeConfigProvider   = () => Right(ClaudeConfig("sk-ant-stub-never-used", "claude-test", 1.0, 4096, 100000)),
      claudeTransportFactory = Some(_ => new CountingTransport)
    ).routes

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, 'e1@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherId::uuid, 'e2@helio.test', now())"""
    )))

    // Warm-up (HEL-1228): the class's first build request pays one-time class-loading/JIT cost for the
    // pipeline apply+run path; absorb it here so no test's measured request is the cold one.
    val warmSrc = csvSource(user, "Warmup", datedCsv)
    authed(Post("/api/first-run/dashboard", HttpEntity(ContentTypes.`application/json`, s"""{"sourceId":"$warmSrc"}"""))) ~> routes ~> check {
      assert(status == StatusCodes.Created)
    }
  }

  override def afterAll(): Unit = { appDb.close(); privilegedDb.close(); embeddedPostgres.close(); super.afterAll() }

  protected def await[T](f: Future[T]): T = Await.result(f, 30.seconds)
  protected def sql1[T](a: DBIO[T]): T     = await(ctx.withSystemContext(a))
  protected def authed(req: HttpRequest, token: String = session) =
    req.addHeader(Cookie(SessionCookies.Name -> token))
      .addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))
  protected def csvSource(owner: AuthenticatedUser, name: String, csv: String): String =
    await(dataSourceService.createCsv(name, csv.getBytes("UTF-8"), Vector.empty, owner)).fold(e => fail(e.toString), _.id.value)

  protected val datedCsv = "day,region,amount\n2026-01-01,North,10\n2026-01-02,South,20\n2026-01-03,North,30\n"

  protected def layoutOf(dashboardId: String): Map[String, Vector[(Int, Int, Int, Int)]] = {
    val raw = sql1(sql"SELECT layout::text FROM dashboards WHERE id = $dashboardId".as[String].head)
    raw.parseJson.asJsObject.fields.map { case (bp, items) =>
      bp -> items.convertTo[Vector[JsObject]].map { o =>
        def n(k: String) = o.fields(k).convertTo[Int]
        (n("x"), n("y"), n("w"), n("h"))
      }
    }
  }

  protected def noOverlap(items: Vector[(Int, Int, Int, Int)]): Boolean =
    (for (i <- items.indices; j <- (i + 1) until items.size) yield (items(i), items(j))).forall {
      case ((x1, y1, w1, h1), (x2, y2, w2, h2)) => x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1
    }

}
