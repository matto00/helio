package com.helio.services.patchsets


import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.patchsets.{PatchSetPreviewService, RefinementGrounding, RefinementService}
import com.helio.services.pipelines.PipelineService
import com.helio.services.workspace.WorkspaceContextService
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.ai.{ClaudeApiContentBlock, ClaudeApiRequest, ClaudeApiResponse, ClaudeApiUsage, ClaudeClient, ClaudeConfig, ClaudeStreamEvent, ClaudeTransport}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.proposals.{AuthoringDisplayTurn, DashboardProposal}
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineStepRequest}
import com.helio.api.protocols.patchsets.{RefinementRequest, RefinementTarget}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.scaladsl.Source
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsObject, JsString}

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, ExecutionContextExecutor, Future}
import scala.jdk.CollectionConverters._

/** `RefinementService` coverage (HEL-411 tasks.md 5.1) — mirrors `DashboardAuthoringServiceSpec`'s
 *  "stub `ClaudeTransport` over a REAL, embedded-Postgres-backed set of services" shape (the same
 *  simplified `DbContext(db, db)` pattern — none of `RefinementGrounding`'s own reads are
 *  RLS-dependent raw SQL, so the dual-pool harness `PatchSetPreviewServiceSpec` uses isn't needed
 *  here either). */
class RefinementServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContextExecutor = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

  private var dashboardRepo: DashboardRepository       = _
  private var panelRepo: PanelRepository               = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _

  private var dashboardService: DashboardService = _
  private var panelService: PanelService         = _
  private var dataSourceService: DataSourceService = _
  private var pipelineService: PipelineService     = _
  private var patchSetPreviewService: PatchSetPreviewService = _
  private var refinementGrounding: RefinementGrounding       = _
  private var conversationRepo: AuthoringConversationRepository = _

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

    dashboardRepo    = new DashboardRepository(ctx)
    panelRepo         = new PanelRepository(ctx)
    dataSourceRepo    = new DataSourceRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo  = new PipelineStepRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val permissionRepo = new ResourcePermissionRepository(ctx)
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val tmpDir = Files.createTempDirectory("helio-refinement-spec")
    val fs     = new LocalFileSystem(tmpDir)

    dashboardService   = new DashboardService(dashboardRepo, accessChecker)
    panelService        = new PanelService(panelRepo, accessChecker, dashboardRepo)
    dataSourceService   = new DataSourceService(dataSourceRepo, fs)
    // HEL-904 task 3.12/4.1: WorkspaceContextService takes OutputRepository now (dataTypeService
    // no longer exists).
    val outputRepo     = new OutputRepository(ctx)
    val nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    pipelineService      = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)

    val workspaceContextService = new WorkspaceContextService(dashboardService, dataSourceService, outputRepo, pipelineService)
    val panelCapabilityService  = new PanelCapabilityService(outputRepo, nodeSnapshotRepo)
    patchSetPreviewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker
    )
    refinementGrounding = new RefinementGrounding(dashboardRepo, panelRepo, pipelineService, workspaceContextService, panelCapabilityService)
    conversationRepo = new AuthoringConversationRepository(ctx)
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

  private def createDashboardFor(owner: AuthenticatedUser): Dashboard =
    await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash")), owner))._1

  private def createPanelFor(dashboardId: DashboardId, owner: AuthenticatedUser, title: String = "Original title"): Panel =
    await(panelService.create(CreatePanelRequest(Some(dashboardId.value), Some(title), Some("divider"), None), owner)) match {
      case Right((p, _)) => p
      case Left(e)  => fail(s"createPanelFor failed: $e")
    }

  private def createSourceAndPipeline(owner: AuthenticatedUser): PipelineId = {
    val req = StaticDataSourceRequest(
      name    = s"src-${UUID.randomUUID()}",
      `type`  = "static",
      columns = Vector(StaticColumnPayload("value", "string")),
      rows    = Vector(Vector(JsString("x")))
    )
    val ds = await(dataSourceService.createStatic(req, owner)) match {
      case Right(d) => d
      case Left(e)  => fail(s"createStatic failed: $e")
    }
    val summary = await(pipelineService.create(CreatePipelineRequest(s"pipe-${UUID.randomUUID()}", ds.id.value), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"pipeline create failed: $e")
    }
    PipelineId(summary.id)
  }

  private def addRenameStep(pipelineId: PipelineId, owner: AuthenticatedUser, from: String, to: String): String =
    await(pipelineService.addStep(pipelineId, CreatePipelineStepRequest("rename", JsObject("renames" -> JsObject(from -> JsString(to)))), owner)) match {
      case Right(s) => s.id
      case Left(e)  => fail(s"addStep failed: $e")
    }

  // ── Stub Claude transport (zero real network calls) — mirrors
  //    DashboardAuthoringServiceSpec's own FakeClaudeTransport verbatim. ─────

  private def cannedResponse(text: String): Future[ClaudeApiResponse] =
    Future.successful(ClaudeApiResponse(
      id         = "msg_test",
      content    = Seq(ClaudeApiContentBlock("text", Some(text))),
      stopReason = Some("end_turn"),
      usage      = ClaudeApiUsage(10, 10)
    ))

  private class FakeClaudeTransport(sendResponses: Vector[Future[ClaudeApiResponse]] = Vector.empty) extends ClaudeTransport {
    val sendInvocations = new AtomicInteger(0)
    private val recordedRequests = new CopyOnWriteArrayList[ClaudeApiRequest]()
    def sendRequests: Vector[ClaudeApiRequest] = recordedRequests.asScala.toVector

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = {
      recordedRequests.add(request)
      sendResponses(sendInvocations.getAndIncrement())
    }

    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] =
      throw new UnsupportedOperationException("RefinementService never streams")
  }

  private def newRefinementService(transport: FakeClaudeTransport, maxInputTokens: Int = 100000): RefinementService = {
    val claudeConfig = ClaudeConfig(apiKey = "sk-ant-test", model = "claude-test", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = maxInputTokens)
    val claudeClient = new ClaudeClient(claudeConfig, transport)(routeEc)
    new RefinementService(refinementGrounding, patchSetPreviewService, claudeClient, conversationRepo)(routeEc)
  }

  private def panelUpdateJson(panelId: String, title: String, summary: String = "Rename panel"): String =
    s"""{"summary":"$summary","edits":[{"target":{"kind":"panel","id":"$panelId"},"op":"update","patch":{"title":"$title"}}]}"""

  private def pipelineUpdateJson(pipelineId: String, name: String): String =
    s"""{"summary":"Rename pipeline","edits":[{"target":{"kind":"pipeline","id":"$pipelineId"},"op":"update","patch":{"name":"$name"}}]}"""


  "RefinementService.refine — dashboard target" should {

    "ground Claude in the dashboard's real current panels and return a preview-clean, persisted PatchSet" in {
      val user  = newUser()
      val dash  = createDashboardFor(user)
      val panel = createPanelFor(dash.id, user)

      val transport = new FakeClaudeTransport(Vector(cannedResponse(panelUpdateJson(panel.id.value, "New title"))))
      val service   = newRefinementService(transport)

      val request = RefinementRequest(RefinementTarget("dashboard", dash.id.value), "rename the panel")
      val result  = await(service.refine(request, user))

      result.isRight shouldBe true
      val response = result.toOption.get
      response.patchSet.edits should have size 1
      response.patchSet.edits.head.target.id shouldBe Some(panel.id.value)
      transport.sendInvocations.get() shouldBe 1

      // Grounding reflects the real panel id + title, not a stale/fabricated one (AC5/spec.md).
      val sentPrompt = transport.sendRequests.head.messages.head.content
      sentPrompt should include(panel.id.value)
      sentPrompt should include("Original title")

      // spec.md "A successful response is preview-clean": preview must accept it verbatim.
      val preview = await(patchSetPreviewService.preview(response.patchSet, user))
      preview.isRight shouldBe true

      val persisted = await(conversationRepo.findById(AuthoringConversationId(response.conversationId), user))
      persisted shouldBe defined
      persisted.get.latestPatchSet shouldBe defined
      persisted.get.latestProposal shouldBe empty
    }

    "reject a nonexistent dashboard target before any Claude call" in {
      val user      = newUser()
      val transport = new FakeClaudeTransport()
      val service   = newRefinementService(transport)

      val request = RefinementRequest(RefinementTarget("dashboard", UUID.randomUUID().toString), "do something")
      val result  = await(service.refine(request, user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.NotFound]
      transport.sendInvocations.get() shouldBe 0
    }

    "reject a dashboard target owned by a different, non-sharing user before any Claude call" in {
      val owner     = newUser()
      val stranger  = newUser()
      val dash      = createDashboardFor(owner)
      val transport = new FakeClaudeTransport()
      val service   = newRefinementService(transport)

      val request = RefinementRequest(RefinementTarget("dashboard", dash.id.value), "do something")
      val result  = await(service.refine(request, stranger))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.NotFound]
      transport.sendInvocations.get() shouldBe 0
    }
  }


  "RefinementService.refine — pipeline target" should {

    "ground Claude in the pipeline's real current steps and return a preview-clean PatchSet" in {
      val user       = newUser()
      val pipelineId = createSourceAndPipeline(user)
      val stepId     = addRenameStep(pipelineId, user, "value", "renamed_value")

      val transport = new FakeClaudeTransport(Vector(cannedResponse(pipelineUpdateJson(pipelineId.value, "Renamed pipeline"))))
      val service   = newRefinementService(transport)

      val request = RefinementRequest(RefinementTarget("pipeline", pipelineId.value), "rename this pipeline")
      val result  = await(service.refine(request, user))

      result.isRight shouldBe true
      transport.sendInvocations.get() shouldBe 1
      val sentPrompt = transport.sendRequests.head.messages.head.content
      sentPrompt should include(pipelineId.value)
      sentPrompt should include(stepId)

      val preview = await(patchSetPreviewService.preview(result.toOption.get.patchSet, user))
      preview.isRight shouldBe true
    }
  }


  "RefinementService.refine — validation/repair" should {

    "repair a first attempt that fails PatchSetPreviewService.preview (nonexistent target id) and succeed on the second" in {
      val user  = newUser()
      val dash  = createDashboardFor(user)
      val panel = createPanelFor(dash.id, user)

      val badJson  = panelUpdateJson(UUID.randomUUID().toString, "New title")
      val goodJson = panelUpdateJson(panel.id.value, "New title")
      val transport = new FakeClaudeTransport(Vector(cannedResponse(badJson), cannedResponse(goodJson)))
      val service   = newRefinementService(transport)

      val request = RefinementRequest(RefinementTarget("dashboard", dash.id.value), "rename the panel")
      val result  = await(service.refine(request, user))

      result.isRight shouldBe true
      result.toOption.get.patchSet.edits.head.target.id shouldBe Some(panel.id.value)
      transport.sendInvocations.get() shouldBe 2
    }

    "fail with 422 after two invalid attempts, never a third" in {
      val user = newUser()
      val dash = createDashboardFor(user)
      createPanelFor(dash.id, user)

      val badJson   = panelUpdateJson(UUID.randomUUID().toString, "New title")
      val transport = new FakeClaudeTransport(Vector(cannedResponse(badJson), cannedResponse(badJson)))
      val service   = newRefinementService(transport)

      val request = RefinementRequest(RefinementTarget("dashboard", dash.id.value), "rename the panel")
      val result  = await(service.refine(request, user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.UnprocessableEntity]
      transport.sendInvocations.get() shouldBe 2
    }
  }


  "RefinementService.refine — multi-turn conversations" should {

    "a second turn with conversationId continues the SAME conversation, and the persisted turn count increases" in {
      val user  = newUser()
      val dash  = createDashboardFor(user)
      val panel = createPanelFor(dash.id, user)

      val transport = new FakeClaudeTransport(Vector(
        cannedResponse(panelUpdateJson(panel.id.value, "First title")),
        cannedResponse(panelUpdateJson(panel.id.value, "Second title"))
      ))
      val service = newRefinementService(transport)

      val turn1 = await(service.refine(RefinementRequest(RefinementTarget("dashboard", dash.id.value), "rename it"), user))
      turn1.isRight shouldBe true
      val conversationId = turn1.toOption.get.conversationId

      val turn2 = await(service.refine(RefinementRequest(RefinementTarget("dashboard", dash.id.value), "rename it again", Some(conversationId)), user))

      turn2.isRight shouldBe true
      turn2.map(_.conversationId) shouldBe Right(conversationId)
      transport.sendInvocations.get() shouldBe 2

      val persisted = await(conversationRepo.findById(AuthoringConversationId(conversationId), user))
      persisted shouldBe defined
      persisted.get.displayTurns should have size 4
      persisted.get.latestPatchSet shouldBe defined
      persisted.get.latestProposal shouldBe empty
    }

    // HEL-411 design.md D3a — the ticket's central data-corruption guardrail: a conversationId
    // belonging to the OTHER flow (authoring) must be rejected the SAME "not found" shape an owner
    // mismatch gets, and MUST NOT silently reassign that row's outcome column.
    "reject an authoring conversationId passed to refinement continuation as NotFound, and leaves its latestProposal completely unchanged" in {
      val user = newUser()
      val originalProposal = DashboardProposal("Original authoring dashboard", Vector.empty)
      val now = Instant.now()
      val authoringRecord = AuthoringConversationRepository.AuthoringConversationRecord(
        id              = AuthoringConversationId(UUID.randomUUID().toString),
        ownerId         = user.id,
        apiHistory      = Vector.empty,
        displayTurns    = Vector(AuthoringDisplayTurn("user", "seed")),
        latestProposal  = Some(originalProposal),
        latestPatchSet  = None,
        totalTokensUsed = 0,
        createdAt       = now,
        updatedAt       = now
      )
      await(conversationRepo.create(authoringRecord))

      val dash  = createDashboardFor(user)
      createPanelFor(dash.id, user)
      val transport = new FakeClaudeTransport()
      val service   = newRefinementService(transport)

      val request = RefinementRequest(RefinementTarget("dashboard", dash.id.value), "hijack this conversation", Some(authoringRecord.id.value))
      val result  = await(service.refine(request, user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.serviceError shouldBe a[ServiceError.NotFound]
      transport.sendInvocations.get() shouldBe 0

      val stillThere = await(conversationRepo.findById(authoringRecord.id, user))
      stillThere shouldBe defined
      stillThere.get.latestProposal shouldBe Some(originalProposal)
      stillThere.get.latestPatchSet shouldBe empty
    }
  }
}
