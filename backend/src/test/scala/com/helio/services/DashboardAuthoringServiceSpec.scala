package com.helio.services

import com.helio.ai.{ClaudeApiContentBlock, ClaudeApiException, ClaudeApiRequest, ClaudeApiResponse, ClaudeApiUsage, ClaudeClient, ClaudeConfig, ClaudeError, ClaudeStreamEvent, ClaudeTransport}
import com.helio.api.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.{AuthoringStreamEvent, DashboardAuthoringRequest}
import com.helio.domain._
import com.helio.infrastructure._
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/** `DashboardAuthoringService` coverage (HEL-392 tasks.md 5.2/5.3) — a stub `ClaudeTransport`
 *  (zero real network calls, mirrors `ClaudeClientSpec`'s `FakeClaudeTransport`) over a REAL,
 *  embedded-Postgres-backed `WorkspaceContextService`/`PanelCapabilityService`/
 *  `DashboardProposalService` (the same "compose real services over a real DB, stub only the
 *  external boundary" shape `WorkspaceContextServiceSpec`/`PanelCapabilityServiceSpec` already
 *  use) — these three collaborators are `final class`es with no seam to Mockito-mock, so this is
 *  the natural, codebase-consistent way to exercise `DashboardAuthoringService` for real without
 *  ever touching the network.
 *
 *  5.3's streaming coverage (`Progress`/`Status`/terminal `Result`/`Error`) is folded in here per
 *  the task's own "(or folded into 5.2)" note. */
class DashboardAuthoringServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataSourceRepo: DataSourceRepository = _
  private var dataTypeRepo: DataTypeRepository     = _
  private var dataTypeRowRepo: DataTypeRowRepository = _

  private var workspaceContextService: WorkspaceContextService     = _
  private var panelCapabilityService: PanelCapabilityService       = _
  private var dashboardProposalService: DashboardProposalService   = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    implicit val ec: ExecutionContext = routeEc

    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dataSourceRepo   = new DataSourceRepository(ctx)
    dataTypeRepo     = new DataTypeRepository(ctx)
    dataTypeRowRepo  = new DataTypeRowRepository(ctx)
    val pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val dashboardRepo    = new DashboardRepository(ctx)

    val tmpDir = Files.createTempDirectory("helio-authoring-spec")
    val fs     = new LocalFileSystem(tmpDir)
    val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    val registry       = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val permissionRepo  = new ResourcePermissionRepository(ctx)
    val accessChecker   = new AccessCheckerImpl(permissionRepo, registry)
    val dashboardService = new DashboardService(dashboardRepo, accessChecker)

    workspaceContextService = new WorkspaceContextService(dashboardService, dataSourceService, dataTypeService, pipelineService)
    panelCapabilityService  = new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)
    // dashboardService/panelService are never touched by `.validate` (the only method
    // DashboardAuthoringService calls) — null, same rationale as
    // DashboardProposalServiceValidateSpec. metricRepo: null mirrors PanelService's
    // nullable-optional wiring convention (no proposal panel here ever carries a metricId).
    dashboardProposalService = new DashboardProposalService(null, null, dataTypeRepo, null)
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

  private def insertPipelineOutputType(owner: AuthenticatedUser, name: String = "Sales"): DataType = {
    implicit val ec: ExecutionContext = routeEc
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = name,
      fields    = Vector(DataField("revenue", "Revenue", "float", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner.id
    )
    await(dataTypeRepo.insert(dt, owner))
    dt
  }

  private def insertCompanionType(owner: AuthenticatedUser): DataType = {
    implicit val ec: ExecutionContext = routeEc
    val now    = Instant.now()
    val source = CsvSource(
      id        = DataSourceId(UUID.randomUUID().toString),
      name      = "Sales CSV",
      ownerId   = owner.id,
      createdAt = now,
      updatedAt = now,
      config    = CsvSourceConfig("csv/test.csv")
    )
    await(dataSourceRepo.insert(source, owner))
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = Some(source.id),
      name      = "Companion",
      fields    = Vector(DataField("revenue", "Revenue", "float", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner.id
    )
    await(dataTypeRepo.insert(dt, owner))
    dt
  }

  // ── Stub Claude transport (zero real network calls) ────────────────────

  private def cannedResponse(text: String): Future[ClaudeApiResponse] =
    Future.successful(ClaudeApiResponse(
      id         = "msg_test",
      content    = Seq(ClaudeApiContentBlock("text", Some(text))),
      stopReason = Some("end_turn"),
      usage      = ClaudeApiUsage(10, 10)
    ))

  /** Sequenced `send`/`stream` responses (one per invocation, in call order) — extends
   *  `ClaudeClientSpec`'s single-response `FakeClaudeTransport` to support MULTIPLE queued
   *  responses, since these tests exercise the repair round-trip (2 `send` invocations). Indexing
   *  past the end of either vector throws `IndexOutOfBoundsException`, which doubles as a hard
   *  assertion that a third attempt never happens. */
  private class FakeClaudeTransport(
      sendResponses: Vector[Future[ClaudeApiResponse]] = Vector.empty,
      streamResponses: Vector[Seq[ClaudeStreamEvent]] = Vector.empty
  ) extends ClaudeTransport {
    val sendInvocations   = new AtomicInteger(0)
    val streamInvocations = new AtomicInteger(0)

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] =
      sendResponses(sendInvocations.getAndIncrement())

    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] =
      Source(streamResponses(streamInvocations.getAndIncrement()).toList)
  }

  /** `maxInputTokens` defaults to a budget no real test prompt here approaches — task 7.1/7.3
   *  override it down to `1` to force `ClaudeClient`'s own pre-flight `GuardrailExceeded` rejection
   *  (a distinct code path from the empty-workspace short-circuit above: that one never reaches
   *  `ClaudeClient` at all, this one is rejected BY `ClaudeClient.send`/`stream` itself). */
  private def newAuthoringService(transport: FakeClaudeTransport, maxInputTokens: Int = 100000): DashboardAuthoringService = {
    val claudeConfig = ClaudeConfig(apiKey = "sk-ant-test", model = "claude-test", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = maxInputTokens)
    val claudeClient = new ClaudeClient(claudeConfig, transport)(routeEc)
    new DashboardAuthoringService(workspaceContextService, panelCapabilityService, dashboardProposalService, claudeClient)(routeEc)
  }

  // HEL-392 fold-in (tasks.md 7.1/7.2/7.3): drives `mapClaudeError`'s three branches end-to-end.
  private def apiErrorResponse(status: Int, body: String): Future[ClaudeApiResponse] =
    Future.failed(ClaudeApiException(status, body))

  private def transportFailureResponse(): Future[ClaudeApiResponse] =
    Future.failed(new RuntimeException("connection refused"))

  private val goal = "Show total revenue"

  private def validProposalJson(dataTypeId: String): String =
    s"""{"dashboardName":"Sales","panels":[{"title":"Total","type":"metric","dataTypeId":"$dataTypeId","fieldMapping":{"value":"revenue"}}]}"""

  // Well-formed JSON, but fails DashboardProposalService.validate's structural check (blank
  // dashboardName) — exercises the "parses fine, fails validate" repair trigger, not just a parse
  // failure.
  private val invalidProposalJson: String = """{"dashboardName":"","panels":[]}"""

  // ── author (buffered) ────────────────────────────────────────────────────

  "DashboardAuthoringService.author" should {

    "pass a valid first-attempt proposal through unchanged (1 invocation)" in {
      val user = newUser()
      val dt   = insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport(Vector(cannedResponse(validProposalJson(dt.id.value))))
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result.isRight shouldBe true
      result.map(_.proposal.dashboardName) shouldBe Right("Sales")
      transport.sendInvocations.get() shouldBe 1
    }

    "repair an invalid first attempt and succeed on the second (exactly 2 invocations)" in {
      val user = newUser()
      val dt   = insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport(Vector(
        cannedResponse(invalidProposalJson),
        cannedResponse(validProposalJson(dt.id.value))
      ))
      val service = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result.isRight shouldBe true
      transport.sendInvocations.get() shouldBe 2
    }

    "fail with 422 after two invalid attempts, never a third" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport(Vector(
        cannedResponse(invalidProposalJson),
        cannedResponse(invalidProposalJson)
      ))
      val service = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.UnprocessableEntity]
      transport.sendInvocations.get() shouldBe 2
    }

    "short-circuit to 422 for an empty workspace, with zero transport invocations" in {
      val user      = newUser() // zero pipeline-output DataTypes for this fresh user
      val transport = new FakeClaudeTransport()
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.UnprocessableEntity]
      transport.sendInvocations.get() shouldBe 0
      transport.streamInvocations.get() shouldBe 0
    }

    "reject a binding to a non-pipeline-output DataType identically to DashboardProposalService.apply's own rejection" in {
      val user      = newUser()
      insertPipelineOutputType(user) // keeps the workspace non-empty, so the empty-workspace short-circuit doesn't fire
      val companion = insertCompanionType(user)
      val badJson   = validProposalJson(companion.id.value)
      val transport = new FakeClaudeTransport(Vector(cannedResponse(badJson), cannedResponse(badJson)))
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result shouldBe a[Left[_, _]]
      val err = result.swap.toOption.get
      err shouldBe a[ServiceError.UnprocessableEntity]
      err.message.toLowerCase should include("pipeline-output")
      transport.sendInvocations.get() shouldBe 2
    }

    // HEL-392 fold-in (tasks.md 7.1) — closes the gap where spec.md's "over-budget goal... mapped
    // to 422" scenario existed but no test ever drove ClaudeClient's own GuardrailExceeded path
    // through DashboardAuthoringService (distinct from the empty-workspace short-circuit above,
    // which never reaches ClaudeClient at all).
    "map ClaudeClient's own GuardrailExceeded rejection to 422, with zero transport invocations" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport()
      val service   = newAuthoringService(transport, maxInputTokens = 1)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.UnprocessableEntity]
      transport.sendInvocations.get() shouldBe 0
    }

    // HEL-392 fold-in (tasks.md 7.2) — spec.md's new "Upstream Claude API/transport failures SHALL
    // surface as a Bad Gateway response" Requirement.
    "map a transport ApiError to 502 Bad Gateway" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport(Vector(apiErrorResponse(503, "upstream unavailable")))
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadGateway]
      transport.sendInvocations.get() shouldBe 1
    }

    "map a transport-level failure (TransportFailure) to 502 Bad Gateway" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport(Vector(transportFailureResponse()))
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadGateway]
      transport.sendInvocations.get() shouldBe 1
    }
  }

  // ── authorStreaming ────────────────────────────────────────────────────────

  "DashboardAuthoringService.authorStreaming" should {

    def terminalEvents(events: Seq[AuthoringStreamEvent]): Seq[AuthoringStreamEvent] =
      events.collect { case e @ (_: AuthoringStreamEvent.Result | _: AuthoringStreamEvent.Error) => e }

    "forward text deltas as Progress events, ending in exactly one terminal Result event" in {
      val user = newUser()
      val dt   = insertPipelineOutputType(user)
      val json = validProposalJson(dt.id.value)
      val deltas = Seq(
        ClaudeStreamEvent.TextDelta(json.take(json.length / 2)),
        ClaudeStreamEvent.TextDelta(json.drop(json.length / 2)),
        ClaudeStreamEvent.MessageStop
      )
      val transport = new FakeClaudeTransport(streamResponses = Vector(deltas))
      val service   = newAuthoringService(transport)

      val events = await(service.authorStreaming(DashboardAuthoringRequest(goal, None), user).runWith(Sink.seq))

      events.count(_.isInstanceOf[AuthoringStreamEvent.Progress]) shouldBe 2
      val terminal = terminalEvents(events)
      terminal should have size 1
      terminal.head shouldBe a[AuthoringStreamEvent.Result]
      transport.streamInvocations.get() shouldBe 1
      transport.sendInvocations.get() shouldBe 0
    }

    "emit a Status(repairing) event and end with exactly one terminal Result event when the first attempt needs repair" in {
      val user = newUser()
      val dt   = insertPipelineOutputType(user)
      val deltas    = Seq(ClaudeStreamEvent.TextDelta(invalidProposalJson), ClaudeStreamEvent.MessageStop)
      val transport = new FakeClaudeTransport(
        sendResponses   = Vector(cannedResponse(validProposalJson(dt.id.value))),
        streamResponses = Vector(deltas)
      )
      val service = newAuthoringService(transport)

      val events = await(service.authorStreaming(DashboardAuthoringRequest(goal, None), user).runWith(Sink.seq))

      events should contain(AuthoringStreamEvent.Status("repairing"))
      val terminal = terminalEvents(events)
      terminal should have size 1
      terminal.head shouldBe a[AuthoringStreamEvent.Result]
      transport.streamInvocations.get() shouldBe 1
      transport.sendInvocations.get() shouldBe 1
    }

    "end with exactly one terminal Error event when the repair attempt also fails, never a third attempt" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val deltas    = Seq(ClaudeStreamEvent.TextDelta(invalidProposalJson), ClaudeStreamEvent.MessageStop)
      val transport = new FakeClaudeTransport(
        sendResponses   = Vector(cannedResponse(invalidProposalJson)),
        streamResponses = Vector(deltas)
      )
      val service = newAuthoringService(transport)

      val events = await(service.authorStreaming(DashboardAuthoringRequest(goal, None), user).runWith(Sink.seq))

      val terminal = terminalEvents(events)
      terminal should have size 1
      terminal.head shouldBe a[AuthoringStreamEvent.Error]
      transport.streamInvocations.get() shouldBe 1
      transport.sendInvocations.get() shouldBe 1
    }

    "short-circuit to a single terminal Error event for an empty workspace, with zero transport invocations" in {
      val user      = newUser()
      val transport = new FakeClaudeTransport()
      val service   = newAuthoringService(transport)

      val events = await(service.authorStreaming(DashboardAuthoringRequest(goal, None), user).runWith(Sink.seq))

      events should have size 1
      events.head shouldBe a[AuthoringStreamEvent.Error]
      transport.sendInvocations.get() shouldBe 0
      transport.streamInvocations.get() shouldBe 0
    }

    // HEL-392 fold-in (tasks.md 7.3, mirrors 7.1) — GuardrailExceeded is rejected by
    // `ClaudeClient.stream` itself (`Source.single(Error(GuardrailExceeded))`, zero real
    // `transport.stream` invocations), a distinct path from the empty-workspace short-circuit
    // above.
    "map ClaudeClient's own GuardrailExceeded rejection to a single terminal Error event, with zero transport invocations" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport()
      val service   = newAuthoringService(transport, maxInputTokens = 1)

      val events = await(service.authorStreaming(DashboardAuthoringRequest(goal, None), user).runWith(Sink.seq))

      events should have size 1
      events.head shouldBe a[AuthoringStreamEvent.Error]
      transport.sendInvocations.get() shouldBe 0
      transport.streamInvocations.get() shouldBe 0
    }

    // HEL-392 fold-in (tasks.md 7.3, mirrors 7.2) — spec.md's new "streaming call's terminal error
    // event reflects the same mapping" Scenario: compares against the ACTUAL buffered-path message
    // (not a hand-duplicated format string), so this stays correct even if the mapping's wording
    // changes later.
    "map a mid-stream ApiError to a single terminal Error event carrying the same message the buffered path maps to" in {
      val user = newUser()
      insertPipelineOutputType(user)

      val bufferedResult = await(newAuthoringService(new FakeClaudeTransport(Vector(apiErrorResponse(503, "upstream unavailable"))))
        .author(DashboardAuthoringRequest(goal, None), user))
      val bufferedMessage = bufferedResult.swap.toOption.get.message

      val streamingTransport = new FakeClaudeTransport(
        streamResponses = Vector(Seq(ClaudeStreamEvent.Error(ClaudeError.ApiError(503, "upstream unavailable"))))
      )
      val events = await(newAuthoringService(streamingTransport).authorStreaming(DashboardAuthoringRequest(goal, None), user).runWith(Sink.seq))

      events should have size 1
      events.head shouldBe a[AuthoringStreamEvent.Error]
      events.head.asInstanceOf[AuthoringStreamEvent.Error].message shouldBe bufferedMessage
      streamingTransport.streamInvocations.get() shouldBe 1
      streamingTransport.sendInvocations.get() shouldBe 0
    }

    "map a mid-stream TransportFailure to a single terminal Error event carrying the same message the buffered path maps to" in {
      val user = newUser()
      insertPipelineOutputType(user)

      // ClaudeClient.send's catch-all always maps a non-ClaudeApiException failure to the FIXED
      // literal TransportFailure("Request failed") (see ClaudeClient.scala), regardless of the
      // original exception's own message — so the streamed fake event below uses that exact same
      // literal, making the "same mapped message" comparison meaningful rather than coincidental.
      val bufferedResult = await(newAuthoringService(new FakeClaudeTransport(Vector(transportFailureResponse())))
        .author(DashboardAuthoringRequest(goal, None), user))
      val bufferedMessage = bufferedResult.swap.toOption.get.message
      bufferedMessage shouldBe "Request failed"

      val streamingTransport = new FakeClaudeTransport(
        streamResponses = Vector(Seq(ClaudeStreamEvent.Error(ClaudeError.TransportFailure("Request failed"))))
      )
      val events = await(newAuthoringService(streamingTransport).authorStreaming(DashboardAuthoringRequest(goal, None), user).runWith(Sink.seq))

      events should have size 1
      events.head shouldBe a[AuthoringStreamEvent.Error]
      events.head.asInstanceOf[AuthoringStreamEvent.Error].message shouldBe bufferedMessage
      streamingTransport.streamInvocations.get() shouldBe 1
      streamingTransport.sendInvocations.get() shouldBe 0
    }
  }
}
