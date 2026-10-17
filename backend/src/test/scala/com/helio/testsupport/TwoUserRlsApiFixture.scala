package com.helio.testsupport

import com.helio.api._
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunGuardRepository, PipelineRunRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.services.pipelines.PipelineRunGuardConfig
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethod, HttpRequest}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import javax.sql.DataSource
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1574: the full route tree over a non-BYPASSRLS `helio_app_test` app pool with three seeded users, each with
 *  their own session cookie, so a spec can prove that user B never sees or alters what user A created. */
abstract class TwoUserRlsApiFixture
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb: JdbcBackend.Database        = _
  protected var privilegedDb: JdbcBackend.Database = _
  protected var superDb: JdbcBackend.Database    = _
  protected var ctx: DbContext                   = _
  protected var routes: Route                    = _
  private var embeddedDataSource: DataSource = _

  /** A fresh connection pool on this spec's embedded Postgres, each connection running as `role` (`None` = the superuser):
   *  for a spec that needs its own connections (a racer, a pool it closes to flush a backend's statistics). The caller closes it. */
  protected def newPool(role: Option[String], size: Int = 5, applicationName: Option[String] = None): JdbcBackend.Database = {
    val cfg = new HikariConfig()
    cfg.setDataSource(embeddedDataSource); cfg.setMaximumPoolSize(size)
    val init = role.map(r => s"SET ROLE $r").toVector ++ applicationName.map(n => s"SET application_name = '$n'")
    if (init.nonEmpty) cfg.setConnectionInitSql(init.mkString("; "))
    JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(size))
  }

  protected val userA = "00000000-0000-0000-0000-0000000000b1"
  protected val userB = "00000000-0000-0000-0000-0000000000b2"
  protected val userC = "00000000-0000-0000-0000-0000000000b3"
  private val tokens  = Map("tok-a" -> userA, "tok-b" -> userB, "tok-c" -> userC)

  private val sessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(tokens.get(token).map(id => AuthenticatedUser(UserId(id))))
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit] = Future.successful(())
    def read(path: String): Future[Array[Byte]]               = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                    = Future.successful(())
    def exists(path: String): Future[Boolean]                 = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] =
      Future.successful(ListPage(Seq.empty, None))
  }

  protected def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  /** HEL-1619: a spec that needs persisted pipeline runs (run history, assertions) overrides this to return a
   *  real repository over `ctx`; `null` (the default) is the pre-existing wiring, so other specs are untouched. */
  protected def pipelineRunRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunRepository = null

  /** HEL-1629: a spec that asserts the audit row of a mutation overrides this to return a real repository over `ctx`;
   *  `null` (the default) is the pre-existing wiring, so other specs are untouched. */
  protected def auditEventRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): AuditEventRepository = null

  /** HEL-1629: a spec that exercises the HEL-505 pipeline-run guard overrides these two; the defaults are the
   *  pre-existing wiring (no guard repository, the environment's config). */
  protected def pipelineRunGuardRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunGuardRepository = null
  protected def pipelineRunGuardConfig: PipelineRunGuardConfig = PipelineRunGuardConfig.fromEnv()

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(
      EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").setServerConfig("track_functions", "pl")
    )
    val superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()

    val c = superDs.getConnection
    try {
      val s = c.createStatement()
      s.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      s.execute("GRANT helio_app_test TO postgres")
      s.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      s.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      s.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO helio_app_test")
      s.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      s.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      s.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      s.close()
    } finally c.close()

    embeddedDataSource = superDs
    superDb      = newPool(None)
    privilegedDb = newPool(Some("helio_privileged"))
    appDb        = newPool(Some("helio_app_test"))
    ctx          = new DbContext(appDb, privilegedDb)(typedSystem.executionContext)

    val ec             = typedSystem.executionContext
    val dashboardRepo  = new DashboardRepository(ctx)(ec)
    val panelRepo      = new PanelRepository(ctx)(ec)
    val dataSourceRepo = new DataSourceRepository(ctx)(ec)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(ec)
    // The preference repository runs on the plain handle exactly as in production (`users` has no RLS).
    val prefRepo       = new UserPreferenceRepository(appDb)(ec)

    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, new ResourcePermissionRepository(ctx)(ec),
      stubFileSystem, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(appDb)(ec), sessionRepo, prefRepo, pipelineRepo, new PipelineStepRepository(ctx)(ec),
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(ec),
      pipelineScheduleRepo = new PipelineScheduleRepository(ctx)(ec),
      pipelineRunRepo = pipelineRunRepoFor(ctx)(ec),
      auditEventRepo = auditEventRepoFor(ctx)(ec),
      pipelineRunGuardRepo = pipelineRunGuardRepoFor(ctx)(ec),
      pipelineRunGuardConfig = pipelineRunGuardConfig,
      dbContext = ctx
    ).routes

    await(privilegedDb.run(DBIO.sequence(tokens.values.toSeq.map { id =>
      sqlu"INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@helio.test"}, now())"
    })))
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); superDb.close(); embeddedPostgres.close(); super.afterAll()
  }

  protected def tokenOf(user: String): String = tokens.collectFirst { case (t, id) if id == user => t }.get

  protected def jsonEntity(s: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, s)

  /** A request signed in as `user`, with the CSRF header mutating routes require. */
  protected def req(method: HttpMethod, path: String, user: String, body: Option[String] = None): HttpRequest = {
    val base = HttpRequest(method, path)
    val withBody = body.fold(base)(b => base.withEntity(jsonEntity(b)))
    withBody
      .addHeader(Cookie(SessionCookies.Name -> tokenOf(user)))
      .addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))
  }

  protected def seedDashboard(owner: String, name: String): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, $name, $owner, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', $owner::uuid)"""
    ))
    id
  }
}
