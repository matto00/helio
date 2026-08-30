package com.helio.api.routes.proposals

import com.helio.api._
import com.helio.api.http.{AuthDirectives, SessionCookies}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** Shared fixture for the `POST /api/proposals/apply` route specs (HEL-387)
 *  under real RLS (non-BYPASSRLS app pool) — mirrors
 *  `PipelineApplyProposalSpecBase`'s structure, plus a pre-existing
 *  pipeline-output DataType (`pipelineOutputTypeId`, mirroring
 *  `ApplyProposalSpecBase`'s seed) for the mixed-binding scenario where one
 *  panel binds to the sentinel and another to a real, already-existing type.
 *
 *  Holds the embedded-Postgres + Flyway migration, the real-RLS
 *  `helio_app_test`/`helio_privileged` pools, an owned-by-another-user
 *  source (`otherUserSourceId`, RLS cross-tenant coverage), teardown, and the
 *  request/count helpers shared by every concrete combined-apply spec. */
abstract class CombinedApplyProposalSpecBase
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb: JdbcBackend.Database        = _
  private var privilegedDb: JdbcBackend.Database = _
  private var ctx: DbContext                     = _
  protected var routes: Route                    = _

  protected val userId  = "00000000-0000-0000-0000-0000000000d1"
  protected val otherId = "00000000-0000-0000-0000-0000000000d2"
  protected val session = "valid-session"

  // Seeded via the privileged pool in beforeAll — see seedFixtures.
  protected var otherUserSourceId  = ""
  protected var pipelineOutputTypeId = ""
  // HEL-904 task 3.9: a real, bindable Output row — see ApplyProposalSpecBase's
  // identically-named/documented fixture.
  protected var pipelineOutputId = ""

  private val stubConnector = new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP"))))

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == session) Some(AuthenticatedUser(UserId(userId))) else None)
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                        = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                      = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                           = Future.successful(())
    def exists(path: String): Future[Boolean]                                                        = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally superConn.close()

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs); privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs); appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)(typedSystem.executionContext)

    val routeEc          = typedSystem.executionContext
    val dashboardRepo    = new DashboardRepository(ctx)(routeEc)
    val panelRepo        = new PanelRepository(ctx)(routeEc)
    val dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    val dataTypeRepo     = new DataTypeRepository(ctx)(routeEc)
    val userRepo         = new UserRepository(appDb)(routeEc)
    val userPrefRepo     = new UserPreferenceRepository(appDb)(routeEc)
    val permissionRepo   = new ResourcePermissionRepository(ctx)(routeEc)
    val pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    val pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)
    val pipelineRunRepo  = new PipelineRunRepository(ctx)(routeEc)
    val dataTypeRowRepo  = new DataTypeRowRepository(ctx)(routeEc)

    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo,
      stubFileSystem, stubConnector,
      userRepo, stubSessionRepo, userPrefRepo, pipelineRepo, pipelineStepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(routeEc),
      pipelineRunRepo = pipelineRunRepo,
      dataTypeRowRepo = dataTypeRowRepo,
      // HEL-904 task 3.9: wires a real OutputRepository so an "output"-kind
      // panel's binding validates against it.
      dbContext = ctx
    ).routes

    seedFixtures()
  }

  private def seedFixtures(): Unit = {
    val otherSrcId  = UUID.randomUUID().toString
    val otherTypeId = UUID.randomUUID().toString
    otherUserSourceId  = otherSrcId
    pipelineOutputTypeId = UUID.randomUUID().toString
    val pipelineForOutputId = UUID.randomUUID().toString
    pipelineOutputId = UUID.randomUUID().toString
    val staticPayload = """{"columns":[{"name":"name","type":"string"}],"rows":[["seed"]]}"""
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, 'd1@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherId::uuid, 'd2@helio.test', now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($otherSrcId::uuid, 'other-static', 'static', $staticPayload::jsonb, $otherId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($otherTypeId::uuid, $otherSrcId::uuid, 'other-static',
                     '[{"name":"name","displayName":"name","dataType":"string","nullable":true}]'::jsonb,
                     1, $otherId::uuid, now(), now())""",
      // Pre-existing pipeline-output type (source_id NULL), owned by userId —
      // bindable, for the mixed-binding scenario (task 7.3).
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($pipelineOutputTypeId::uuid, 'Existing Output',
                     '[{"name":"region","displayName":"region","dataType":"string","nullable":true}]'::jsonb,
                     1, $userId::uuid, now(), now())""",
      // HEL-904 task 3.9: a real pipeline + Output, owned by userId — the
      // "output"-kind panel binding target every test below now uses.
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
             VALUES ($pipelineForOutputId, 'Existing Pipeline', $otherSrcId::uuid, $pipelineOutputTypeId::uuid, $userId::uuid, now(), now())""",
      sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, schema, position, created_at, updated_at)
             VALUES ($pipelineOutputId, $pipelineForOutputId, NULL, $userId::uuid, 'Existing Output', 'table', '{}'::jsonb,
                     '[{"name":"region","type":"string"}]'::jsonb, 0, now(), now())"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close(); super.afterAll()
  }

  protected def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  // HEL-287: session auth via a `helio_session` cookie; mutating requests also need the CSRF header.
  protected def sessionCookie = Cookie(SessionCookies.Name -> session)
  protected def csrfHeader    = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
  protected def json(s: String) = HttpEntity(ContentTypes.`application/json`, s)

  protected def apply(body: String) =
    Post("/api/proposals/apply", json(body)).addHeader(sessionCookie).addHeader(csrfHeader)

  protected def dataSourceCount(): Int  = countRows("data_sources")
  protected def pipelineCount(): Int    = countRows("pipelines")
  protected def pipelineStepCount(): Int = countRows("pipeline_steps")
  protected def dataTypeCount(): Int    = countRows("data_types")
  protected def dashboardCount(): Int   = countRows("dashboards")
  protected def panelCount(): Int       = countRows("panels")

  /** Sum of the six resource counts the combined-proposal atomicity contract
   *  covers — a single scalar delta is enough to prove "nothing created" for
   *  a rejected/rolled-back call. */
  protected def allCounts(): Int =
    dataSourceCount() + pipelineCount() + pipelineStepCount() + dataTypeCount() + dashboardCount() + panelCount()

  private def countRows(table: String): Int = table match {
    case "data_sources"   => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM data_sources".as[Int].head))
    case "pipelines"      => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM pipelines".as[Int].head))
    case "pipeline_steps" => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM pipeline_steps".as[Int].head))
    case "data_types"     => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM data_types".as[Int].head))
    case "dashboards"     => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM dashboards".as[Int].head))
    case "panels"         => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM panels".as[Int].head))
  }
}
