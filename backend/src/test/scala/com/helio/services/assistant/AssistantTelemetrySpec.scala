package com.helio.services.assistant

import com.helio.api.routes.assistant.AssistantConversationRoutes
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.assistant.{AssistantConversationRepository, AssistantDailyUsageRepository}
import com.helio.infrastructure.persistence.auth.UserRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.ai._
import com.helio.api.http.TraceContextDirective
import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.services.assistant.AssistantConversationService
import com.helio.services.assistant.AssistantService
import com.helio.services.auth.ChatAccessService
import com.helio.services.auth.UserTierConfig
import com.helio.testsupport.JsonLogCapture
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.scaladsl.Source
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.concurrent.Eventually
import org.scalatest.matchers.should.Matchers
import org.scalatest.time.{Millis, Seconds, Span}
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, ExecutionContextExecutor, Future}

/** HEL-667 tasks.md 7.4 (design.md D6, assistant-tool-loop-telemetry spec) — the exact claim
 *  design-gate round-1 caught unverified for HEL-401's own `AuthoringTelemetry`: a real telemetry
 *  log line, captured via a genuine `LogstashEncoder` appender (not a mocked logging call), carries
 *  the trace-id MDC field, the correct `toolCallCount`/`hopBudgetExhausted`/`searchedWithNoResults`/
 *  `modelId`/token-usage fields on a successful `POST /:id/converse` call, NEVER a line for a failed
 *  one, and NEVER the user's typed message text anywhere in the captured output. Mirrors
 *  `AuthoringTelemetrySpec`'s exact `JsonLogCapture`/`Eventually` harness; HTTP-shell wiring depth
 *  (persistence, 503-when-unconfigured, RLS) is `AssistantConversationRoutesSpec`'s job. */
class AssistantTelemetrySpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with Eventually
    with BeforeAndAfterAll {

  override implicit val patienceConfig: PatienceConfig = PatienceConfig(timeout = Span(2, Seconds), interval = Span(20, Millis))

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContextExecutor           = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres            = _
  private var db: JdbcBackend.Database                        = _
  private var ctx: DbContext                                  = _
  private var conversationService: AssistantConversationService = _
  // HEL-703 tasks.md 3.4/D7: this spec's scope is the telemetry line's OWN fields (toolCallCount/
  // hopBudgetExhausted/etc.), not tier enforcement -- every fixture user below is seeded `owner`
  // (unlimited, uncounted) so the tier gate never interferes with a converse call this suite is
  // trying to measure.
  private var chatAccessService: ChatAccessService            = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    implicit val ec: ExecutionContext = routeEc

    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    // Non-RLS harness (mirrors AuthoringTelemetrySpec's own `new DbContext(db, db)`) -- this spec's
    // scope is the telemetry line's own fields, not cross-user access control.
    ctx      = new DbContext(db, db)
    val repo = new AssistantConversationRepository(ctx)

    val tmpDir     = Files.createTempDirectory("helio-assistant-telemetry-spec")
    val fileSystem = new LocalFileSystem(tmpDir)
    conversationService = new AssistantConversationService(repo, fileSystem)(routeEc)
    chatAccessService = new ChatAccessService(
      new UserRepository(db),
      new AssistantDailyUsageRepository(ctx),
      UserTierConfig(Set.empty, UserTierConfig.DefaultBetaDailyMessageLimit)
    )
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }


  private def newUser(): AuthenticatedUser = {
    implicit val ec: ExecutionContext = routeEc
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at, tier) VALUES ($id::uuid, ${s"$id@test.local"}, now(), 'owner')"""))
    AuthenticatedUser(UserId(id))
  }

  private def claudeConfig(modelId: String): ClaudeConfig =
    ClaudeConfig(apiKey = "sk-ant-test-should-never-be-used", model = modelId, temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)

  private def finalTextResponse(text: String): Future[ClaudeApiResponse] =
    Future.successful(
      ClaudeApiResponse(id = "msg_final", content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some(text))), stopReason = Some("end_turn"), usage = ClaudeApiUsage(10, 6))
    )

  private def toolUseResponse(id: String, name: String): Future[ClaudeApiResponse] =
    Future.successful(
      ClaudeApiResponse(
        id         = s"msg_$id",
        content    = Seq(ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(JsObject.empty))),
        stopReason = Some("tool_use"),
        usage      = ClaudeApiUsage(8, 4)
      )
    )

  // assistant-prompt-caching tasks.md 4.4 (design.md D5) -- same tool_use fixture as toolUseResponse
  // above, but with a nonzero cache_read_input_tokens on every hop's usage, so a multi-hop turn's
  // aggregated telemetry line shows a nonzero cacheReadInputTokens (AC #2).
  private def toolUseResponseWithCacheRead(id: String, name: String, cacheReadInputTokens: Int): Future[ClaudeApiResponse] =
    Future.successful(
      ClaudeApiResponse(
        id         = s"msg_$id",
        content    = Seq(ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(JsObject.empty))),
        stopReason = Some("tool_use"),
        usage      = ClaudeApiUsage(inputTokens = 8, outputTokens = 4, cacheCreationInputTokens = 0, cacheReadInputTokens = cacheReadInputTokens)
      )
    )

  private class FakeTransport(response: Future[ClaudeApiResponse]) extends ClaudeTransport {
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = Future.failed(new UnsupportedOperationException("not exercised"))
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException("not exercised")
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse]    = response
  }

  // No propose_*/find/get_resource/test_connection tool_use is ever scripted below, so
  // AssistantToolExecutor's other 6 collaborators are never touched -- null is safe (mirrors
  // AssistantConversationRoutesSpec's own established "null-unused" pattern).
  private def assistantServiceWith(transport: ClaudeTransport, modelId: String): AssistantService =
    new AssistantService(new ClaudeClient(claudeConfig(modelId), transport)(routeEc), null, null, null, null, null, null, null)(routeEc)

  private val traceDirective = new TraceContextDirective(projectId = None)
  private val TraceValue     = "assistant-trace-abc123"

  private def tracedRoutesFor(user: AuthenticatedUser, assistantOpt: Option[AssistantService]): Route =
    traceDirective.withTraceContext {
      new AssistantConversationRoutes(conversationService, assistantOpt, chatAccessService, user).routes
    }

  private def tracedPost(path: String, body: String) =
    Post(path, HttpEntity(ContentTypes.`application/json`, body))
      .withHeaders(RawHeader(TraceContextDirective.TraceHeaderName, s"$TraceValue/9;o=1"))

  /** Finds the telemetry line(s) belonging to THIS call, filtering out interleaved noise from
   *  concurrently-running suites (`JsonLogCapture`'s own doc comment). */
  private def linesFor(read: () => String, modelId: String): Seq[JsObject] =
    JsonLogCapture.jsonLines(read()).filter(_.fields.get("modelId").contains(JsString(modelId)))

  "POST /:id/converse success telemetry" should {

    "a zero-tool-call turn emits an assistant_tool_loop_outcome line with the correct fields and trace id" in {
      val user      = newUser()
      val detail    = await(conversationService.create(user, None, title = None))
      val modelId   = s"model-${UUID.randomUUID()}"
      val service   = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")), modelId)
      val messageText = "a secret goal that must never be logged"

      JsonLogCapture.withCapture("com.helio.services.AssistantTelemetry") { read =>
        tracedPost(s"/assistant-conversations/${detail.record.id.value}/converse", s"""{"message":"$messageText"}""") ~>
          tracedRoutesFor(user, Some(service)) ~> check {
            status shouldBe StatusCodes.OK
          }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("event") shouldBe JsString("assistant_tool_loop_outcome")
          lines.head.fields("conversationId") shouldBe JsString(detail.record.id.value)
          lines.head.fields("toolCallCount") shouldBe JsString("0")
          lines.head.fields("hopBudgetExhausted") shouldBe JsString("false")
          lines.head.fields("searchedWithNoResults") shouldBe JsString("false")
          lines.head.fields("modelId") shouldBe JsString(modelId)
          lines.head.fields("inputTokens") shouldBe JsString("10")
          lines.head.fields("outputTokens") shouldBe JsString("6")
          lines.head.fields("cacheReadInputTokens") shouldBe JsString("0")
          lines.head.fields("cacheCreationInputTokens") shouldBe JsString("0")
          lines.head.fields(TraceContextDirective.TraceMdcKey) shouldBe JsString(TraceValue)
          // HEL-700 tasks.md 3.5 — a turn with no propose_* call carries all three counters at zero.
          lines.head.fields("proposeAttempts") shouldBe JsString("0")
          lines.head.fields("proposeDecodeFailures") shouldBe JsString("0")
          lines.head.fields("proposeValidationFailures") shouldBe JsString("0")
        }

        // HEL-667 design.md's own privacy rule -- never the raw typed message, anywhere in the
        // captured output (not just absent as a named field).
        read() should not include messageText
      }
    }

    "a hop-cap-exhausted turn's telemetry line reflects hopBudgetExhausted=true and every requested tool_use" in {
      val user    = newUser()
      val detail  = await(conversationService.create(user, None, title = None))
      val modelId = s"model-${UUID.randomUUID()}"
      // "unknown_tool" is never in AssistantProtocol.assistantTools -- AssistantToolExecutor's
      // fallback (`Left(s"Unknown tool: $other")`) never touches a real collaborator, so the fixed,
      // repeated tool_use response can safely drive all the way to the 4-hop cap (HEL-756).
      val service = assistantServiceWith(new FakeTransport(toolUseResponse("t", "unknown_tool")), modelId)

      JsonLogCapture.withCapture("com.helio.services.AssistantTelemetry") { read =>
        tracedPost(s"/assistant-conversations/${detail.record.id.value}/converse", """{"message":"Hello"}""") ~>
          tracedRoutesFor(user, Some(service)) ~> check {
            status shouldBe StatusCodes.OK
          }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("hopBudgetExhausted") shouldBe JsString("true")
          lines.head.fields("searchedWithNoResults") shouldBe JsString("false")
          // HEL-756: 5 tool_use blocks are requested across the loop's 5 transport round trips (the
          // 5th one is never executed by AssistantToolExecutor, but it IS present in fullHistory --
          // see AssistantConversationRoutes.countToolUses's own doc comment).
          lines.head.fields("toolCallCount") shouldBe JsString("5")
        }
      }
    }

    // assistant-tool-loop-telemetry spec delta scenario "A multi-hop turn's record shows nonzero
    // cache reads" (assistant-prompt-caching tasks.md 4.4/design.md D5) -- 5 hops (HEL-756: maxHops
    // raised to 4, so a hop-cap-exhausted turn now spans 5 round trips), each reporting
    // cache_read_input_tokens=50, aggregate to a nonzero cacheReadInputTokens on the emitted record.
    "a multi-hop turn's telemetry line shows a nonzero, correctly-aggregated cacheReadInputTokens" in {
      val user    = newUser()
      val detail  = await(conversationService.create(user, None, title = None))
      val modelId = s"model-${UUID.randomUUID()}"
      val service = assistantServiceWith(new FakeTransport(toolUseResponseWithCacheRead("t", "unknown_tool", cacheReadInputTokens = 50)), modelId)

      JsonLogCapture.withCapture("com.helio.services.AssistantTelemetry") { read =>
        tracedPost(s"/assistant-conversations/${detail.record.id.value}/converse", """{"message":"Hello"}""") ~>
          tracedRoutesFor(user, Some(service)) ~> check {
            status shouldBe StatusCodes.OK
          }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          // Same 5-round-trip hop-cap-exhausted shape as the sibling test above -- 5 hops x 50.
          lines.head.fields("cacheReadInputTokens") shouldBe JsString("250")
          lines.head.fields("cacheCreationInputTokens") shouldBe JsString("0")
        }
      }
    }

    // HEL-700 tasks.md 3.5 (design.md D4/D7, assistant-tool-loop-telemetry spec's "A malformed
    // propose call is counted as a decode failure" scenario) — every one of the 5 SCRIPTED
    // transport responses is an unparseable propose_dashboard call (empty input — 'dashboardName'
    // is required); mirrors this file's own hop-cap-exhausted fixture. Per
    // ClaudeClient.sendWithTools's "thisHop > maxHops" guard, only the first 4 (maxHops, HEL-756)
    // are ever actually dispatched to AssistantToolExecutor — the 5th tool_use arrives but is never
    // executed.
    "a malformed propose_dashboard call is counted as a decode failure, and neither its input payload nor its error text ever reach the log line" in {
      val user    = newUser()
      val detail  = await(conversationService.create(user, None, title = None))
      val modelId = s"model-${UUID.randomUUID()}"
      val service = assistantServiceWith(new FakeTransport(toolUseResponse("t", "propose_dashboard")), modelId)

      JsonLogCapture.withCapture("com.helio.services.AssistantTelemetry") { read =>
        tracedPost(s"/assistant-conversations/${detail.record.id.value}/converse", """{"message":"Hello"}""") ~>
          tracedRoutesFor(user, Some(service)) ~> check {
            status shouldBe StatusCodes.OK
          }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("hopBudgetExhausted") shouldBe JsString("true")
          lines.head.fields("proposeAttempts") shouldBe JsString("4")
          lines.head.fields("proposeDecodeFailures") shouldBe JsString("4")
          lines.head.fields("proposeValidationFailures") shouldBe JsString("0")
        }

        // HEL-700 design.md D7 — only integer counts reach the log line, never the failing
        // tool_use.input payload or its deserialization error text.
        read() should not include "dashboardName"
        read() should not include "DeserializationException"
      }
    }
  }

  "POST /:id/converse failure telemetry" should {

    "a failed converse call (real Claude/transport failure) emits NO assistant_tool_loop_outcome line" in {
      val user    = newUser()
      val detail  = await(conversationService.create(user, None, title = None))
      val modelId = s"model-${UUID.randomUUID()}"
      val service = assistantServiceWith(new FakeTransport(Future.failed(ClaudeApiException(500, "internal server error"))), modelId)

      JsonLogCapture.withCapture("com.helio.services.AssistantTelemetry") { read =>
        tracedPost(s"/assistant-conversations/${detail.record.id.value}/converse", """{"message":"Hello"}""") ~>
          tracedRoutesFor(user, Some(service)) ~> check {
            status shouldBe StatusCodes.BadGateway
          }

        // Proving a NEGATIVE (nothing was emitted) can't use `eventually` -- that only proves a
        // line hadn't landed YET, not that it never will. `converseFlow`'s `Left(claudeError)`
        // branch structurally never calls `emitToolLoopOutcome` at all (no `Future` is ever
        // scheduled for this call), so a short settle delay is enough to catch a regression that
        // DID wire the call in, without the test being a real race.
        Thread.sleep(200)
        linesFor(read, modelId) shouldBe empty
      }
    }
  }
}
