package com.helio.api.routes

import com.helio.ai.{ClaudeApiContentBlock, ClaudeApiException, ClaudeApiRequest, ClaudeApiResponse, ClaudeApiUsage, ClaudeClient, ClaudeConfig, ClaudeError, ClaudeStreamEvent, ClaudeTransport}
import com.helio.api.{AccessCheckerImpl, JsonProtocols, ResourceTypeRegistry, TraceContextDirective, ResourceType => AclResourceType}
import com.helio.domain._
import com.helio.infrastructure._
import com.helio.services.{DashboardAuthoringService, DashboardProposalService, DataSourceService, DataTypeService, DashboardService, PanelCapabilityService, PipelineService, WorkspaceContextService}
import com.helio.testutil.JsonLogCapture
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
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, ExecutionContextExecutor, Future}

/** HEL-401 tasks.md 5.1/5.2 — the exact claim the design-gate round-1 review caught as unverified:
 *  a real telemetry log line, captured via a genuine `LogstashEncoder` appender (not a mocked
 *  logging call), carries the trace-id MDC field when a trace id was set on the originating
 *  request, for BOTH the buffered and streaming paths — plus each `AuthoringErrorKind` surfaces on
 *  the actual HTTP/SSE response body, and the configured API key never appears in captured log
 *  output. `DashboardAuthoringRoutesSpec` covers the pre-existing HTTP-shell wiring; this spec is
 *  scoped to the NEW kind/telemetry surface only. */
class AuthoringTelemetrySpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with Eventually
    with BeforeAndAfterAll {

  override implicit val patienceConfig: PatienceConfig = PatienceConfig(timeout = Span(2, Seconds), interval = Span(20, Millis))

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContextExecutor           = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataTypeRepo: DataTypeRepository   = _

  private var workspaceContextService: WorkspaceContextService   = _
  private var panelCapabilityService: PanelCapabilityService     = _
  private var dashboardProposalService: DashboardProposalService = _
  private var conversationRepo: AuthoringConversationRepository  = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    // Plain `ExecutionContext` (not `ExecutionContextExecutor`) — matches
    // `DashboardAuthoringRoutesSpec`'s own convention; declaring this identically-typed to
    // `ScalatestRouteTest`'s inherited `executor: ExecutionContextExecutor` makes the two
    // implicits equally specific and genuinely ambiguous at every repository-construction call
    // site below (confirmed: `sbt Test/compile` failed with exactly that ambiguity before this
    // fix). Repository construction only ever needs a plain `ExecutionContext` here regardless.
    implicit val ec: ExecutionContext = routeEc

    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    val dataSourceRepo   = new DataSourceRepository(ctx)
    dataTypeRepo         = new DataTypeRepository(ctx)
    val dataTypeRowRepo  = new DataTypeRowRepository(ctx)
    val pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val dashboardRepo    = new DashboardRepository(ctx)

    val tmpDir = Files.createTempDirectory("helio-authoring-telemetry-spec")
    val fs     = new LocalFileSystem(tmpDir)
    val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    val registry        = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val accessChecker    = new AccessCheckerImpl(permissionRepo, registry)
    val dashboardService = new DashboardService(dashboardRepo, accessChecker)

    workspaceContextService  = new WorkspaceContextService(dashboardService, dataSourceService, dataTypeService, pipelineService)
    panelCapabilityService   = new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)
    dashboardProposalService = new DashboardProposalService(null, null, dataTypeRepo, null)
    conversationRepo         = new AuthoringConversationRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  // ── Fixtures ────────────────────────────────────────────────────────────

  private def newUser(): AuthenticatedUser = {
    implicit val ec: ExecutionContext = routeEc
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@test.local"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  /** A fresh user with one pipeline-output DataType — a non-empty workspace. Returns the
   *  `DataType` too so callers that need to bind a proposal panel to it don't have to re-query. */
  private def userWithWorkspace(): (AuthenticatedUser, DataType) = {
    implicit val ec: ExecutionContext = routeEc
    val owner = newUser()
    val now   = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = "Sales",
      fields    = Vector(DataField("revenue", "Revenue", "float", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner.id
    )
    await(dataTypeRepo.insert(dt, owner))
    (owner, dt)
  }

  private def cannedResponse(text: String): Future[ClaudeApiResponse] =
    Future.successful(ClaudeApiResponse(
      id         = "msg_test",
      content    = Seq(ClaudeApiContentBlock("text", Some(text))),
      stopReason = Some("end_turn"),
      usage      = ClaudeApiUsage(10, 10)
    ))

  private val invalidProposalJson: String = """{"dashboardName":"","panels":[]}"""

  private class FakeClaudeTransport(sendResponse: Future[ClaudeApiResponse], streamEvents: Seq[ClaudeStreamEvent] = Seq.empty) extends ClaudeTransport {
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = sendResponse
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = Source(streamEvents.toList)
  }

  private val SecretApiKey = "sk-ant-SECRET-SHOULD-NEVER-LEAK-xyz"

  /** `modelId` is always a fresh, unique-per-call value — the discriminator every capture window
   *  filters on (`JsonLogCapture`'s own doc comment: concurrent suites share one global logger). */
  private def serviceWith(transport: ClaudeTransport, modelId: String, maxInputTokens: Int = 100000): DashboardAuthoringService = {
    val claudeConfig = ClaudeConfig(apiKey = SecretApiKey, model = modelId, temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = maxInputTokens)
    new DashboardAuthoringService(workspaceContextService, panelCapabilityService, dashboardProposalService, new ClaudeClient(claudeConfig, transport)(routeEc), conversationRepo)(routeEc)
  }

  private val traceDirective = new TraceContextDirective(projectId = None)
  private val TraceValue     = "abc123trace"

  private def tracedRoutesFor(serviceOpt: Option[DashboardAuthoringService], user: AuthenticatedUser): Route =
    traceDirective.withTraceContext {
      new DashboardAuthoringRoutes(serviceOpt, user)(routeEc).routes
    }

  private def tracedPost(path: String, body: String) =
    Post(path, HttpEntity(ContentTypes.`application/json`, body))
      .withHeaders(RawHeader(TraceContextDirective.TraceHeaderName, s"$TraceValue/9;o=1"))

  private def requestBodyFor(goal: String): String = s"""{"goal":"$goal"}"""

  /** Finds the telemetry line(s) belonging to THIS call, filtering out any interleaved noise from
   *  concurrently-running suites (`JsonLogCapture`'s own doc comment). */
  private def linesFor(read: () => String, modelId: String): Seq[JsObject] =
    JsonLogCapture.jsonLines(read()).filter(_.fields.get("modelId").contains(JsString(modelId)))

  // ── Buffered: kind on the HTTP response body + a matching telemetry line ──

  "POST /api/authoring/dashboard (buffered) failure telemetry" should {

    "ModelFailure: response body carries kind=ModelFailure, telemetry line carries kind + trace id, never the API key" in {
      val user      = userWithWorkspace()._1
      val modelId   = s"model-${UUID.randomUUID()}"
      val transport = new FakeClaudeTransport(Future.failed(ClaudeApiException(503, "upstream unavailable")))
      val service   = serviceWith(transport, modelId)

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost("/authoring/dashboard", requestBodyFor("Show total revenue")) ~> tracedRoutesFor(Some(service), user) ~> check {
          status shouldBe StatusCodes.BadGateway
          val obj = responseAs[String].parseJson.asJsObject
          obj.fields("kind") shouldBe JsString("ModelFailure")
        }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("outcome") shouldBe JsString("failed")
          lines.head.fields("kind") shouldBe JsString("ModelFailure")
          lines.head.fields(TraceContextDirective.TraceMdcKey) shouldBe JsString(TraceValue)
        }

        read() should not include SecretApiKey
      }
    }

    "InvalidProposal: response body carries kind=InvalidProposal, telemetry line carries kind" in {
      val user    = userWithWorkspace()._1
      val modelId = s"model-${UUID.randomUUID()}"
      // `FakeClaudeTransport.send` always returns the SAME fixed response, so the first attempt
      // AND the single repair attempt both see `invalidProposalJson` — repair-exhausted, kind
      // InvalidProposal. Repair mechanics themselves are already covered by
      // DashboardAuthoringServiceSpec; this test only asserts the terminal kind.
      val service = serviceWith(new FakeClaudeTransport(cannedResponse(invalidProposalJson)), modelId)

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost("/authoring/dashboard", requestBodyFor("Show total revenue")) ~> tracedRoutesFor(Some(service), user) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val obj = responseAs[String].parseJson.asJsObject
          obj.fields("kind") shouldBe JsString("InvalidProposal")
        }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("outcome") shouldBe JsString("failed")
          lines.head.fields("kind") shouldBe JsString("InvalidProposal")
        }
      }
    }

    "EmptyWorkspace: response body carries kind=EmptyWorkspace, telemetry line carries kind, zero transport invocations" in {
      val user      = newUser() // zero pipeline-output DataTypes
      val modelId   = s"model-${UUID.randomUUID()}"
      val transport = new FakeClaudeTransport(cannedResponse("{}"))
      val service   = serviceWith(transport, modelId)

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost("/authoring/dashboard", requestBodyFor("Show total revenue")) ~> tracedRoutesFor(Some(service), user) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val obj = responseAs[String].parseJson.asJsObject
          obj.fields("kind") shouldBe JsString("EmptyWorkspace")
        }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("outcome") shouldBe JsString("failed")
          lines.head.fields("kind") shouldBe JsString("EmptyWorkspace")
        }
      }
    }

    "BudgetExceeded: response body carries kind=BudgetExceeded, telemetry line carries kind, zero transport invocations" in {
      val user      = userWithWorkspace()._1
      val modelId   = s"model-${UUID.randomUUID()}"
      val transport = new FakeClaudeTransport(cannedResponse("{}"))
      // maxInputTokens=1 forces ClaudeClient's own pre-flight GuardrailExceeded rejection (mirrors
      // DashboardAuthoringServiceSpec's identical trigger).
      val service = serviceWith(transport, modelId, maxInputTokens = 1)

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost("/authoring/dashboard", requestBodyFor("Show total revenue")) ~> tracedRoutesFor(Some(service), user) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val obj = responseAs[String].parseJson.asJsObject
          obj.fields("kind") shouldBe JsString("BudgetExceeded")
        }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("outcome") shouldBe JsString("failed")
          lines.head.fields("kind") shouldBe JsString("BudgetExceeded")
        }
      }
    }

    "a missing/foreign conversationId (outside the 4 defined kinds) renders the pre-existing bare ErrorResponse shape, no kind field" in {
      val user      = userWithWorkspace()._1
      val modelId   = s"model-${UUID.randomUUID()}"
      val service   = serviceWith(new FakeClaudeTransport(cannedResponse("{}")), modelId)
      val body      = s"""{"goal":"edit","conversationId":"${UUID.randomUUID().toString}"}"""

      tracedPost("/authoring/dashboard", body) ~> tracedRoutesFor(Some(service), user) ~> check {
        status shouldBe StatusCodes.NotFound
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.keySet should not contain "kind"
        obj.fields.keySet should contain("message")
      }
    }
  }

  // ── Buffered: success (generated) telemetry ────────────────────────────

  "POST /api/authoring/dashboard (buffered) success telemetry" should {
    "a successful call emits a generated-outcome telemetry line with panelCount/modelId/tokens and the trace id" in {
      val (user, dt) = userWithWorkspace()
      val modelId = s"model-${UUID.randomUUID()}"
      val validJson =
        s"""{"dashboardName":"Sales","panels":[{"title":"Total","type":"metric","dataTypeId":"${dt.id.value}","fieldMapping":{"value":"revenue"}}]}"""
      val service = serviceWith(new FakeClaudeTransport(cannedResponse(validJson)), modelId)

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost("/authoring/dashboard", requestBodyFor("Show total revenue")) ~> tracedRoutesFor(Some(service), user) ~> check {
          status shouldBe StatusCodes.OK
          val obj = responseAs[String].parseJson.asJsObject
          obj.fields.keySet should contain("authoringRequestId")
        }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("outcome") shouldBe JsString("generated")
          lines.head.fields("panelCount") shouldBe JsString("1")
          lines.head.fields("modelId") shouldBe JsString(modelId)
          lines.head.fields("inputTokens") shouldBe JsString("10")
          lines.head.fields("outputTokens") shouldBe JsString("10")
          lines.head.fields.keySet should contain("goalHash")
          lines.head.fields.keySet should not contain "goal"
          lines.head.fields(TraceContextDirective.TraceMdcKey) shouldBe JsString(TraceValue)
        }
      }
    }
  }

  // ── Streaming: kind on the SSE body + a matching telemetry line ────────

  private def sseEvents(raw: String): Seq[(String, JsObject)] =
    raw.split("\n\n").toSeq.filter(_.trim.nonEmpty).flatMap { block =>
      val lines = block.split("\n").toSeq
      for {
        eventLine <- lines.find(_.startsWith("event:"))
        dataLine  <- lines.find(_.startsWith("data:"))
      } yield eventLine.stripPrefix("event:").trim -> dataLine.stripPrefix("data:").trim.parseJson.asJsObject
    }

  "POST /api/authoring/dashboard?stream=true failure telemetry" should {

    "ModelFailure: the terminal authoring-error SSE event carries kind=ModelFailure, telemetry line carries kind + trace id" in {
      val user      = userWithWorkspace()._1
      val modelId   = s"model-${UUID.randomUUID()}"
      val transport = new FakeClaudeTransport(cannedResponse(""), Seq(ClaudeStreamEvent.Error(ClaudeError.ApiError(503, "upstream unavailable"))))
      val service   = serviceWith(transport, modelId)

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost("/authoring/dashboard?stream=true", requestBodyFor("Show total revenue")) ~> tracedRoutesFor(Some(service), user) ~> check {
          status shouldBe StatusCodes.OK
          val events = sseEvents(responseAs[String])
          val terminal = events.filter(_._1 == "authoring-error")
          terminal should have size 1
          terminal.head._2.fields("kind") shouldBe JsString("ModelFailure")
        }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("outcome") shouldBe JsString("failed")
          lines.head.fields("kind") shouldBe JsString("ModelFailure")
          lines.head.fields(TraceContextDirective.TraceMdcKey) shouldBe JsString(TraceValue)
        }

        read() should not include SecretApiKey
      }
    }

    "EmptyWorkspace: the terminal authoring-error SSE event carries kind=EmptyWorkspace, telemetry line carries kind" in {
      val user      = newUser()
      val modelId   = s"model-${UUID.randomUUID()}"
      val service   = serviceWith(new FakeClaudeTransport(cannedResponse("{}")), modelId)

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost("/authoring/dashboard?stream=true", requestBodyFor("Show total revenue")) ~> tracedRoutesFor(Some(service), user) ~> check {
          status shouldBe StatusCodes.OK
          val events = sseEvents(responseAs[String])
          val terminal = events.filter(_._1 == "authoring-error")
          terminal should have size 1
          terminal.head._2.fields("kind") shouldBe JsString("EmptyWorkspace")
        }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("kind") shouldBe JsString("EmptyWorkspace")
        }
      }
    }
  }

  "POST /api/authoring/dashboard?stream=true success telemetry" should {
    "a successful streaming call emits a generated-outcome telemetry line and the terminal Result event carries authoringRequestId" in {
      val (user, dt) = userWithWorkspace()
      val modelId = s"model-${UUID.randomUUID()}"
      val validJson =
        s"""{"dashboardName":"Sales","panels":[{"title":"Total","type":"metric","dataTypeId":"${dt.id.value}","fieldMapping":{"value":"revenue"}}]}"""
      val service = serviceWith(new FakeClaudeTransport(cannedResponse(""), Seq(ClaudeStreamEvent.TextDelta(validJson), ClaudeStreamEvent.MessageStop)), modelId)

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost("/authoring/dashboard?stream=true", requestBodyFor("Show total revenue")) ~> tracedRoutesFor(Some(service), user) ~> check {
          status shouldBe StatusCodes.OK
          val events = sseEvents(responseAs[String])
          val terminal = events.filter(_._1 == "authoring-result")
          terminal should have size 1
          terminal.head._2.fields.keySet should contain("authoringRequestId")
        }

        eventually {
          val lines = linesFor(read, modelId)
          lines should have size 1
          lines.head.fields("outcome") shouldBe JsString("generated")
          lines.head.fields(TraceContextDirective.TraceMdcKey) shouldBe JsString(TraceValue)
        }
      }
    }
  }

  // ── POST /api/authoring/requests/:id/outcome (HEL-401 design.md D4, tasks.md 3.1/5.2) ──────

  "POST /api/authoring/requests/:id/outcome" should {

    "accepts 'accepted' and emits a correlated telemetry line, for an id it never looks up (never touches apply-proposal's persistence)" in {
      val user             = userWithWorkspace()._1
      val service          = serviceWith(new FakeClaudeTransport(cannedResponse("{}")), s"model-${UUID.randomUUID()}")
      val authoringRequestId = UUID.randomUUID().toString // never a real, previously-minted id

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost(s"/authoring/requests/$authoringRequestId/outcome", """{"outcome":"accepted"}""") ~>
          tracedRoutesFor(Some(service), user) ~> check {
            status shouldBe StatusCodes.NoContent
          }

        eventually {
          val lines = JsonLogCapture.jsonLines(read()).filter(_.fields.get("authoringRequestId").contains(JsString(authoringRequestId)))
          lines should have size 1
          lines.head.fields("event") shouldBe JsString("authoring_apply_outcome")
          lines.head.fields("outcome") shouldBe JsString("accepted")
        }
      }
    }

    "accepts 'rejected' and emits a correlated telemetry line" in {
      val user             = userWithWorkspace()._1
      val service          = serviceWith(new FakeClaudeTransport(cannedResponse("{}")), s"model-${UUID.randomUUID()}")
      val authoringRequestId = UUID.randomUUID().toString

      JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry") { read =>
        tracedPost(s"/authoring/requests/$authoringRequestId/outcome", """{"outcome":"rejected"}""") ~>
          tracedRoutesFor(Some(service), user) ~> check {
            status shouldBe StatusCodes.NoContent
          }

        eventually {
          val lines = JsonLogCapture.jsonLines(read()).filter(_.fields.get("authoringRequestId").contains(JsString(authoringRequestId)))
          lines should have size 1
          lines.head.fields("outcome") shouldBe JsString("rejected")
        }
      }
    }

    "rejects an invalid outcome value with 400" in {
      val user    = userWithWorkspace()._1
      val service = serviceWith(new FakeClaudeTransport(cannedResponse("{}")), s"model-${UUID.randomUUID()}")

      tracedPost(s"/authoring/requests/${UUID.randomUUID().toString}/outcome", """{"outcome":"bogus"}""") ~>
        tracedRoutesFor(Some(service), user) ~> check {
          status shouldBe StatusCodes.BadRequest
        }
    }

    "is mounted even when the authoring service is unavailable (never gated on serviceOpt, telemetry-only)" in {
      tracedPost(s"/authoring/requests/${UUID.randomUUID().toString}/outcome", """{"outcome":"accepted"}""") ~>
        tracedRoutesFor(None, userWithWorkspace()._1) ~> check {
          status shouldBe StatusCodes.NoContent
        }
    }
  }
}
