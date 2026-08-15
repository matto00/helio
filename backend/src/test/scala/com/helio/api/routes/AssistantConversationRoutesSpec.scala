package com.helio.api.routes

import com.helio.ai._
import com.helio.api.JsonProtocols
import com.helio.domain._
import com.helio.infrastructure.AssistantConversationRepository._
import com.helio.infrastructure.{AssistantConversationRepository, DataSourceRepository, DataTypeRepository, DataTypeRowRepository, DbContext, LocalFileSystem}
import com.helio.services.{AssistantConversationService, AssistantService, DataTypeService, WorkspaceContextService, WorkspaceSearchService}
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
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, when}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContextExecutor, Future}
import scala.jdk.CollectionConverters._

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

  // HEL-667 tasks.md 7.3 — a tool_use response, for scripting a hop-cap-exhausted or find sequence.
  private def toolUseResponse(id: String, name: String, input: JsValue): Future[ClaudeApiResponse] =
    Future.successful(
      ClaudeApiResponse(
        id         = s"msg_$id",
        content    = Seq(ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))),
        stopReason = Some("tool_use"),
        usage      = ClaudeApiUsage(8, 4)
      )
    )

  private class FakeTransport(response: Future[ClaudeApiResponse]) extends ClaudeTransport {
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = Future.failed(new UnsupportedOperationException("not exercised"))
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException("not exercised")
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse]    = response
  }

  // HEL-667 tasks.md 7.3 — one `sendTool` response per invocation, in call order (mirrors
  // `ClaudeClientSpec`/`AssistantServiceSpec`'s own `FakeToolTransport` fixture style), needed for
  // the searchedWithNoResults scenario (a find hop followed by a distinct final-text hop). Also
  // RECORDS every request it receives (skeptic-final-1.md CR1) so a test can assert on the
  // structural shape of the OUTBOUND request a second converse call actually sends.
  private class SequencedTransport(responses: Vector[Future[ClaudeApiResponse]]) extends ClaudeTransport {
    private val invocationCount  = new AtomicInteger(0)
    private val recordedRequests = new CopyOnWriteArrayList[ClaudeApiToolRequest]()
    def receivedRequests: Vector[ClaudeApiToolRequest] = recordedRequests.asScala.toVector
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = Future.failed(new UnsupportedOperationException("not exercised"))
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException("not exercised")
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = {
      recordedRequests.add(request)
      responses(invocationCount.getAndIncrement())
    }
  }

  // No propose_*/find/get_resource tool_use is ever scripted in this file's fake responses, so
  // AssistantToolExecutor's other 5 collaborators are never touched -- null is safe here, mirroring
  // AssistantServiceSpec's own established "null-unused" pattern for collaborators no scripted
  // sequence reaches.
  private def assistantServiceWith(transport: ClaudeTransport): AssistantService =
    new AssistantService(new ClaudeClient(claudeConfig(), transport)(routeEc), null, null, null, null, null, null)(routeEc)

  // HEL-667 tasks.md 7.3 — a real (Mockito-backed) `WorkspaceSearchService` so a scripted `find`
  // tool_use actually executes end-to-end, needed for the searchedWithNoResults scenario. Mirrors
  // `AssistantServiceSpec`'s own `newService` wiring; every collaborator `find` never reaches
  // (dashboard/dataSource/pipeline/metric summaries -- `findInput` below only requests `dataType`)
  // stays null.
  private def assistantServiceWithSearch(transport: ClaudeTransport, dtRepo: DataTypeRepository): AssistantService = {
    val rowRepo = mock(classOf[DataTypeRowRepository])
    when(rowRepo.listRows(any[String](), any[Option[Int]](), any[Set[String]]())).thenReturn(Future.successful(Vector.empty[JsObject]))
    val dataTypeService         = new DataTypeService(dtRepo, rowRepo, mock(classOf[DataSourceRepository]))(routeEc)
    val workspaceContextService = new WorkspaceContextService(null, null, dataTypeService, null)(routeEc)
    val workspaceSearchService  = new WorkspaceSearchService(null, null, dataTypeService, null, null, workspaceContextService)(routeEc)
    new AssistantService(new ClaudeClient(claudeConfig(), transport)(routeEc), workspaceSearchService, null, null, null, null, null)(routeEc)
  }

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

  // HEL-667 tasks.md 7.3 (design.md D1, assistant-live-converse spec) — the two new ephemeral
  // turn-outcome signals surface on a converse response and stay absent on GET.
  "POST /assistant-conversations/:id/converse turn-outcome signals" should {

    "surfaces hopBudgetExhausted = true when the turn hits the 3-hop cap" in {
      cleanDb()
      val detail = await(conversationService.create(userA, None, title = None))
      // "unknown_tool" is never a member of AssistantProtocol.assistantTools -- AssistantToolExecutor
      // falls back to `Left(s"Unknown tool: $other")` for it without touching any collaborator, so
      // every one of the (null) collaborators in assistantServiceWith stays unreached.
      val assistantService = assistantServiceWith(new FakeTransport(toolUseResponse("t", "unknown_tool", JsObject.empty)))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields("hopBudgetExhausted") shouldBe JsBoolean(true)
        obj.fields("searchedWithNoResults") shouldBe JsBoolean(false)
      }
    }

    "surfaces searchedWithNoResults = true when the turn's find call comes back empty" in {
      cleanDb()
      val detail = await(conversationService.create(userA, None, title = None))
      val dtRepo = mock(classOf[DataTypeRepository])
      when(dtRepo.findAll(userA.id, Page.Default, None)).thenReturn(Future.successful(PagedResult(Vector.empty[DataType], 0, 0, 200)))
      val findInput = JsObject("query" -> JsString("orders"), "resourceTypes" -> JsArray(JsString("dataType")))
      val transport = new SequencedTransport(
        Vector(toolUseResponse("t1", "find", findInput), finalTextResponse("I couldn't find anything -- can you narrow it down?"))
      )
      val assistantService = assistantServiceWithSearch(transport, dtRepo)

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Track weekly revenue"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields("searchedWithNoResults") shouldBe JsBoolean(true)
        obj.fields("hopBudgetExhausted") shouldBe JsBoolean(false)
      }
    }

    "GET never carries either signal, even right after a converse call that set them" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(toolUseResponse("t", "unknown_tool", JsObject.empty)))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.keySet should not contain "hopBudgetExhausted"
        obj.fields.keySet should not contain "searchedWithNoResults"
      }
    }
  }

  // skeptic-final-1.md CR1 (final-gate round 1, live-verified defect) — a conversation that hits
  // the hop cap must remain usable: a SECOND `POST /:id/converse` call on the SAME conversation
  // must succeed, not fail with the Anthropic API's "tool_use ids were found without tool_result
  // blocks immediately after" 400 the live bug reproduced twice against the real dev backend.
  "POST /assistant-conversations/:id/converse after a hop-cap-exhausted turn" should {

    "a second converse call succeeds, and its outbound request resolves the dangling tool_use in the immediately-following message" in {
      cleanDb()
      val detail = await(conversationService.create(userA, None, title = None))

      // First call: every hop returns the SAME unresolved tool_use, driving the loop to the 3-hop
      // cap ("unknown_tool" is never in AssistantProtocol.assistantTools -- AssistantToolExecutor's
      // fallback never touches a real collaborator, mirroring this file's own established fixture).
      val firstAssistant = assistantServiceWith(new FakeTransport(toolUseResponse("dangling-1", "unknown_tool", JsObject.empty)))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Build me a huge dashboard"}""")) ~>
        routesFor(userA, Some(firstAssistant)) ~> check {
          status shouldBe StatusCodes.OK
          val obj = responseAs[String].parseJson.asJsObject
          obj.fields("hopBudgetExhausted") shouldBe JsBoolean(true)
        }

      // Second call: a FRESH transport that records exactly what it received.
      val secondTransport = new SequencedTransport(Vector(finalTextResponse("Sure, let's narrow it down.")))
      val secondAssistant  = assistantServiceWith(secondTransport)

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Just show total revenue"}""")) ~>
        routesFor(userA, Some(secondAssistant)) ~> check {
          status shouldBe StatusCodes.OK
        }

      val outboundMessages = secondTransport.receivedRequests.head.messages
      // Every tool_use content block is immediately followed, in the VERY NEXT message, by a
      // tool_result block carrying a matching id -- the exact invariant the live 400 violated.
      outboundMessages.zipWithIndex.foreach {
        case (msg, idx) =>
          msg.content.filter(_.blockType == "tool_use").flatMap(_.id).foreach { danglingId =>
            outboundMessages(idx + 1).content.flatMap(_.toolUseId) should contain(danglingId)
          }
      }
      // No two consecutive outbound messages share a role either (the other structural invariant).
      outboundMessages.map(_.role).sliding(2).foreach {
        case Seq(a, b) => a should not be b
        case _         => ()
      }
    }
  }
}
