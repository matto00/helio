package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.{AuthenticatedUser, RestApiConnector, UserId}
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, DataTypeRowRepository, DbContext, FileSystem, ListPage, PanelRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
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
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** Shared fixture for the `POST /api/pipelines/apply-proposal` route specs
 *  (HEL-383) under real RLS (non-BYPASSRLS app pool) — mirrors
 *  `ApplyProposalSpecBase`'s structure exactly.
 *
 *  Holds the embedded-Postgres + Flyway migration, the real-RLS
 *  `helio_app_test`/`helio_privileged` pools, a stub `RestApiConnector`
 *  configurable per-URL (so the same fixture exercises both a successful and
 *  a failing inline `rest_api` schema fetch), a pre-seeded static source
 *  owned by the caller (`existingSourceId`) and one owned by another user
 *  (`otherUserSourceId`), teardown, and the request/count helpers shared by
 *  every concrete apply-proposal spec. */
abstract class PipelineApplyProposalSpecBase
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

  protected val userId  = "00000000-0000-0000-0000-0000000000c1"
  protected val otherId = "00000000-0000-0000-0000-0000000000c2"
  protected val session = "valid-session"

  // Seeded via the privileged pool in beforeAll — see seedFixtures.
  protected var existingSourceId  = ""
  protected var otherUserSourceId = ""

  // Configurable inline REST fetch outcome, keyed on `config.url` — lets one
  // connector instance exercise both a successful schema fetch (task 4.4)
  // and a curated failure (task 4.6) without per-test wiring.
  protected val RestSuccessUrl = "https://rest.test/ok"
  protected val RestFailureUrl = "https://rest.test/fail"

  // HEL-758 task 4.4: a source whose FIRST fetch (schema inference, at inline
  // source creation) succeeds, and every SUBSEQUENT fetch (the pipeline's
  // actual run, reached moments later in the same apply-proposal call) fails
  // — simulates "the endpoint becomes unreachable between schema inference
  // and the run" (spec.md's "run-time fetch failure" scenario, distinct from
  // RestFailureUrl's fails-at-schema-inference-time scenario). Call-counted
  // rather than a second static URL because both call sites share the exact
  // same connector.fetch/inferSchema code path — there is no other way to
  // make schema inference and the run diverge deterministically.
  protected val RestRunFailUrl = "https://rest.test/run-fail"
  private val restRunFailCallCount = new AtomicInteger(0)

  private val stubConnector = new RestApiConnector(Some { config =>
    if (config.url == RestFailureUrl) Future.successful(Left("connector: endpoint unreachable"))
    else if (config.url == RestRunFailUrl) {
      if (restRunFailCallCount.getAndIncrement() == 0)
        Future.successful(Right(JsArray(JsObject("name" -> JsString("alice"), "score" -> JsNumber(1)))))
      else
        Future.successful(Left("connector: endpoint unreachable"))
    } else Future.successful(Right(JsArray(JsObject("name" -> JsString("alice"), "score" -> JsNumber(1)))))
  })

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
      dataTypeRowRepo = dataTypeRowRepo
    ).routes

    seedFixtures()
  }

  private def seedFixtures(): Unit = {
    val srcId      = UUID.randomUUID().toString
    val srcTypeId  = UUID.randomUUID().toString
    val otherSrcId = UUID.randomUUID().toString
    val otherTypeId = UUID.randomUUID().toString
    existingSourceId  = srcId
    otherUserSourceId = otherSrcId
    val staticPayload = """{"columns":[{"name":"name","type":"string"}],"rows":[["seed"]]}"""
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, 'c1@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherId::uuid, 'c2@helio.test', now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($srcId::uuid, 'existing-static', 'static', $staticPayload::jsonb, $userId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($srcTypeId::uuid, $srcId::uuid, 'existing-static',
                     '[{"name":"name","displayName":"name","dataType":"string","nullable":true}]'::jsonb,
                     1, $userId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($otherSrcId::uuid, 'other-static', 'static', $staticPayload::jsonb, $otherId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($otherTypeId::uuid, $otherSrcId::uuid, 'other-static',
                     '[{"name":"name","displayName":"name","dataType":"string","nullable":true}]'::jsonb,
                     1, $otherId::uuid, now(), now())"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close(); super.afterAll()
  }

  // HEL-758 task 4.4: exposes the embedded Postgres port (embeddedPostgres
  // itself stays private, set up in beforeAll) so a subclass can seed an
  // inline sql source config that's actually reachable, mirroring
  // SqlConnectorSpec's own `liveConfig` pattern.
  protected def sqlPort: Int = embeddedPostgres.getPort

  protected def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  // HEL-287: session auth via a `helio_session` cookie; mutating requests also need the CSRF header.
  protected def sessionCookie = Cookie(SessionCookies.Name -> session)
  protected def csrfHeader    = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
  protected def json(s: String) = HttpEntity(ContentTypes.`application/json`, s)

  protected def apply(body: String) =
    Post("/api/pipelines/apply-proposal", json(body)).addHeader(sessionCookie).addHeader(csrfHeader)

  protected def dataSourceCount(): Int  = countRows("data_sources")
  protected def pipelineCount(): Int    = countRows("pipelines")
  protected def pipelineStepCount(): Int = countRows("pipeline_steps")
  protected def dataTypeCount(): Int    = countRows("data_types")

  private def countRows(table: String): Int = table match {
    case "data_sources"   => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM data_sources".as[Int].head))
    case "pipelines"      => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM pipelines".as[Int].head))
    case "pipeline_steps" => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM pipeline_steps".as[Int].head))
    case "data_types"     => await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM data_types".as[Int].head))
  }

  /** HEL-755 design.md D3: reads the most recent `pipeline_runs` row for
   *  `pipelineId` (status + errorLog), via the privileged pool, mirroring
   *  `countRows`'s existing use of `ctx.withSystemContext` for assertion-only
   *  DB reads. Used to prove a `blocked`/`recordUnrunnable` run was actually
   *  persisted, not only returned transiently in the apply response. */
  protected def latestPipelineRun(pipelineId: String): Option[(String, Option[String])] =
    await(ctx.withSystemContext(
      // pipeline_runs.pipeline_id is TEXT (V24), not UUID — no ::uuid cast.
      sql"""SELECT status, error_log FROM pipeline_runs
            WHERE pipeline_id = $pipelineId
            ORDER BY started_at DESC LIMIT 1""".as[(String, Option[String])].headOption
    ))
}
