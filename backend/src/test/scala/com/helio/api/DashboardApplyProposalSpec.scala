package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.{AuthenticatedUser, RestApiConnector, UserId}
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, DbContext, FileSystem, ListPage, PanelRepository, PipelineRepository, PipelineStepRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
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

/** Route-level coverage for `POST /api/dashboards/apply-proposal` (HEL-225)
 *  under real RLS (non-BYPASSRLS app pool, mirroring ApiTokenAuthSpec).
 *
 *  Proves: a valid proposal creates the dashboard + bound panels via the
 *  existing services; a proposal binding a source-companion DataType, an
 *  unknown DataType, an invalid panel type, or a metric with no dataTypeId is
 *  rejected AND creates nothing (atomicity); and a cross-user DataType is
 *  invisible under RLS (→ 400, nothing created). */
class DashboardApplyProposalSpec
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
  private var routes: Route                      = _

  private val userId = "00000000-0000-0000-0000-0000000000a1"
  private val otherId = "00000000-0000-0000-0000-0000000000a2"
  private val session = "valid-session"

  // Seeded DataTypes (set in beforeAll).
  private var pipelineOutputTypeId = ""
  private var companionTypeId = ""
  private var otherUserTypeId = ""

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

    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo,
      stubFileSystem, new RestApiConnector(Some(_ => Future.successful(Left("no HTTP")))),
      userRepo, stubSessionRepo, userPrefRepo, pipelineRepo, pipelineStepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(routeEc)
    ).routes

    // Seed users, a data source, and three DataTypes via the privileged pool.
    val srcId = UUID.randomUUID().toString
    pipelineOutputTypeId = UUID.randomUUID().toString
    companionTypeId = UUID.randomUUID().toString
    otherUserTypeId = UUID.randomUUID().toString
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
                     '[]'::jsonb, 1, $otherId::uuid, now(), now())"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  private def bearer = Authorization(OAuth2BearerToken(session))
  private def json(s: String) = HttpEntity(ContentTypes.`application/json`, s)

  private def dashboardCount(): Int =
    Get("/api/dashboards").addHeader(bearer) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("total").convertTo[Int]
    }

  private def apply(body: String) = Post("/api/dashboards/apply-proposal", json(body)).addHeader(bearer)

  "POST /api/dashboards/apply-proposal" should {

    "create a dashboard with bound + unbound panels from a valid proposal" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Regional Sales",
           |  "panels": [
           |    {"title":"Total","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"value":"region"},"layout":{"x":0,"y":0,"w":4,"h":3}},
           |    {"title":"Notes","type":"text"}
           |  ]
           |}""".stripMargin
      var createdId = ""
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj = responseAs[String].parseJson.asJsObject
        createdId = obj.fields("dashboard").asJsObject.fields("id").convertTo[String]
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        panels.map(_.fields("title").convertTo[String]) should contain allOf ("Total", "Notes")
        val metric = panels.find(_.fields("title").convertTo[String] == "Total").get
        metric.fields("config").asJsObject.fields("dataTypeId").convertTo[String] shouldBe pipelineOutputTypeId
      }
      dashboardCount() shouldBe (before + 1)

      // Layout persisted for the positioned panel.
      Get(s"/api/dashboards/$createdId/export").addHeader(bearer) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject
          .fields("dashboard").asJsObject.fields("layout").asJsObject
          .fields("lg").convertTo[Vector[JsValue]] should not be empty
      }
    }

    "reject binding a source-companion DataType and create nothing (V41, atomic)" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"metric","dataTypeId":"$companionTypeId","fieldMapping":{"value":"region"}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("pipeline-output")
      }
      dashboardCount() shouldBe before
    }

    "reject an unknown DataType and create nothing" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"chart","dataTypeId":"${UUID.randomUUID()}","fieldMapping":{}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      dashboardCount() shouldBe before
    }

    "reject a cross-user DataType under RLS (not found) and create nothing" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"metric","dataTypeId":"$otherUserTypeId","fieldMapping":{}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("not found")
      }
      dashboardCount() shouldBe before
    }

    "reject an invalid panel type and create nothing" in {
      val before = dashboardCount()
      apply("""{"dashboardName":"Bad","panels":[{"title":"X","type":"bogus"}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      dashboardCount() shouldBe before
    }

    "reject a metric panel with no dataTypeId and create nothing" in {
      val before = dashboardCount()
      apply("""{"dashboardName":"Bad","panels":[{"title":"X","type":"metric"}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("datatypeid")
      }
      dashboardCount() shouldBe before
    }

    "reject a blank dashboard name" in {
      apply("""{"dashboardName":"  ","panels":[]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "require authentication" in {
      Post("/api/dashboards/apply-proposal", json("""{"dashboardName":"x","panels":[]}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }
}
