package com.helio.api.routes.assistant

import com.helio.testkit.HelioRouteTest
import com.helio.domain.util.Clock
import com.helio.testkit.TempDirectorySupport

import com.helio.api.routes.assistant.AssistantConversationRoutes
import com.helio.infrastructure.ai._
import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.infrastructure.persistence.assistant.{AssistantConversationRepository, AssistantDailyUsageRepository}
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.infrastructure.persistence.auth.UserRepository
import com.helio.services.assistant.{AssistantConversationService, AssistantModelPolicy, AssistantService}
import com.helio.services.auth.{ChatAccessService, UserTierConfig}
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.scaladsl.Source
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.LocalDate
import java.time.ZoneOffset
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContextExecutor, Future}
import scala.jdk.CollectionConverters._
import org.scalatest.Suite

/** The DB-backed fixture shared by the `AssistantConversationRoutes*Spec` classes (HEL-1803; split out of
 *  `AssistantConversationRoutesSpec`): the embedded Postgres with its dual-pool RLS harness (a real `helio_app_test`
 *  role the app pool `SET ROLE`s into, NOT BYPASSRLS), the service wiring, the fake transports and the route and
 *  count helpers. Each spec class starts its own instance in `beforeAll`, exactly as the original single class did.
 *  Moved verbatim apart from dropping `private`. */
trait AssistantConversationRoutesFixture extends BeforeAndAfterAll with TempDirectorySupport {
  this: Suite with HelioRouteTest with JsonProtocols =>

  implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  def routeEc: ExecutionContextExecutor = typedSystem.executionContext

  var embeddedPostgres: EmbeddedPostgres     = _
  var privilegedDb: JdbcBackend.Database     = _ // postgres superuser
  var appDb: JdbcBackend.Database             = _ // helio_app_test (non-superuser)
  var ctx: DbContext                          = _
  var repo: AssistantConversationRepository   = _
  var conversationService: AssistantConversationService = _
  // HEL-703 tasks.md 6.4: userRepo/usageRepo back the tier gate under test — `appDb` is correct
  // here (not the privileged pool) because `users` carries no RLS (V88's own migration comment),
  // so a plain `UserRepository(appDb)` resolves exactly as it does in production.
  var userRepo: UserRepository                 = _
  var usageRepo: AssistantDailyUsageRepository = _
  var chatAccessService: ChatAccessService      = _

  val ownerA = UserId(UUID.randomUUID().toString)
  val ownerB = UserId(UUID.randomUUID().toString)
  val userA  = AuthenticatedUser(ownerA)
  val userB  = AuthenticatedUser(ownerB)

  def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))

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

    val tmpDir     = newTempDir("helio-assistant-conversation-routes-spec")
    val fileSystem = new LocalFileSystem(tmpDir)
    conversationService = new AssistantConversationService(repo, fileSystem)(routeEc)

    userRepo  = new UserRepository(appDb)(routeEc)
    usageRepo = new AssistantDailyUsageRepository(ctx, PinnedDayClock)(routeEc)
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

  def cleanDb(): Unit = await(ctx.withSystemContext(sqlu"TRUNCATE TABLE assistant_conversations"))

  // ── Fake ClaudeTransport (mirrors AssistantServiceSpec's own fixture style) ────────────────────

  def claudeConfig(): ClaudeConfig =
    ClaudeConfig(apiKey = "sk-ant-test-should-never-be-used", model = "claude-test", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)

  def finalTextResponse(text: String): Future[ClaudeApiResponse] =
    Future.successful(
      ClaudeApiResponse(id = "msg_final", content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some(text))), stopReason = Some("end_turn"), usage = ClaudeApiUsage(8, 4))
    )

  // HEL-667 tasks.md 7.3 — a tool_use response, for scripting a hop-cap-exhausted or find sequence.
  def toolUseResponse(id: String, name: String, input: JsValue): Future[ClaudeApiResponse] =
    Future.successful(
      ClaudeApiResponse(
        id         = s"msg_$id",
        content    = Seq(ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))),
        stopReason = Some("tool_use"),
        usage      = ClaudeApiUsage(8, 4)
      )
    )

  class FakeTransport(response: Future[ClaudeApiResponse]) extends ClaudeTransport {
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = Future.failed(new UnsupportedOperationException("not exercised"))
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException("not exercised")
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse]    = response
  }

  // HEL-667 tasks.md 7.3 — one `sendTool` response per invocation, in call order (mirrors
  // `ClaudeClientSpec`/`AssistantServiceSpec`'s own `FakeToolTransport` fixture style), needed for
  // the searchedWithNoResults scenario (a find hop followed by a distinct final-text hop). Also
  // RECORDS every request it receives (skeptic-final-1.md CR1) so a test can assert on the
  // structural shape of the OUTBOUND request a second converse call actually sends.
  class SequencedTransport(responses: Vector[Future[ClaudeApiResponse]]) extends ClaudeTransport {
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
  def assistantServiceWith(transport: ClaudeTransport): AssistantService =
    new AssistantService(new ClaudeClient(claudeConfig(), transport)(routeEc), null, null, null, null, null, null, null)(routeEc)

  // HEL-667 tasks.md 7.3 — a real (Mockito-backed) `WorkspaceSearchService` so a scripted `find`
  // tool_use actually executes end-to-end, needed for the searchedWithNoResults scenario. Mirrors
  // `AssistantServiceSpec`'s own `newService` wiring; every collaborator `find` never reaches
  // (dashboard/dataSource/pipeline/metric summaries -- `findInput` below only requests `dataType`)
  // stays null.
  def assistantServiceWithSearch(transport: ClaudeTransport, outputRepo: OutputRepository): AssistantService = {
    val workspaceContextService = new WorkspaceContextService(null, null, outputRepo, null)(routeEc)
    val workspaceSearchService  = new WorkspaceSearchService(null, null, outputRepo, null, workspaceContextService)(routeEc)
    new AssistantService(new ClaudeClient(claudeConfig(), transport)(routeEc), workspaceSearchService, null, null, null, null, null, null)(routeEc)
  }

  def routesFor(user: AuthenticatedUser, assistantOpt: Option[AssistantService]): Route =
    routesForWithChatAccess(user, assistantOpt, chatAccessService)

  // HEL-703 tasks.md 6.4: lets the tier-gating tests below inject a `ChatAccessService` built with
  // a different (usually much smaller, for a fast test) `UserTierConfig` than the module-level
  // default, while still sharing the SAME userRepo/usageRepo instances (and therefore the same
  // underlying tables) every other helper in this file uses.
  def routesForWithChatAccess(user: AuthenticatedUser, assistantOpt: Option[AssistantService], chatAccess: ChatAccessService): Route =
    new AssistantConversationRoutes(
      conversationService, assistantOpt, chatAccess, user,
      new AssistantModelPolicy(ClaudeModelCatalog.all, "claude-test"), _ => Future.successful(None)
    ).routes

  // HEL-703 tasks.md 6.4 — a `ChatAccessService` sharing the SAME userRepo/usageRepo (and
  // therefore the same underlying tables) as `chatAccessService`, but with a caller-chosen daily
  // limit — lets the beta-cap tests below use a small limit instead of the module-level default.
  def chatAccessServiceWithLimit(limit: Int): ChatAccessService =
    new ChatAccessService(userRepo, usageRepo, UserTierConfig(Set.empty, limit))

  // HEL-703 tasks.md 6.4 — a fresh user seeded directly at `tier` (never via register/login —
  // per the ticket's own non-goal, tier assignment beyond the owner allowlist is a direct DB
  // update for this pass).
  def newUserWithTier(tier: String): AuthenticatedUser = {
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
  // HEL-1473: pin the beta per-UTC-day bucket so a run straddling real UTC midnight cannot split it.
  object PinnedDayClock extends Clock { def now(): Instant = Instant.parse("2026-01-01T12:00:00Z") }
  val pinnedDate: LocalDate = LocalDate.ofInstant(PinnedDayClock.now(), ZoneOffset.UTC)

  def dailyUsageCount(user: AuthenticatedUser): Option[Int] = {
    val today = pinnedDate.toString
    await(ctx.withSystemContext(
      sql"""SELECT message_count FROM assistant_daily_usage
            WHERE user_id = ${user.id.value}::uuid AND usage_date = $today::date"""
        .as[Int]
        .headOption
    ))
  }

  def conversationCountFor(user: AuthenticatedUser): Int =
    await(ctx.withSystemContext(
      sql"SELECT COUNT(*) FROM assistant_conversations WHERE owner_id = ${user.id.value}::uuid".as[Int].head
    ))

  def jsonEntity(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)

  def transcriptOf(json: String): Vector[ClaudeToolMessage] =
    json.parseJson.asJsObject.fields("transcript").convertTo[Vector[ClaudeToolMessage]]
}
