package com.helio.api.routes.assistant

import com.helio.api.routes.assistant.AssistantConversationRoutes
import com.helio.ai._
import com.helio.api.JsonProtocols
import com.helio.api.protocols.assistant.TierErrorResponse
import com.helio.domain.model._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.infrastructure.persistence.assistant.{AssistantConversationRepository, AssistantDailyUsageRepository}
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.infrastructure.persistence.auth.UserRepository
import com.helio.services.assistant.{AssistantConversationService, AssistantService}
import com.helio.services.auth.{ChatAccessService, UserTierConfig}
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
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
  // HEL-703 tasks.md 6.4: userRepo/usageRepo back the tier gate under test — `appDb` is correct
  // here (not the privileged pool) because `users` carries no RLS (V88's own migration comment),
  // so a plain `UserRepository(appDb)` resolves exactly as it does in production.
  private var userRepo: UserRepository                 = _
  private var usageRepo: AssistantDailyUsageRepository = _
  private var chatAccessService: ChatAccessService      = _

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

    userRepo  = new UserRepository(appDb)(routeEc)
    usageRepo = new AssistantDailyUsageRepository(ctx)(routeEc)
    // HEL-703: the module-level userA/userB fixtures below are seeded `owner`-tier (not the
    // `free` default) precisely so every PRE-EXISTING test in this file — written before tier
    // gating existed — keeps exercising unrestricted, uncounted access. The dedicated tier-gating
    // tests near the bottom of this file seed their OWN fresh users at whichever tier they need.
    chatAccessService = new ChatAccessService(userRepo, usageRepo, UserTierConfig(Set.empty, UserTierConfig.DefaultBetaDailyMessageLimit))

    await(
      ctx.withSystemContext(
        DBIO.seq(
          sqlu"""INSERT INTO users (id, email, created_at, tier)
                 VALUES (${ownerA.value}::uuid, ${s"${ownerA.value}@test.local"}, now(), 'owner')
                 ON CONFLICT DO NOTHING""",
          sqlu"""INSERT INTO users (id, email, created_at, tier)
                 VALUES (${ownerB.value}::uuid, ${s"${ownerB.value}@test.local"}, now(), 'owner')
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

  // No propose_*/find/get_resource/test_connection tool_use is ever scripted in this file's fake
  // responses, so AssistantToolExecutor's other 6 collaborators are never touched -- null is safe
  // here, mirroring AssistantServiceSpec's own established "null-unused" pattern for collaborators
  // no scripted sequence reaches.
  private def assistantServiceWith(transport: ClaudeTransport): AssistantService =
    new AssistantService(new ClaudeClient(claudeConfig(), transport)(routeEc), null, null, null, null, null, null, null)(routeEc)

  // HEL-667 tasks.md 7.3 — a real (Mockito-backed) `WorkspaceSearchService` so a scripted `find`
  // tool_use actually executes end-to-end, needed for the searchedWithNoResults scenario. Mirrors
  // `AssistantServiceSpec`'s own `newService` wiring; every collaborator `find` never reaches
  // (dashboard/dataSource/pipeline/metric summaries -- `findInput` below only requests `dataType`)
  // stays null.
  private def assistantServiceWithSearch(transport: ClaudeTransport, outputRepo: OutputRepository): AssistantService = {
    val workspaceContextService = new WorkspaceContextService(null, null, outputRepo, null)(routeEc)
    val workspaceSearchService  = new WorkspaceSearchService(null, null, outputRepo, null, null, workspaceContextService)(routeEc)
    new AssistantService(new ClaudeClient(claudeConfig(), transport)(routeEc), workspaceSearchService, null, null, null, null, null, null)(routeEc)
  }

  private def routesFor(user: AuthenticatedUser, assistantOpt: Option[AssistantService]): Route =
    routesForWithChatAccess(user, assistantOpt, chatAccessService)

  // HEL-703 tasks.md 6.4: lets the tier-gating tests below inject a `ChatAccessService` built with
  // a different (usually much smaller, for a fast test) `UserTierConfig` than the module-level
  // default, while still sharing the SAME userRepo/usageRepo instances (and therefore the same
  // underlying tables) every other helper in this file uses.
  private def routesForWithChatAccess(user: AuthenticatedUser, assistantOpt: Option[AssistantService], chatAccess: ChatAccessService): Route =
    new AssistantConversationRoutes(conversationService, assistantOpt, chatAccess, user).routes

  // HEL-703 tasks.md 6.4 — a `ChatAccessService` sharing the SAME userRepo/usageRepo (and
  // therefore the same underlying tables) as `chatAccessService`, but with a caller-chosen daily
  // limit — lets the beta-cap tests below use a small limit instead of the module-level default.
  private def chatAccessServiceWithLimit(limit: Int): ChatAccessService =
    new ChatAccessService(userRepo, usageRepo, UserTierConfig(Set.empty, limit))

  // HEL-703 tasks.md 6.4 — a fresh user seeded directly at `tier` (never via register/login —
  // per the ticket's own non-goal, tier assignment beyond the owner allowlist is a direct DB
  // update for this pass).
  private def newUserWithTier(tier: String): AuthenticatedUser = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at, tier)
             VALUES ($id::uuid, ${s"$id@test.local"}, now(), $tier)"""
    ))
    AuthenticatedUser(UserId(id))
  }

  // HEL-703 tasks.md 6.4 — reads `assistant_daily_usage` for TODAY (UTC), matching exactly what
  // `AssistantDailyUsageRepository.incrementIfUnderCap` writes -- deliberately NOT `CURRENT_DATE`
  // (Postgres session-timezone-dependent), so this assertion can never disagree with production
  // behavior over a timezone mismatch.
  private def dailyUsageCount(user: AuthenticatedUser): Option[Int] = {
    val today = java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString
    await(ctx.withSystemContext(
      sql"""SELECT message_count FROM assistant_daily_usage
            WHERE user_id = ${user.id.value}::uuid AND usage_date = $today::date"""
        .as[Int]
        .headOption
    ))
  }

  private def conversationCountFor(user: AuthenticatedUser): Int =
    await(ctx.withSystemContext(
      sql"SELECT COUNT(*) FROM assistant_conversations WHERE owner_id = ${user.id.value}::uuid".as[Int].head
    ))

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

  // HEL-698 tasks.md 4.3 (design.md D3/D4/D5, assistant-live-converse spec) — client-generated
  // idempotency key: a same-key replay is a no-op, an over-long key is rejected, a keyless call is
  // unaffected, and both GET/converse responses carry the persisted `lastIdempotencyKey`.
  "POST /assistant-conversations/:id/converse idempotency key" should {

    "a second converse with the SAME key is a no-op replay -- 200, transcript unchanged, the underlying Claude transport invoked exactly once" in {
      cleanDb()
      val detail    = await(conversationService.create(userA, None, title = None))
      val transport = new SequencedTransport(Vector(finalTextResponse("Hi there!")))
      val assistantService = assistantServiceWith(transport)

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello","idempotencyKey":"key-1"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) should have size 2
      }

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello","idempotencyKey":"key-1"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) should have size 2
      }

      transport.receivedRequests should have size 1
    }

    "an idempotencyKey longer than 128 characters is rejected with 400 and nothing is persisted" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))
      val overLongKey       = "k" * 129

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity(s"""{"message":"Hello","idempotencyKey":"$overLongKey"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.BadRequest
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) shouldBe empty
      }
    }

    "a keyless converse behaves exactly as before -- no lastIdempotencyKey field on the response" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.keySet should not contain "lastIdempotencyKey"
      }
    }

    "GET and converse responses both carry lastIdempotencyKey once a keyed send has landed" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello","idempotencyKey":"key-1"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("lastIdempotencyKey") shouldBe JsString("key-1")
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("lastIdempotencyKey") shouldBe JsString("key-1")
      }
    }
  }

  // HEL-667 tasks.md 7.3 (design.md D1, assistant-live-converse spec) — the two new ephemeral
  // turn-outcome signals surface on a converse response and stay absent on GET.
  "POST /assistant-conversations/:id/converse turn-outcome signals" should {

    "surfaces hopBudgetExhausted = true when the turn hits the hop cap" in {
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
      val outputRepo = mock(classOf[OutputRepository])
      when(outputRepo.findAllByOwner(userA.id, Page.Default)).thenReturn(Future.successful(PagedResult(Vector.empty[Output], 0, 0, 200)))
      val findInput = JsObject("query" -> JsString("orders"), "resourceTypes" -> JsArray(JsString("dataType")))
      val transport = new SequencedTransport(
        Vector(toolUseResponse("t1", "find", findInput), finalTextResponse("I couldn't find anything -- can you narrow it down?"))
      )
      val assistantService = assistantServiceWithSearch(transport, outputRepo)

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

      // First call: every hop returns the SAME unresolved tool_use, driving the loop to the hop cap
      // ("unknown_tool" is never in AssistantProtocol.assistantTools -- AssistantToolExecutor's
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


  "Tier gating" should {

    "deny a free-tier user 403 TIER_FORBIDDEN on every endpoint in the family, with nothing persisted" in {
      cleanDb()
      val freeUser = newUserWithTier("free")
      val routes   = routesFor(freeUser, None)
      // A conversation created by a DIFFERENT (owner) user — proves the 403 wins even when a real
      // id exists, i.e. the gate runs strictly before any handler/persistence logic.
      val existing = await(conversationService.create(userA, None, title = None))

      def assertForbidden() = {
        status shouldBe StatusCodes.Forbidden
        responseAs[TierErrorResponse].code shouldBe "TIER_FORBIDDEN"
      }

      Get("/assistant-conversations") ~> routes ~> check { assertForbidden() }
      Post("/assistant-conversations", jsonEntity("{}")) ~> routes ~> check { assertForbidden() }
      Get(s"/assistant-conversations/${existing.record.id.value}") ~> routes ~> check { assertForbidden() }
      Post(s"/assistant-conversations/${existing.record.id.value}/messages", jsonEntity("""{"turns":[]}""")) ~> routes ~> check { assertForbidden() }
      Post(s"/assistant-conversations/${existing.record.id.value}/converse", jsonEntity("""{"message":"hi"}""")) ~> routes ~> check { assertForbidden() }
      Patch(s"/assistant-conversations/${existing.record.id.value}", jsonEntity("""{"pinned":true}""")) ~> routes ~> check { assertForbidden() }

      // Nothing the free user attempted was persisted (the owner's pre-existing conversation is
      // untouched, and the free user created none of their own).
      conversationCountFor(freeUser) shouldBe 0
    }

    "a beta-tier user under the cap converses normally, then gets 429 CHAT_LIMIT_REACHED once at the cap -- no model call, no turns persisted for the denied attempt" in {
      cleanDb()
      val betaUser  = newUserWithTier("beta")
      val transport = new SequencedTransport(Vector(finalTextResponse("Hi there!")))
      val detail    = await(conversationService.create(betaUser, None, title = None))
      val routes    = routesForWithChatAccess(betaUser, Some(assistantServiceWith(transport)), chatAccessServiceWithLimit(1))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"one"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"two"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.TooManyRequests
        val body = responseAs[TierErrorResponse]
        body.code shouldBe "CHAT_LIMIT_REACHED"
        body.limit shouldBe Some(1)
      }

      // The model was invoked exactly once (for the first, under-cap call) -- the second,
      // over-cap call never reached AssistantService.converse at all.
      transport.receivedRequests should have size 1
      // Exactly one user+assistant turn pair persisted -- from the first call only.
      val after = await(conversationService.get(betaUser, detail.record.id))
      after.map(_.transcript.convertTo[Vector[ClaudeToolMessage]].size) shouldBe Right(2)
    }

    "a beta-tier user at the cap can still list conversations and read one (200)" in {
      cleanDb()
      val betaUser = newUserWithTier("beta")
      val detail   = await(conversationService.create(betaUser, None, title = None))
      // limit = 0 deterministically puts this user "at the cap" (design.md D6: < 1 is always
      // capped) without needing to first burn through N real messages.
      val routes = routesForWithChatAccess(betaUser, None, chatAccessServiceWithLimit(0))

      Get("/assistant-conversations") ~> routes ~> check { status shouldBe StatusCodes.OK }
      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routes ~> check { status shouldBe StatusCodes.OK }
    }

    "an owner-tier user converses successfully with no cap, past the beta limit, and writes no assistant_daily_usage row" in {
      cleanDb()
      val ownerUser = newUserWithTier("owner")
      val transport = new SequencedTransport(Vector(finalTextResponse("a"), finalTextResponse("b"), finalTextResponse("c")))
      val detail    = await(conversationService.create(ownerUser, None, title = None))
      // The "beta" limit here is deliberately tiny (1) -- proves owner ignores it entirely.
      val routes = routesForWithChatAccess(ownerUser, Some(assistantServiceWith(transport)), chatAccessServiceWithLimit(1))

      (1 to 3).foreach { n =>
        Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity(s"""{"message":"msg-$n"}""")) ~> routes ~> check {
          status shouldBe StatusCodes.OK
        }
      }

      transport.receivedRequests should have size 3
      dailyUsageCount(ownerUser) shouldBe None
    }
  }
}
