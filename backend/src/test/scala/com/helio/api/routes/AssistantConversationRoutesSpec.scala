package com.helio.api.routes

import com.helio.ai._
import com.helio.api.JsonProtocols
import com.helio.domain._
import com.helio.infrastructure.AssistantConversationRepository._
import com.helio.infrastructure.{AssistantConversationRepository, DbContext, LocalFileSystem}
import com.helio.services.{AssistantConversationService, AssistantService}
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.scaladsl.Source
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContextExecutor, Future}

/** HTTP-shell coverage for `POST /api/assistant-conversations/:id/converse` (HEL-665, reopened
 *  composer ticket, tasks.md 6.3/6.3a/6.4/6.5). Business-logic depth for `AssistantService.converse`
 *  itself is `AssistantServiceSpec`'s job (fake `ClaudeTransport`, zero real network calls anywhere
 *  in this suite either); this spec only exercises the HTTP + persistence wiring `converseFlow`
 *  composes. Mirrors `AssistantConversationRepositorySpec`'s exact dual-pool RLS harness (a real
 *  `helio_app_test` role the app pool `SET ROLE`s into, NOT BYPASSRLS) so task 6.5's "second user
 *  cannot converse with the first user's conversation" is a genuine Postgres RLS assertion, not
 *  app-layer-only scoping. */
class AssistantConversationRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContextExecutor = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var privilegedDb: JdbcBackend.Database     = _ // postgres superuser
  private var appDb: JdbcBackend.Database             = _ // helio_app_test (non-superuser)
  private var ctx: DbContext                          = _
  private var repo: AssistantConversationRepository   = _
  private var conversationService: AssistantConversationService = _

  private val ownerA = UserId(UUID.randomUUID().toString)
  private val ownerB = UserId(UUID.randomUUID().toString)
  private val userA  = AuthenticatedUser(ownerA)
  private val userB  = AuthenticatedUser(ownerB)

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway
      .configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

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

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx  = new DbContext(appDb, privilegedDb)
    repo = new AssistantConversationRepository(ctx)

    val tmpDir     = Files.createTempDirectory("helio-assistant-conversation-routes-spec")
    val fileSystem = new LocalFileSystem(tmpDir)
    conversationService = new AssistantConversationService(repo, fileSystem)(routeEc)

    await(
      ctx.withSystemContext(
        DBIO.seq(
          sqlu"""INSERT INTO users (id, email, created_at)
                 VALUES (${ownerA.value}::uuid, ${s"${ownerA.value}@test.local"}, now())
                 ON CONFLICT DO NOTHING""",
          sqlu"""INSERT INTO users (id, email, created_at)
                 VALUES (${ownerB.value}::uuid, ${s"${ownerB.value}@test.local"}, now())
                 ON CONFLICT DO NOTHING"""
        )
      )
    )
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def cleanDb(): Unit = await(ctx.withSystemContext(sqlu"TRUNCATE TABLE assistant_conversations"))

  // ── Fake ClaudeTransport (mirrors AssistantServiceSpec's own fixture style) ────────────────────

  private def claudeConfig(): ClaudeConfig =
    ClaudeConfig(apiKey = "sk-ant-test-should-never-be-used", model = "claude-test", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)

  private def finalTextResponse(text: String): Future[ClaudeApiResponse] =
    Future.successful(
      ClaudeApiResponse(id = "msg_final", content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some(text))), stopReason = Some("end_turn"), usage = ClaudeApiUsage(8, 4))
    )

  private class FakeTransport(response: Future[ClaudeApiResponse]) extends ClaudeTransport {
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = Future.failed(new UnsupportedOperationException("not exercised"))
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException("not exercised")
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse]    = response
  }

  // No propose_*/find/get_resource tool_use is ever scripted in this file's fake responses, so
  // AssistantToolExecutor's other 5 collaborators are never touched -- null is safe here, mirroring
  // AssistantServiceSpec's own established "null-unused" pattern for collaborators no scripted
  // sequence reaches.
  private def assistantServiceWith(transport: ClaudeTransport): AssistantService =
    new AssistantService(new ClaudeClient(claudeConfig(), transport)(routeEc), null, null, null, null, null, null)(routeEc)

  private def routesFor(user: AuthenticatedUser, assistantOpt: Option[AssistantService]): Route =
    new AssistantConversationRoutes(conversationService, assistantOpt, user).routes

  private def jsonEntity(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)

  private def transcriptOf(json: String): Vector[ClaudeToolMessage] =
    json.parseJson.asJsObject.fields("transcript").convertTo[Vector[ClaudeToolMessage]]

  "POST /assistant-conversations/:id/converse" should {

    "persist the new turns on success -- a subsequent GET returns the identical transcript (tasks.md 6.3)" in {
      cleanDb()
      val detail           = await(conversationService.create(userA, None, title = None))
      val assistantService = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) should have size 2
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) should have size 2
      }
    }

    // evaluation-1.md Change Request 1 (cycle 2, live-verified defect) — dedicated regression
    // coverage at the route/persistence layer. Task 6.3 above already exercises a brand-new
    // (empty-history) conversation but only asserted `transcript.size` — exactly why this shipped
    // without a test catching it (evaluation-1.md's own note). This test asserts the persisted
    // first turn's CONTENT: exactly the typed message, never AssistantSystemPrompt.text folded in.
    "persist EXACTLY the typed message (never the internal system prompt) as the first turn's content for a brand-new conversation" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"What's our revenue?"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val transcript = transcriptOf(responseAs[String])
        transcript should have size 2
        transcript.head.role shouldBe "user"
        transcript.head.content shouldBe Seq(ClaudeContentBlock.Text("What's our revenue?"))
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]).head.content shouldBe Seq(ClaudeContentBlock.Text("What's our revenue?"))
      }
    }

    "return the mapped error status and persist nothing on a real Claude/transport failure (tasks.md 6.3a)" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val failingAssistant  = assistantServiceWith(new FakeTransport(Future.failed(ClaudeApiException(500, "internal server error"))))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(failingAssistant)) ~> check {
        status shouldBe StatusCodes.BadGateway
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(failingAssistant)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) shouldBe empty
      }
    }

    "return 503 when assistantServiceOpt is None, while GET /assistant-conversations still works normally (tasks.md 6.4)" in {
      cleanDb()
      val detail = await(conversationService.create(userA, None, title = None))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, None) ~> check {
        status shouldBe StatusCodes.ServiceUnavailable
      }

      Get("/assistant-conversations") ~> routesFor(userA, None) ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "a second user cannot converse with the first user's conversation -- not-found, no turns persisted (tasks.md 6.5, real Postgres RLS)" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"intrusion"}""")) ~> routesFor(userB, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.NotFound
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) shouldBe empty
      }
    }
  }
}
