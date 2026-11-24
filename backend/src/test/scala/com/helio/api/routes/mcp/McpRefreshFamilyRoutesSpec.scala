package com.helio.api.routes.mcp

import com.helio.api.JsonProtocols
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.api.ApiRoutes
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.services.auth.ApiTokenService
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import com.helio.testsupport.JsonSchemaValidation
import com.networknt.schema.JsonSchema
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCode, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, Cookie, OAuth2BearerToken, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.security.MessageDigest
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** The two refresh-family routes (HEL-1713) on an embedded Postgres whose app pool is a genuinely
 *  non-BYPASSRLS role, so the owner-only policy and the reuse path's PAT delete run under real RLS.
 *  Requests and responses are validated against the committed `schemas/mcp/` contracts, the same
 *  files helio-mcp's seam test validates its request bodies against. */
class McpRefreshFamilyRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb: JdbcBackend.Database        = _
  private var privilegedDb: JdbcBackend.Database = _
  private var ctx: DbContext                     = _
  private var routes: Route                      = _

  private val userIdA  = "00000000-0000-0000-0000-0000000000aa"
  private val userIdB  = "00000000-0000-0000-0000-0000000000bb"
  private val sessionA = "valid-session-a"

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == sessionA) Some(AuthenticatedUser(UserId(userIdA))) else None)
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                        = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                      = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                           = Future.successful(())
    def exists(path: String): Future[Boolean]                                                        = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  private lazy val createRequestSchema  = JsonSchemaValidation.compile("mcp/mcp-refresh-family-create-request.schema.json")
  private lazy val createResponseSchema = JsonSchemaValidation.compile("mcp/mcp-refresh-family-create-response.schema.json")
  private lazy val rotateRequestSchema  = JsonSchemaValidation.compile("mcp/mcp-refresh-family-rotate-request.schema.json")
  private lazy val rotateResponseSchema = JsonSchemaValidation.compile("mcp/mcp-refresh-family-rotate-response.schema.json")
  private lazy val conflictSchema       = JsonSchemaValidation.compile("mcp/mcp-refresh-family-conflict-response.schema.json")

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
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
    val ec               = typedSystem.executionContext
    val dataSourceRepo   = new DataSourceRepository(ctx)(ec)
    routes = new ApiRoutes(
      new DashboardRepository(ctx)(ec), new PanelRepository(ctx)(ec), dataSourceRepo,
      new ResourcePermissionRepository(ctx)(ec), stubFileSystem,
      new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP in tests")))),
      new UserRepository(appDb)(ec), stubSessionRepo, new UserPreferenceRepository(appDb)(ec),
      new PipelineRepository(ctx, dataSourceRepo)(ec), new PipelineStepRepository(ctx)(ec),
      new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, new PipelineRepository(ctx, dataSourceRepo)(ec))(ec),
      apiTokenRepo = new ApiTokenRepository(ctx)(ec),
      auditEventRepo = new AuditEventRepository(ctx)(ec),
      dbContext = ctx
    ).routes

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

  private def cleanDb(): Unit =
    await(ctx.withSystemContext(sqlu"TRUNCATE TABLE api_tokens, pipelines, data_sources CASCADE"))

  private def sha(s: String): String =
    MessageDigest.getInstance("SHA-256").digest(s.getBytes("UTF-8")).map("%02x".format(_)).mkString

  private def bearer(token: String)        = Authorization(OAuth2BearerToken(token))
  private def sessionCookie(token: String) = Cookie(SessionCookies.Name -> token)
  private def csrfHeader                   = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
  private def json(body: String)           = HttpEntity(ContentTypes.`application/json`, body)

  private val Resource = "https://mcp.example/mcp"

  /** A PAT for `session`'s user through the real route; returns (id, raw). */
  private def createPat(session: String, body: String = """{"name":"MCP connector: t","expiresInDays":90}"""): (String, String) =
    Post("/api/tokens", json(body)).addHeader(sessionCookie(session)).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      val f = responseAs[String].parseJson.asJsObject.fields
      (f("id").convertTo[String], f("token").convertTo[String])
    }

  /** A PAT for user B, minted directly (the stub session repo knows only user A). */
  private def createPatForB(): (String, String) = {
    val id  = UUID.randomUUID().toString
    val raw = ApiTokenService.generateRawToken()
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO api_tokens (id, user_id, token_hash, name, expires_at)
             VALUES ($id::uuid, $userIdB::uuid, ${sha(raw)}, 'b', now() + interval '90 days')"""
    ))
    (id, raw)
  }

  private def createBody(client: String, jti: String, resource: String = Resource): String =
    JsObject("clientIdHash" -> JsString(sha(client)), "resource" -> JsString(resource), "jtiHash" -> JsString(sha(jti))).compactPrint

  private def rotateBody(client: String, presented: String, next: String, resource: String = Resource): String =
    JsObject(
      "clientIdHash" -> JsString(sha(client)), "resource" -> JsString(resource),
      "presentedJtiHash" -> JsString(sha(presented)), "nextJtiHash" -> JsString(sha(next))
    ).compactPrint

  private def validate(schema: JsonSchema, body: String): Unit =
    withClue(s"schema violations for $body: ") { JsonSchemaValidation.validationErrors(schema, body) shouldBe empty }

  private def createFamily(pat: String, client: String = "client-1", jti: String = "jti-0"): String = {
    val body = createBody(client, jti)
    validate(createRequestSchema, body)
    Post("/api/mcp-refresh-families", json(body)).addHeader(bearer(pat)) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      validate(createResponseSchema, responseAs[String])
      responseAs[String].parseJson.asJsObject.fields("familyId").convertTo[String]
    }
  }

  private def rotateStatus(pat: String, familyId: String, body: String): (StatusCode, String) =
    Post(s"/api/mcp-refresh-families/$familyId/rotate", json(body)).addHeader(bearer(pat)) ~> routes ~> check {
      (status, responseAs[String])
    }

  private def familyRow(id: String): Option[(String, Int)] =
    await(ctx.withSystemContext(
      sql"SELECT current_jti_hash, generation FROM mcp_refresh_families WHERE id = $id::uuid".as[(String, Int)].headOption
    ))

  private def count(sqlText: DBIO[Int]): Int = await(ctx.withSystemContext(sqlText))
  private def patExists(id: String): Boolean =
    count(sql"SELECT COUNT(*) FROM api_tokens WHERE id = $id::uuid".as[Int].head) == 1

  private def awaitAudit(tokenId: String): Vector[(String, String)] = {
    val deadline = System.nanoTime() + 5.seconds.toNanos
    def read() = await(ctx.withSystemContext(
      sql"SELECT metadata::text, source FROM audit_events WHERE action = 'token.revoke' AND resource_id = $tokenId".as[(String, String)]
    )).toVector
    var rows = read()
    while (rows.isEmpty && System.nanoTime() < deadline) { Thread.sleep(50); rows = read() }
    rows
  }

  "POST /api/mcp-refresh-families" should {

    "create a family expiring with its PAT, storing only the jti hash" in {
      cleanDb()
      val (patId, pat) = createPat(sessionA)
      val familyId     = createFamily(pat)
      val patExpiry = await(ctx.withSystemContext(sql"SELECT expires_at::text FROM api_tokens WHERE id = $patId::uuid".as[String].head))
      val (expiry, hash, owner) = await(ctx.withSystemContext(
        sql"SELECT expires_at::text, current_jti_hash, user_id::text FROM mcp_refresh_families WHERE id = $familyId::uuid".as[(String, String, String)].head
      ))
      expiry shouldBe patExpiry
      hash shouldBe sha("jti-0")
      owner shouldBe userIdA
      count(sql"SELECT COUNT(*) FROM mcp_refresh_families WHERE current_jti_hash = 'jti-0'".as[Int].head) shouldBe 0
    }

    "give a PAT with no expiry a family that expires in about 90 days" in {
      cleanDb()
      val (_, pat) = createPat(sessionA, """{"name":"MCP connector: t"}""")
      val familyId = createFamily(pat)
      val days = await(ctx.withSystemContext(
        sql"SELECT EXTRACT(EPOCH FROM (expires_at - now())) / 86400 FROM mcp_refresh_families WHERE id = $familyId::uuid".as[Double].head
      ))
      days should (be > 89.9 and be <= 90.0)
    }

    "refuse a session caller with 403 and write no row" in {
      cleanDb()
      Post("/api/mcp-refresh-families", json(createBody("c", "j"))).addHeader(sessionCookie(sessionA)).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      count(sql"SELECT COUNT(*) FROM mcp_refresh_families".as[Int].head) shouldBe 0
    }

    "refuse a scoped PAT, a missing credential and a malformed body" in {
      cleanDb()
      val dsId = UUID.randomUUID().toString
      val pid  = UUID.randomUUID().toString
      await(ctx.withSystemContext(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'dataset', '{"columns":[],"rows":[]}', $userIdA::uuid, now(), now())""",
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $userIdA::uuid, now(), now())""",
        sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
      )))
      val (_, scoped) = createPat(sessionA, s"""{"name":"s","scopedPipelineIds":["$pid"]}""")
      Post("/api/mcp-refresh-families", json(createBody("c", "j"))).addHeader(bearer(scoped)) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      Post("/api/mcp-refresh-families", json(createBody("c", "j"))) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
      val (_, pat) = createPat(sessionA)
      Post("/api/mcp-refresh-families", json("""{"clientIdHash":"nothex","resource":"r","jtiHash":"x"}""")).addHeader(bearer(pat)) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      count(sql"SELECT COUNT(*) FROM mcp_refresh_families".as[Int].head) shouldBe 0
    }
  }

  "POST /api/mcp-refresh-families/:id/rotate" should {

    "replace the current hash and bump the generation" in {
      cleanDb()
      val (_, pat) = createPat(sessionA)
      val id       = createFamily(pat)
      val body     = rotateBody("client-1", "jti-0", "jti-1")
      validate(rotateRequestSchema, body)
      val (st, resp) = rotateStatus(pat, id, body)
      st shouldBe StatusCodes.OK
      validate(rotateResponseSchema, resp)
      resp.parseJson.asJsObject.fields("generation").convertTo[Int] shouldBe 1
      familyRow(id) shouldBe Some((sha("jti-1"), 1))
    }

    "treat a rotated-away hash as reuse: 409, PAT deleted, every family of it gone, one audit event" in {
      cleanDb()
      val (patId, pat) = createPat(sessionA)
      val id           = createFamily(pat)
      val sibling      = createFamily(pat, client = "client-2", jti = "other-0")
      rotateStatus(pat, id, rotateBody("client-1", "jti-0", "jti-1"))._1 shouldBe StatusCodes.OK
      val (st, resp) = rotateStatus(pat, id, rotateBody("client-1", "jti-0", "jti-2"))
      st shouldBe StatusCodes.Conflict
      validate(conflictSchema, resp)
      resp.parseJson.asJsObject.fields("reason").convertTo[String] shouldBe "reused"
      patExists(patId) shouldBe false
      familyRow(id) shouldBe None
      familyRow(sibling) shouldBe None
      val events = awaitAudit(patId)
      events should have size 1
      val meta = events.head._1.parseJson.asJsObject
      meta.fields("reason") shouldBe JsString("mcp_refresh_reuse")
      meta.fields("familyId") shouldBe JsString(id)
      meta.fields("generation") shouldBe JsNumber(1)
      events.head._1 should not include sha("jti-0")
      events.head._1 should not include pat
    }

    "let exactly one of two concurrent rotations with the same hash succeed" in {
      cleanDb()
      val (_, pat) = createPat(sessionA)
      val id       = createFamily(pat)
      implicit val ec: ExecutionContext = ExecutionContext.global
      val attempts = (1 to 2).map(n => Future(rotateStatus(pat, id, rotateBody("client-1", "jti-0", s"next-$n"))._1))
      val statuses = await(Future.sequence(attempts))
      statuses.count(_ == StatusCodes.OK) shouldBe 1
      statuses.count(_ == StatusCodes.Conflict) shouldBe 1
    }

    "answer a client or resource mismatch with 409 mismatch and change nothing" in {
      cleanDb()
      val (patId, pat) = createPat(sessionA)
      val id           = createFamily(pat)
      for (body <- Seq(rotateBody("someone-else", "jti-0", "jti-1"), rotateBody("client-1", "jti-0", "jti-1", "https://other.example/mcp"))) {
        val (st, resp) = rotateStatus(pat, id, body)
        st shouldBe StatusCodes.Conflict
        validate(conflictSchema, resp)
        resp.parseJson.asJsObject.fields("reason").convertTo[String] shouldBe "mismatch"
      }
      familyRow(id) shouldBe Some((sha("jti-0"), 0))
      patExists(patId) shouldBe true
    }

    "answer an expired family with 409 expired, no change and the PAT kept" in {
      cleanDb()
      val (patId, pat) = createPat(sessionA)
      val id           = createFamily(pat)
      await(ctx.withSystemContext(sqlu"UPDATE mcp_refresh_families SET expires_at = now() - interval '1 minute' WHERE id = $id::uuid"))
      val (st, resp) = rotateStatus(pat, id, rotateBody("client-1", "jti-0", "jti-1"))
      st shouldBe StatusCodes.Conflict
      resp.parseJson.asJsObject.fields("reason").convertTo[String] shouldBe "expired"
      familyRow(id) shouldBe Some((sha("jti-0"), 0))
      patExists(patId) shouldBe true
    }

    "answer 404 for another PAT's family, another user's family and an unknown id, changing nothing" in {
      cleanDb()
      val (_, patA)  = createPat(sessionA)
      val (_, patA2) = createPat(sessionA)
      val (_, patB)  = createPatForB()
      val id         = createFamily(patA)
      val body       = rotateBody("client-1", "jti-0", "jti-1")
      rotateStatus(patA2, id, body)._1 shouldBe StatusCodes.NotFound
      rotateStatus(patB, id, body)._1 shouldBe StatusCodes.NotFound
      rotateStatus(patA, UUID.randomUUID().toString, body)._1 shouldBe StatusCodes.NotFound
      rotateStatus(patA, "not-a-uuid", body)._1 shouldBe StatusCodes.NotFound
      familyRow(id) shouldBe Some((sha("jti-0"), 0))
    }

    "refuse a session caller with 403" in {
      cleanDb()
      val (_, pat) = createPat(sessionA)
      val id       = createFamily(pat)
      Post(s"/api/mcp-refresh-families/$id/rotate", json(rotateBody("client-1", "jti-0", "jti-1")))
        .addHeader(sessionCookie(sessionA)).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      familyRow(id) shouldBe Some((sha("jti-0"), 0))
    }
  }

  "revoking the PAT" should {
    "delete its families" in {
      cleanDb()
      val (patId, pat) = createPat(sessionA)
      val id           = createFamily(pat)
      Delete(s"/api/tokens/$patId").addHeader(sessionCookie(sessionA)).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.NoContent
      }
      familyRow(id) shouldBe None
    }
  }

  "mcp_refresh_families under the app role" should {
    "show a row only to its owner, and refuse an insert for another user" in {
      cleanDb()
      val (patId, pat) = createPat(sessionA)
      createFamily(pat)
      await(ctx.withUserContext(userIdA)(sql"SELECT COUNT(*) FROM mcp_refresh_families".as[Int].head)) shouldBe 1
      await(ctx.withUserContext(userIdB)(sql"SELECT COUNT(*) FROM mcp_refresh_families".as[Int].head)) shouldBe 0
      an[Exception] should be thrownBy await(ctx.withUserContext(userIdB)(
        sqlu"""INSERT INTO mcp_refresh_families (user_id, api_token_id, client_id_hash, resource, current_jti_hash, expires_at)
               VALUES ($userIdA::uuid, $patId::uuid, 'c', 'r', 'h', now() + interval '1 day')"""
      ))
    }
  }
}
