package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.{AuthenticatedUser, RestApiConnector, UserId}
import com.helio.infrastructure.{ApiTokenRepository, DashboardRepository, DataSourceRepository, DataTypeRepository, DbContext, FileSystem, ListPage, PanelRepository, PipelineRepository, PipelineStepRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.services.ApiTokenService
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

import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** End-to-end coverage for Personal Access Token auth (HEL-148 Phase 1).
 *
 *  The PAT ↔ RLS interaction is the risk this spec exists to pin down, so —
 *  unlike most route specs — it runs the app pool as a genuinely
 *  non-BYPASSRLS role (`helio_app_test`, mirroring RlsOwnerTablesSpec).
 *  A policy bug that the dev superuser connection would mask fails here:
 *  every dashboard visibility assertion below is enforced by real V36
 *  policies evaluating the `app.current_user_id` context that the
 *  PAT-resolved user sets.
 *
 *  Invariants proven:
 *  - a valid PAT authenticates every existing authenticated route and sees
 *    exactly the owner's rows (session-auth parity under real RLS);
 *  - revoked and expired PATs 401 with the standard error shape;
 *  - only the SHA-256 hash is persisted; list responses never leak it;
 *  - token list/revoke are owner-scoped (cross-user revoke 404s). */
class ApiTokenAuthSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb: JdbcBackend.Database        = _ // SET ROLE helio_app_test (RLS enforced)
  private var privilegedDb: JdbcBackend.Database = _ // SET ROLE helio_privileged (BYPASSRLS)
  private var ctx: DbContext                     = _
  private var apiTokenRepo: ApiTokenRepository   = _
  private var routes: Route                      = _

  private val userIdA = "00000000-0000-0000-0000-0000000000aa"
  private val userIdB = "00000000-0000-0000-0000-0000000000bb"
  private val sessionA = "valid-session-a"
  private val sessionB = "valid-session-b"

  // Stub session repo: PAT resolution is what this spec exercises for real,
  // while session auth (already covered elsewhere) bootstraps token creation.
  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(token match {
        case `sessionA` => Some(AuthenticatedUser(UserId(userIdA)))
        case `sessionB` => Some(AuthenticatedUser(UserId(userIdB)))
        case _          => None
      })
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
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    // Non-BYPASSRLS app role + grants — identical setup to RlsOwnerTablesSpec
    // so RLS policies genuinely evaluate on the app pool.
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
    } finally {
      superConn.close()
    }

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)(typedSystem.executionContext)

    val routeEc            = typedSystem.executionContext
    val dashboardRepo      = new DashboardRepository(ctx)(routeEc)
    val panelRepo          = new PanelRepository(ctx)(routeEc)
    val dataSourceRepo     = new DataSourceRepository(ctx)(routeEc)
    val dataTypeRepo       = new DataTypeRepository(ctx)(routeEc)
    val userRepo           = new UserRepository(appDb)(routeEc)
    val userPreferenceRepo = new UserPreferenceRepository(appDb)(routeEc)
    val permissionRepo     = new ResourcePermissionRepository(ctx)(routeEc)
    val pipelineRepo       = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    val pipelineStepRepo   = new PipelineStepRepository(ctx)(routeEc)
    apiTokenRepo           = new ApiTokenRepository(ctx)(routeEc)

    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo,
      stubFileSystem,
      new RestApiConnector(Some(_ => Future.successful(Left("no HTTP in tests")))),
      userRepo, stubSessionRepo, userPreferenceRepo,
      pipelineRepo, pipelineStepRepo,
      new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
      apiTokenRepo = apiTokenRepo
    ).routes

    // Seed the two owners (privileged: users has no RLS but the pool is the
    // canonical seeding path).
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userIdA::uuid, 'a@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userIdB::uuid, 'b@helio.test', now())"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Truncate mutable state between tests via the privileged pool so cleanup
   *  is never gated by RLS. Users are kept. */
  private def cleanDb(): Unit =
    await(ctx.withSystemContext(
      sqlu"TRUNCATE TABLE api_tokens, resource_permissions, panels, dashboards CASCADE"
    ))

  private def bearer(token: String) = Authorization(OAuth2BearerToken(token))

  private def jsonEntity(body: String) = HttpEntity(ContentTypes.`application/json`, body)

  /** Create a PAT through the real route and return (id, rawToken). */
  private def createPat(session: String, name: String, body: Option[String] = None): (String, String) = {
    val payload = body.getOrElse(s"""{"name":"$name"}""")
    Post("/api/tokens", jsonEntity(payload)).addHeader(bearer(session)) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      val fields = responseAs[String].parseJson.asJsObject.fields
      (fields("id").convertTo[String], fields("token").convertTo[String])
    }
  }

  private def createDashboard(session: String, name: String): Unit =
    Post("/api/dashboards", jsonEntity(s"""{"name":"$name"}""")).addHeader(bearer(session)) ~> routes ~> check {
      status shouldBe StatusCodes.Created
    }

  private def dashboardNames(authToken: String): Set[String] =
    Get("/api/dashboards").addHeader(bearer(authToken)) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject
        .fields("items").convertTo[Vector[JsValue]]
        .map(_.asJsObject.fields("name").convertTo[String])
        .toSet
    }

  "POST /api/tokens" should {

    "return the raw token once and persist only its SHA-256 hash" in {
      cleanDb()
      // expiresInDays deliberately absent: spray-json must read the missing
      // optional field as None (non-expiring token).
      val (id, raw) = createPat(sessionA, "fable-mcp")

      raw should fullyMatch regex "helio_pat_[0-9a-f]{64}"

      val (storedHash, expiresAt) = await(ctx.withSystemContext(
        sql"SELECT token_hash, expires_at::text FROM api_tokens WHERE id = $id::uuid"
          .as[(String, Option[String])].head
      ))
      storedHash shouldBe ApiTokenService.sha256Hex(raw)
      storedHash should not be raw
      expiresAt shouldBe None

      // The raw token exists nowhere in the database.
      val rawHits = await(ctx.withSystemContext(
        sql"SELECT COUNT(*) FROM api_tokens WHERE token_hash = $raw OR name = $raw".as[Int].head
      ))
      rawHits shouldBe 0
    }

    "set expires_at when expiresInDays is provided" in {
      cleanDb()
      Post("/api/tokens", jsonEntity("""{"name":"short-lived","expiresInDays":7}"""))
        .addHeader(bearer(sessionA)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[String].parseJson.asJsObject.fields.keySet should contain("expiresAt")
      }
    }

    "reject a blank name" in {
      cleanDb()
      Post("/api/tokens", jsonEntity("""{"name":"   "}""")).addHeader(bearer(sessionA)) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject a non-positive expiresInDays" in {
      cleanDb()
      Post("/api/tokens", jsonEntity("""{"name":"x","expiresInDays":0}"""))
        .addHeader(bearer(sessionA)) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "require authentication" in {
      cleanDb()
      Post("/api/tokens", jsonEntity("""{"name":"x"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }

  "PAT authentication" should {

    "authenticate an existing route and see exactly the owner's rows under real RLS" in {
      cleanDb()
      createDashboard(sessionA, "dash-a")
      createDashboard(sessionB, "dash-b")

      val (_, rawA) = createPat(sessionA, "agent-a")
      dashboardNames(rawA) shouldBe Set("dash-a")
    }

    "resolve a second user's PAT to that user's rows, never another's" in {
      cleanDb()
      createDashboard(sessionA, "dash-a")
      createDashboard(sessionB, "dash-b")

      val (_, rawB) = createPat(sessionB, "agent-b")
      dashboardNames(rawB) shouldBe Set("dash-b")
    }

    "return 401 with the standard error shape for a revoked PAT" in {
      cleanDb()
      val (id, raw) = createPat(sessionA, "to-revoke")
      dashboardNames(raw) shouldBe Set.empty // valid before revocation

      Delete(s"/api/tokens/$id").addHeader(bearer(sessionA)) ~> routes ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get("/api/dashboards").addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[String].parseJson.asJsObject.fields("message").convertTo[String] shouldBe "Unauthorized"
      }
    }

    "return 401 for an expired PAT" in {
      cleanDb()
      val (id, raw) = createPat(sessionA, "expiring", Some("""{"name":"expiring","expiresInDays":1}"""))
      dashboardNames(raw) shouldBe Set.empty // valid while unexpired

      await(ctx.withSystemContext(
        sqlu"UPDATE api_tokens SET expires_at = now() - interval '1 day' WHERE id = $id::uuid"
      ))

      Get("/api/dashboards").addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "return 401 for bearer values that are neither sessions nor known PATs" in {
      cleanDb()
      Get("/api/dashboards").addHeader(bearer("helio_pat_" + "0" * 64)) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
      Get("/api/dashboards").addHeader(bearer("not-a-credential")) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "record last_used_at when a PAT authenticates" in {
      cleanDb()
      val (id, raw) = createPat(sessionA, "tracked")
      dashboardNames(raw) shouldBe Set.empty

      // touchLastUsed is fire-and-forget; poll briefly for the write to land.
      val deadline = System.currentTimeMillis() + 5000
      var lastUsed: Option[String] = None
      while (lastUsed.isEmpty && System.currentTimeMillis() < deadline) {
        lastUsed = await(ctx.withSystemContext(
          sql"SELECT last_used_at::text FROM api_tokens WHERE id = $id::uuid"
            .as[Option[String]].head
        ))
        if (lastUsed.isEmpty) Thread.sleep(50)
      }
      lastUsed should not be empty
    }
  }

  "GET /api/tokens" should {

    "list only the caller's tokens and never expose the hash or raw token" in {
      cleanDb()
      val (_, rawA) = createPat(sessionA, "mine")
      createPat(sessionB, "theirs")

      Get("/api/tokens").addHeader(bearer(sessionA)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body   = responseAs[String]
        val tokens = body.parseJson.convertTo[Vector[JsValue]].map(_.asJsObject.fields)
        tokens.map(_("name").convertTo[String]) shouldBe Vector("mine")
        body should not include rawA
        body should not include ApiTokenService.sha256Hex(rawA)
        tokens.foreach(_.keySet should not contain "token")
      }
    }

    "be reachable with PAT auth itself" in {
      cleanDb()
      val (_, raw) = createPat(sessionA, "self-service")
      Get("/api/tokens").addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  "DELETE /api/tokens/:id" should {

    "return 404 for another user's token and leave it valid" in {
      cleanDb()
      val (id, raw) = createPat(sessionA, "coveted")

      Delete(s"/api/tokens/$id").addHeader(bearer(sessionB)) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }

      dashboardNames(raw) shouldBe Set.empty // still authenticates
    }
  }
}
