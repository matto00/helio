package com.helio.services.proposals


import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.pipelines.PipelineService
import com.helio.services.proposals.{AuthoringHistoryBudget, DashboardAuthoringService, DashboardProposalService}
import com.helio.services.sources.DataSourceService
import com.helio.services.workspace.WorkspaceContextService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.ai.{ClaudeApiContentBlock, ClaudeApiException, ClaudeApiRequest, ClaudeApiResponse, ClaudeApiUsage, ClaudeClient, ClaudeConfig, ClaudeError, ClaudeMessage, ClaudeRole, ClaudeStreamEvent, ClaudeTransport}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.proposals.{AuthoringDisplayTurn, AuthoringStreamEvent, DashboardAuthoringRequest, DashboardProposal}
import com.helio.api.protocols.patchsets.PatchSet
import com.helio.domain.model._
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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, ExecutionContextExecutor, Future}
import scala.jdk.CollectionConverters._

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
  // HEL-401 design.md D3: `DashboardAuthoringService`'s own `ec` is `ExecutionContextExecutor`
  // (not the plain `ExecutionContext` this file used pre-ticket) so it can build a
  // `MdcPropagatingExecutionContext(ec, ...)` for telemetry — `ActorSystem[_].executionContext`
  // already IS an `ExecutionContextExecutor` at runtime; this is a compile-time-only type-signature
  // widening (skeptic-flagged minor detail), not a behavior change.
  private def routeEc: ExecutionContextExecutor           = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataSourceRepo: DataSourceRepository = _
  private var outputRepo: OutputRepository = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _

  private var workspaceContextService: WorkspaceContextService     = _
  private var panelCapabilityService: PanelCapabilityService       = _
  private var dashboardProposalService: DashboardProposalService   = _
  // HEL-397: real repository over the same embedded Postgres — DashboardAuthoringService now
  // unconditionally persists a conversation row on every successful turn (transparent side effect
  // for single-shot callers, design.md D1), so every test below needs a working collaborator here,
  // not a mock.
  private var conversationRepo: AuthoringConversationRepository    = _

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
    outputRepo       = new OutputRepository(ctx)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val dashboardRepo    = new DashboardRepository(ctx)

    val tmpDir = Files.createTempDirectory("helio-authoring-spec")
    val fs     = new LocalFileSystem(tmpDir)
    val dataSourceService = new DataSourceService(dataSourceRepo, fs)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)

    val registry       = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val permissionRepo  = new ResourcePermissionRepository(ctx)
    val accessChecker   = new AccessCheckerImpl(permissionRepo, registry)
    val dashboardService = new DashboardService(dashboardRepo, accessChecker)

    workspaceContextService = new WorkspaceContextService(dashboardService, dataSourceService, outputRepo, pipelineService)
    panelCapabilityService  = new PanelCapabilityService(outputRepo, nodeSnapshotRepo)
    // dashboardService/panelService are never touched by `.validate` (the only method
    // DashboardAuthoringService calls) — null, same rationale as
    // DashboardProposalServiceValidateSpec. metricRepo: null mirrors PanelService's
    // nullable-optional wiring convention (no proposal panel here ever carries a metricId).
    dashboardProposalService = new DashboardProposalService(null, null, outputRepo)
    conversationRepo         = new AuthoringConversationRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }


  private def newUser(): AuthenticatedUser = {
    implicit val ec: ExecutionContext = routeEc
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@test.local"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  // HEL-904 task 3.8/3.9: an "output"-kind panel's `validProposalJson` binding
  // now validates against a real Output (OutputRepository), not a DataType —
  // this helper additively seeds a pipeline + real Output REUSING the
  // DataType's own id string as the Output's id (`outputs.id` is an
  // independent TEXT PK, no FK to `data_types`, so this is a legitimate
  // reuse, not a collision) so every existing `insertPipelineOutputType`/
  // `validProposalJson(dt.id.value)` call site keeps working unmodified —
  // the DataType itself still exists too, for the workspace-non-emptiness
  // short-circuit callers that only need a DataType to be present.
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
    val srcId = UUID.randomUUID().toString
    val pipelineId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($srcId::uuid, 'authoring-spec-src', 'static', '{}'::jsonb, ${owner.id.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, owner_id, created_at, updated_at)
             VALUES ($pipelineId, $name, $srcId::uuid, ${owner.id.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, schema, position, created_at, updated_at)
             VALUES (${dt.id.value}, $pipelineId, NULL, ${owner.id.value}::uuid, $name, 'table', '{}'::jsonb, '[]'::jsonb, 0, now(), now())"""
    )))
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
    // HEL-904 task 2.10: no insert at all -- this fixture only needs `dt.id`
    // to be a syntactically valid, genuinely nonexistent id (the test's own
    // point, per the describe-block comment above); nothing downstream ever
    // reads a persisted row for it.
    dt
  }


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
    // HEL-397 tasks.md 6.1: records every `send` request's messages so history-trimming tests can
    // assert on exactly what reached the transport, not just how many times.
    private val recordedRequests = new CopyOnWriteArrayList[ClaudeApiRequest]()
    def sendRequests: Vector[ClaudeApiRequest] = recordedRequests.asScala.toVector

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = {
      recordedRequests.add(request)
      sendResponses(sendInvocations.getAndIncrement())
    }

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
    new DashboardAuthoringService(workspaceContextService, panelCapabilityService, dashboardProposalService, claudeClient, conversationRepo)(routeEc)
  }

  // HEL-392 fold-in (tasks.md 7.1/7.2/7.3): drives `mapClaudeError`'s three branches end-to-end.
  private def apiErrorResponse(status: Int, body: String): Future[ClaudeApiResponse] =
    Future.failed(ClaudeApiException(status, body))

  private def transportFailureResponse(): Future[ClaudeApiResponse] =
    Future.failed(new RuntimeException("connection refused"))

  private val goal = "Show total revenue"

  private def validProposalJson(dataTypeId: String): String =
    s"""{"dashboardName":"Sales","panels":[{"title":"Total","type":"output","dataTypeId":"$dataTypeId","fieldMapping":{"value":"revenue"}}]}"""

  // Well-formed JSON, but fails DashboardProposalService.validate's structural check (blank
  // dashboardName) — exercises the "parses fine, fails validate" repair trigger, not just a parse
  // failure.
  private val invalidProposalJson: String = """{"dashboardName":"","panels":[]}"""


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
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.UnprocessableEntity]
      transport.sendInvocations.get() shouldBe 2
    }

    "short-circuit to 422 for an empty workspace, with zero transport invocations" in {
      val user      = newUser() // zero pipeline-output DataTypes for this fresh user
      val transport = new FakeClaudeTransport()
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.UnprocessableEntity]
      transport.sendInvocations.get() shouldBe 0
      transport.streamInvocations.get() shouldBe 0
    }

    // HEL-904 task 3.8/3.9: an "output"-kind panel's binding now validates
    // against a real Output, not a DataType — `insertCompanionType` mints a
    // DataType only, never an Output, so it's an ordinary not-found now
    // (there is no "companion" concept for Outputs).
    "reject a binding to a nonexistent Output identically to DashboardProposalService.apply's own rejection" in {
      val user      = newUser()
      insertPipelineOutputType(user) // keeps the workspace non-empty, so the empty-workspace short-circuit doesn't fire
      val companion = insertCompanionType(user)
      val badJson   = validProposalJson(companion.id.value)
      val transport = new FakeClaudeTransport(Vector(cannedResponse(badJson), cannedResponse(badJson)))
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result shouldBe a[Left[_, _]]
      val err = result.swap.toOption.get.serviceError
      err shouldBe a[ServiceError.UnprocessableEntity]
      err.message.toLowerCase should include("not found")
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
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.UnprocessableEntity]
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
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.BadGateway]
      transport.sendInvocations.get() shouldBe 1
    }

    "map a transport-level failure (TransportFailure) to 502 Bad Gateway" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport(Vector(transportFailureResponse()))
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest(goal, None), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.BadGateway]
      transport.sendInvocations.get() shouldBe 1
    }
  }


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
      val bufferedMessage = bufferedResult.swap.toOption.get.serviceError.message

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
      val bufferedMessage = bufferedResult.swap.toOption.get.serviceError.message
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


  private def seedConversation(
      owner: AuthenticatedUser,
      apiHistory: Vector[ClaudeMessage] = Vector(ClaudeMessage(ClaudeRole.User, "seed"), ClaudeMessage(ClaudeRole.Assistant, "seed-response")),
      totalTokensUsed: Int = 0
  ): AuthoringConversationRepository.AuthoringConversationRecord = {
    val now = Instant.now()
    val record = AuthoringConversationRepository.AuthoringConversationRecord(
      id              = AuthoringConversationId(UUID.randomUUID().toString),
      ownerId         = owner.id,
      apiHistory      = apiHistory,
      displayTurns    = Vector(AuthoringDisplayTurn("user", "seed"), AuthoringDisplayTurn("assistant", "seed-response")),
      latestProposal  = Some(DashboardProposal("Seed", Vector.empty)),
      latestPatchSet  = None,
      totalTokensUsed = totalTokensUsed,
      createdAt       = now,
      updatedAt       = now
    )
    await(conversationRepo.create(record))
    record
  }

  "DashboardAuthoringService — multi-turn conversations" should {

    "a second turn with conversationId edits the first turn's proposal, re-validated, and the persisted turn count increases" in {
      val user = newUser()
      val dt   = insertPipelineOutputType(user)
      val turn2Json = s"""{"dashboardName":"Sales v2","panels":[{"title":"Total","type":"output","dataTypeId":"${dt.id.value}","fieldMapping":{"value":"revenue"}}]}"""
      val transport = new FakeClaudeTransport(Vector(cannedResponse(validProposalJson(dt.id.value)), cannedResponse(turn2Json)))
      val service   = newAuthoringService(transport)

      val turn1 = await(service.author(DashboardAuthoringRequest(goal, None), user))
      turn1.isRight shouldBe true
      val conversationId = turn1.toOption.get.conversationId
      conversationId should not be empty

      val turn2 = await(service.author(DashboardAuthoringRequest("Rename it to Sales v2", None, Some(conversationId)), user))

      turn2.isRight shouldBe true
      turn2.map(_.proposal.dashboardName) shouldBe Right("Sales v2")
      turn2.map(_.conversationId) shouldBe Right(conversationId)
      transport.sendInvocations.get() shouldBe 2

      val persisted = await(conversationRepo.findById(AuthoringConversationId(conversationId), user))
      persisted shouldBe defined
      persisted.get.displayTurns should have size 4
      persisted.get.apiHistory   should have size 4
      persisted.get.latestProposal.map(_.dashboardName) shouldBe Some("Sales v2")
    }

    "a continued turn's Claude request carries only the plain follow-up text, never re-embedded grounding" in {
      val user = newUser()
      val dt   = insertPipelineOutputType(user)
      val turn2Json = validProposalJson(dt.id.value)
      val transport = new FakeClaudeTransport(Vector(cannedResponse(validProposalJson(dt.id.value)), cannedResponse(turn2Json)))
      val service   = newAuthoringService(transport)

      val turn1 = await(service.author(DashboardAuthoringRequest(goal, None), user))
      val conversationId = turn1.toOption.get.conversationId

      await(service.author(DashboardAuthoringRequest("Make it a bar chart", None, Some(conversationId)), user))

      val turn2Request = transport.sendRequests(1)
      val turn2UserMessages = turn2Request.messages.filter(_.role == ClaudeRole.User)
      // Turn 1's own ORIGINAL grounded message legitimately remains part of history and is
      // correctly resent as prior context (that's how a continued conversation works) — the
      // design.md D3 guarantee is narrower: THIS turn's own new message is the plain follow-up
      // text only, never re-embedded grounding on top of it.
      turn2UserMessages.last.content shouldBe "Make it a bar chart"
      turn2Request.messages.count(_.role == ClaudeRole.User) shouldBe 2
    }

    "history-budget trimming: the transport only ever sees the trimmed subset, never the dropped oldest pair" in {
      val user = newUser()
      val dt   = insertPipelineOutputType(user)

      // One deliberately oversized turn-pair (alone comfortably exceeds DefaultMaxHistoryTokens)
      // followed by a small, recent pair — trimming must drop the oldest and keep the newest.
      val oldestPad = "filler " * 30000
      val seeded = seedConversation(
        user,
        apiHistory = Vector(
          ClaudeMessage(ClaudeRole.User, "OLDEST-TURN-MARKER " + oldestPad),
          ClaudeMessage(ClaudeRole.Assistant, "OLDEST-RESPONSE-MARKER"),
          ClaudeMessage(ClaudeRole.User, "NEWEST-TURN-MARKER"),
          ClaudeMessage(ClaudeRole.Assistant, "NEWEST-RESPONSE-MARKER")
        )
      )

      val transport = new FakeClaudeTransport(Vector(cannedResponse(validProposalJson(dt.id.value))))
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest("one more edit", None, Some(seeded.id.value)), user))

      result.isRight shouldBe true
      val sentMessages = transport.sendRequests.head.messages
      sentMessages.exists(_.content.contains("OLDEST-TURN-MARKER")) shouldBe false
      sentMessages.exists(_.content.contains("OLDEST-RESPONSE-MARKER")) shouldBe false
      sentMessages.exists(_.content.contains("NEWEST-TURN-MARKER")) shouldBe true
      sentMessages.exists(_.content.contains("NEWEST-RESPONSE-MARKER")) shouldBe true
      sentMessages.last.content shouldBe "one more edit"

      // Storage itself is never permanently truncated — the FULL prior history is still there,
      // trimming only ever applied per-call (design.md D4).
      val persisted = await(conversationRepo.findById(seeded.id, user))
      persisted.get.apiHistory.exists(_.content.contains("OLDEST-TURN-MARKER")) shouldBe true
    }

    "an exhausted conversation rejects its next turn with 422 before any Claude call" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val seeded = seedConversation(user, totalTokensUsed = AuthoringHistoryBudget.DefaultMaxConversationTokens)

      val transport = new FakeClaudeTransport()
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest("one more edit", None, Some(seeded.id.value)), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.UnprocessableEntity]
      transport.sendInvocations.get() shouldBe 0
    }

    "a missing conversationId is rejected as NotFound, with zero transport invocations" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport()
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest("edit", None, Some(UUID.randomUUID().toString)), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.NotFound]
      transport.sendInvocations.get() shouldBe 0
    }

    "a conversationId owned by a different user is rejected as NotFound, never continued" in {
      val ownerA = newUser()
      val ownerB = newUser()
      insertPipelineOutputType(ownerB)
      val seeded = seedConversation(ownerA)

      val transport = new FakeClaudeTransport()
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest("hijack", None, Some(seeded.id.value)), ownerB))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.NotFound]
      transport.sendInvocations.get() shouldBe 0
    }

    // HEL-411 design.md D3a (tasks.md 5.4) — the symmetric counterpart of
    // RefinementServiceSpec's own cross-flow test: a REFINEMENT conversation's id (latestProposal
    // empty, latestPatchSet populated) must be rejected the SAME "not found" shape an owner
    // mismatch gets when passed to `POST /api/authoring/dashboard`'s own continuation path, and
    // MUST NOT silently reassign that row's latestProposal column via appendTurn's unconditional
    // overwrite.
    "a refinement conversationId passed to authoring continuation is rejected as NotFound, and leaves its latestPatchSet completely unchanged" in {
      val user = newUser()
      insertPipelineOutputType(user)
      val originalPatchSet = PatchSet(Some("Seed refinement"), Vector.empty)
      val now = Instant.now()
      val refinementRecord = AuthoringConversationRepository.AuthoringConversationRecord(
        id              = AuthoringConversationId(UUID.randomUUID().toString),
        ownerId         = user.id,
        apiHistory      = Vector.empty,
        displayTurns    = Vector(AuthoringDisplayTurn("user", "seed")),
        latestProposal  = None,
        latestPatchSet  = Some(originalPatchSet),
        totalTokensUsed = 0,
        createdAt       = now,
        updatedAt       = now
      )
      await(conversationRepo.create(refinementRecord))

      val transport = new FakeClaudeTransport()
      val service   = newAuthoringService(transport)

      val result = await(service.author(DashboardAuthoringRequest("hijack", None, Some(refinementRecord.id.value)), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.NotFound]
      transport.sendInvocations.get() shouldBe 0

      val stillThere = await(conversationRepo.findById(refinementRecord.id, user))
      stillThere shouldBe defined
      stillThere.get.latestPatchSet shouldBe Some(originalPatchSet)
      stillThere.get.latestProposal shouldBe empty
    }

    "authorStreaming with conversationId continues the conversation and the terminal Result event carries the same conversationId" in {
      val user = newUser()
      val dt   = insertPipelineOutputType(user)
      val turn1Json = validProposalJson(dt.id.value)
      val turn2Json = s"""{"dashboardName":"Sales v2","panels":[]}"""
      val turn1Transport = new FakeClaudeTransport(streamResponses = Vector(Seq(ClaudeStreamEvent.TextDelta(turn1Json), ClaudeStreamEvent.MessageStop)))
      val turn1Service   = newAuthoringService(turn1Transport)
      val turn1Events    = await(turn1Service.authorStreaming(DashboardAuthoringRequest(goal, None), user).runWith(Sink.seq))
      val conversationId = turn1Events.collect { case r: AuthoringStreamEvent.Result => r.conversationId }.head

      val turn2Transport = new FakeClaudeTransport(streamResponses = Vector(Seq(ClaudeStreamEvent.TextDelta(turn2Json), ClaudeStreamEvent.MessageStop)))
      val turn2Service   = newAuthoringService(turn2Transport)
      val turn2Events    = await(turn2Service.authorStreaming(DashboardAuthoringRequest("edit", None, Some(conversationId)), user).runWith(Sink.seq))

      val terminal = turn2Events.collect { case r: AuthoringStreamEvent.Result => r }
      terminal should have size 1
      terminal.head.conversationId shouldBe conversationId
      terminal.head.proposal.dashboardName shouldBe "Sales v2"
    }

    "getConversation returns displayTurns/latestProposal for the owner and never leaks to a different user" in {
      val user  = newUser()
      val other = newUser()
      val dt    = insertPipelineOutputType(user)
      val transport = new FakeClaudeTransport(Vector(cannedResponse(validProposalJson(dt.id.value))))
      val service   = newAuthoringService(transport)

      val turn1 = await(service.author(DashboardAuthoringRequest(goal, None), user))
      val conversationId = turn1.toOption.get.conversationId

      val ownerView = await(service.getConversation(AuthoringConversationId(conversationId), user))
      ownerView.isRight shouldBe true
      val view = ownerView.toOption.get
      view.conversationId shouldBe conversationId
      view.displayTurns should have size 2
      view.displayTurns.head.role shouldBe "user"
      view.displayTurns.head.text shouldBe goal
      view.displayTurns.last.role shouldBe "assistant"
      view.latestProposal.map(_.dashboardName) shouldBe Some("Sales")

      val otherView = await(service.getConversation(AuthoringConversationId(conversationId), other))
      otherView shouldBe a[Left[_, _]]
      otherView.swap.toOption.get shouldBe a[ServiceError.NotFound]
    }
  }
}
