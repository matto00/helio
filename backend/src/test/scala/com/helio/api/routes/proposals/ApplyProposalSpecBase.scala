package com.helio.api.routes.proposals

import com.helio.api._
import com.helio.api.http.{AuthDirectives, SessionCookies}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
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

/** Shared fixture for the `POST /api/dashboards/apply-proposal` route specs
 *  (HEL-225) under real RLS (non-BYPASSRLS app pool, mirroring ApiTokenAuthSpec).
 *
 *  Holds the embedded-Postgres + Flyway migration, the real-RLS
 *  `helio_app_test`/`helio_privileged` pools, seeded users / data-source /
 *  three DataTypes (pipeline-output, source-companion, other-user), teardown,
 *  and the request helpers (`await`, `sessionCookie`, `csrfHeader`, `json`,
 *  `dashboardCount`, `apply`) shared by every concrete apply-proposal spec.
 *
 *  Note: `import` statements are file-scoped and are NOT inherited through this
 *  base — each concrete spec declares its own top-of-file imports for the
 *  symbols its test bodies reference (e.g. `StatusCodes`, `spray.json._`,
 *  `UUID`). */
abstract class ApplyProposalSpecBase
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

  protected val userId = "00000000-0000-0000-0000-0000000000a1"
  protected val otherId = "00000000-0000-0000-0000-0000000000a2"
  protected val session = "valid-session"

  // Seeded DataTypes (set in beforeAll).
  protected var pipelineOutputTypeId = ""
  protected var companionTypeId = ""
  protected var otherUserTypeId = ""
  // HEL-904 task 3.9: a real, bindable Output row (an "output"-kind panel's
  // dataTypeId/config.dataTypeId must resolve via OutputRepository now, not
  // DataTypeRepository — OutputPanelConfig's outputId also carries a real
  // FK to outputs(id) at the DB layer).
  protected var pipelineOutputId = ""

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
    val userRepo         = new UserRepository(appDb)(routeEc)
    val userPrefRepo     = new UserPreferenceRepository(appDb)(routeEc)
    val permissionRepo   = new ResourcePermissionRepository(ctx)(routeEc)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    val pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)

    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo,
      stubFileSystem, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      userRepo, stubSessionRepo, userPrefRepo, pipelineRepo, pipelineStepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(routeEc),
      // HEL-549: wires a real MetricRepository so apply-proposal specs can
      // exercise the metricId validation path (nullable-optional default
      // otherwise, mirroring ApiRoutes's own convention).
      // HEL-904 task 3.9: wires a real OutputRepository (via `dbContext`) so
      // `DashboardProposalService`/`DashboardContentsService` can validate an
      // "output"-kind panel's binding.
      dbContext = ctx
    ).routes

    // Seed users, a data source, and three DataTypes via the privileged pool.
    val srcId = UUID.randomUUID().toString
    pipelineOutputTypeId = UUID.randomUUID().toString
    companionTypeId = UUID.randomUUID().toString
    otherUserTypeId = UUID.randomUUID().toString
    val pipelineForOutputId = UUID.randomUUID().toString
    pipelineOutputId = UUID.randomUUID().toString
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, 'a1@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherId::uuid, 'a2@helio.test', now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($srcId::uuid, 'src', 'static', '{}'::jsonb, $userId::uuid, now(), now())""",
      // Pipeline-output type: source_id NULL, owned by userId → bindable.
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($pipelineOutputTypeId::uuid, 'Sales Output',
                     '[{"name":"region","displayName":"region","dataType":"string","nullable":true}]'::jsonb,
                     1, $userId::uuid, now(), now())""",
      // Companion type: source_id set → NOT bindable.
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($companionTypeId::uuid, $srcId::uuid, 'src companion',
                     '[{"name":"region","displayName":"region","dataType":"string","nullable":true}]'::jsonb,
                     1, $userId::uuid, now(), now())""",
      // Pipeline-output type owned by the OTHER user → invisible under RLS.
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($otherUserTypeId::uuid, 'other output',
                     '[]'::jsonb, 1, $otherId::uuid, now(), now())""",
      // HEL-904 task 3.9: a real pipeline + Output, owned by userId — the
      // "output"-kind panel binding target every test below now uses
      // (`pipelineOutputId`, NOT `pipelineOutputTypeId`, which stays only for
      // the legacy DataType-shaped fixtures/tests still exercising other kinds).
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
             VALUES ($pipelineForOutputId, 'Sales Pipeline', $srcId::uuid, $pipelineOutputTypeId::uuid, $userId::uuid, now(), now())""",
      sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, schema, position, created_at, updated_at)
             VALUES ($pipelineOutputId, $pipelineForOutputId, NULL, $userId::uuid, 'Sales Output', 'table', '{}'::jsonb,
                     '[{"name":"region","type":"string"}]'::jsonb, 0, now(), now())"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  // HEL-287: session auth moved from an `Authorization` bearer header to a
  // `helio_session` cookie; mutating requests also need the CSRF header.
  protected def sessionCookie = Cookie(SessionCookies.Name -> session)
  protected def csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
  protected def json(s: String) = HttpEntity(ContentTypes.`application/json`, s)

  protected def dashboardCount(): Int =
    Get("/api/dashboards").addHeader(sessionCookie) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("total").convertTo[Int]
    }

  protected def apply(body: String) =
    Post("/api/dashboards/apply-proposal", json(body)).addHeader(sessionCookie).addHeader(csrfHeader)

  /** Seed a dashboard row directly (bypassing the HTTP layer) owned by an
   *  arbitrary user id — used by HEL-363 cross-tenant / owner-scoping specs
   *  that need a dashboard owned by `otherId` without a second stubbed
   *  session. Mirrors `DashboardPanelAclSpec.seedDashboard`'s raw-SQL insert. */
  protected def seedDashboardForOwner(name: String, ownerId: String): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, $name, $ownerId, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}',
                     $ownerId::uuid)"""
    ))
    id
  }

  /** Grant `granteeId` a role (`"editor"` / `"viewer"`) on `dashboardId` —
   *  used by HEL-370 batch-create cross-tenant/grantee specs. Mirrors
   *  `DashboardPanelAclSpec.grantRole`'s raw-SQL insert. */
  protected def grantRole(dashboardId: String, granteeId: String, role: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashboardId, ${granteeId}::uuid, $role, now())
             ON CONFLICT (resource_type, resource_id, grantee_id) DO UPDATE SET role = EXCLUDED.role"""
    ))

  /** Seed a metric row directly (bypassing the HTTP layer, via the privileged
   *  pool) owned by an arbitrary user id — used by HEL-549's metricId
   *  validation specs to seed a caller-owned, foreign, and/or deprecated
   *  metric without a second stubbed session. Mirrors
   *  `seedDashboardForOwner`'s raw-SQL insert. */
  protected def seedMetric(
      ownerId: String,
      dataTypeId: String,
      deprecated: Boolean = false,
      name: String = "Test Metric",
      measureField: String = "region"
  ): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO metrics
               (id, owner_id, data_type_id, name, measure_field, aggregation,
                allowed_dimensions, format, deprecated, created_at, updated_at)
             VALUES
               ($id, $ownerId::uuid, $dataTypeId, $name, $measureField, 'sum',
                '[]'::jsonb, '{}'::jsonb, $deprecated, now(), now())"""
    ))
    id
  }

  /** ACL-free read of a dashboard's panel titles, via the privileged pool —
   *  used by HEL-370 cross-tenant/no-grant specs to prove "nothing created"
   *  on a dashboard the test's own session user cannot GET (the HTTP export
   *  route itself 404s for a non-owner/non-grantee, so it can't be used to
   *  observe the dashboard's contents in that scenario). */
  protected def panelTitlesForDashboard(dashboardId: String): Vector[String] =
    await(ctx.withSystemContext(
      sql"""SELECT title FROM panels WHERE dashboard_id = $dashboardId""".as[String]
    )).toVector
}
