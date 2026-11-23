package com.helio.services.assistant

import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload}
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.api.protocols.pipelines.PipelineProposalSource
import com.helio.api.protocols.assistant.AssistantTurnResult
import com.helio.api.protocols.pipelines.{PipelineProposal, PipelineProposalProtocol}
import com.helio.api.protocols.proposals.{DashboardProposal, DashboardProposalProtocol, ProposalPanel}
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.pipelines.PipelineProposalService
import com.helio.services.proposals.DashboardProposalService
import com.helio.services.assistant.AssistantService
import com.helio.services.sources.SourceService
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
import com.helio.infrastructure.ai._
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.when
import org.scalatest.matchers.should.Matchers
import spray.json._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Fixtures shared by the `AssistantService.converse` specs (`AssistantServiceSpec` and the three specs split out of it,
 *  HEL-1803): the transport fake, the service wiring, the proposal builders and the stubs. Moved verbatim apart from
 *  dropping `private`. */
trait AssistantServiceTestSupport extends Matchers with DashboardProposalProtocol with PipelineProposalProtocol {

  implicit val ec: ExecutionContext = ExecutionContext.global

  def await[A](f: Future[A]): A = Await.result(f, 5.seconds)

  /** HEL-665 (reopened composer ticket, design.md D1): `converse` now returns `Future[Either[
   *  ClaudeError, AssistantTurnResult]]` — every success-path test unwraps the `Right` here
   *  (mechanical update, no behavioral change to any already-passing assertion). */
  def awaitRight(f: Future[Either[ClaudeError, AssistantTurnResult]]): AssistantTurnResult =
    await(f) match {
      case Right(result) => result
      case Left(err)      => fail(s"expected Right(AssistantTurnResult), got Left($err)")
    }

  def config(): ClaudeConfig =
    ClaudeConfig(apiKey = "sk-ant-test-should-never-be-used", model = "claude-opus-4-8", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)

  val now      = Instant.parse("2026-01-01T00:00:00Z")
  val ownerId  = UserId(UUID.randomUUID().toString)
  val user     = AuthenticatedUser(ownerId)
  val outputId = OutputId(UUID.randomUUID().toString)

  // HEL-904 task 4.1: returns a real `Output` directly -- the `DataType`-backed adapter
  // (`dataTypeBackedOutputRepo`/`toOutput`) this used to feed is removed outright now that
  // `OutputRepository` itself is mockable (DataTypeRepository, its former stand-in, no longer
  // exists).
  def pipelineOutput(id: OutputId): Output =
    Output(
      id, "Orders", ownerId, NodeRef(PipelineId("adapter"), None), OutputKind.Table, now, now,
      schema = Vector(SchemaField("amount", "float"))
    )

  def dashboardProposal(outputId: String): DashboardProposal = {
    val panel = ProposalPanel(
      title = "Total", `type` = "output", outputId = Some(outputId),
      fieldMapping = Some(JsObject("value" -> JsString("amount"))), aggregation = None, content = None,
      url = None, orientation = None, chartType = None, xAxisLabel = None, yAxisLabel = None,
      seriesColors = None, label = None, unit = None, sort = None, layout = None, config = None
    )
    DashboardProposal("Sales", Vector(panel))
  }

  def inlinePipelineProposal(pipelineName: String = "New Pipeline"): PipelineProposal = {
    val source = PipelineProposalSource(
      sourceId = None, `type` = Some(DataSourceKind.Static), name = Some("Inline"),
      csvConfig = None, restConfig = None, sqlConfig = None,
      staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("value", "string")), Vector(Vector(JsString("x")))))
    )
    PipelineProposal(pipelineName, Vector(source), steps = Vector.empty, outputs = Vector.empty)
  }

  val findInput: JsValue = JsObject("query" -> JsString("orders"), "resourceTypes" -> JsArray(JsString("dataType")))
  def getResourceInput(id: String): JsValue = JsObject("id" -> JsString(id), "type" -> JsString("dataType"))

  def toolUseResponse(id: String, name: String, input: JsValue, usage: ClaudeApiUsage = ClaudeApiUsage(10, 5)): ClaudeApiResponse =
    ClaudeApiResponse(
      id = s"msg_$id",
      content = Seq(ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))),
      stopReason = Some("tool_use"),
      usage = usage
    )

  def multiToolUseResponse(uses: Seq[(String, String, JsValue)], usage: ClaudeApiUsage = ClaudeApiUsage(10, 5)): ClaudeApiResponse =
    ClaudeApiResponse(
      id = "msg_multi",
      content = uses.map { case (id, name, input) => ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input)) },
      stopReason = Some("tool_use"),
      usage = usage
    )

  def finalTextResponse(text: String, usage: ClaudeApiUsage = ClaudeApiUsage(8, 4)): ClaudeApiResponse =
    ClaudeApiResponse(id = "msg_final", content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some(text))), stopReason = Some("end_turn"), usage = usage)

  class FakeToolTransport(responses: Vector[Future[ClaudeApiResponse]]) extends ClaudeTransport {
    private val invocationCount = new AtomicInteger(0)
    def toolInvocations: Int    = invocationCount.get()

    // Captures every outbound request this fake actually received (evaluation-1.md CR1
    // regression coverage) — lets a test assert the OUTBOUND request Claude sees is unaffected by
    // the `fullHistory` desanitization fix, i.e. seedHistory's system-prompt fold still reaches the
    // transport even though it no longer leaks into the RETURNED/persisted value.
    private val received = new ConcurrentLinkedQueue[ClaudeApiToolRequest]()
    def firstReceivedRequest: ClaudeApiToolRequest = received.peek()
    def allReceivedRequests: Vector[ClaudeApiToolRequest] = {
      val b = Vector.newBuilder[ClaudeApiToolRequest]
      received.forEach(r => b += r)
      b.result()
    }

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] =
      Future.failed(new UnsupportedOperationException("FakeToolTransport.send is not exercised by these tests"))
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] =
      throw new UnsupportedOperationException("FakeToolTransport.stream is not exercised by these tests")
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = {
      received.add(request)
      responses(invocationCount.getAndIncrement())
    }
  }

  // ── Fixture wiring — mirrors AssistantToolExecutorSpec's "mocked repos, real service" style ──

  // HEL-904 task 4.1: mocks `OutputRepository` directly -- the `DataTypeRepository`-backed
  // adapter (`dataTypeBackedOutputRepo`/`toOutput`) this used to require is removed outright now
  // that DataTypes no longer exist.
  def newService(
      outputRepo: OutputRepository,
      dsRepo: DataSourceRepository,
      transport: ClaudeTransport,
      sourceService: SourceService = null
  ): AssistantService = {
    val workspaceContextService  = new WorkspaceContextService(null, null, outputRepo, null)
    val workspaceSearchService   = new WorkspaceSearchService(null, null, outputRepo, null, workspaceContextService)
    // HEL-904 task 3.11: rewired onto OutputRepository/NodeSnapshotRepository -- reuses the SAME
    // mocked outputRepo constructed above for workspaceContextService/workspaceSearchService (no
    // `AssistantService*Spec` suite exercises panel-capability row counts, so a `null` NodeSnapshotRepository
    // degrades to `rowCount = 0`).
    val panelCapabilityService   = new PanelCapabilityService(outputRepo, null)
    val dashboardProposalService = new DashboardProposalService(null, null, outputRepo)
    val pipelineProposalService  = new PipelineProposalService(null, null, null, null, dsRepo, null, SourceFetchBudget.default())
    val claudeClient             = new ClaudeClient(config(), transport)
    // combinedProposalService/patchSetPreviewService/sourceService: null — no scripted sequence
    // in the specs using this helper invokes propose_combined/propose_patch_set/test_connection (mirrors
    // AssistantToolExecutorSpec's own null-unused pattern; a reached call would NPE and fail the
    // test loudly).
    new AssistantService(claudeClient, workspaceSearchService, panelCapabilityService, dashboardProposalService, pipelineProposalService, null, null, sourceService)
  }

  def stubEmptyFind(outputRepo: OutputRepository): Unit =
    when(outputRepo.findAllByOwner(ownerId, Page.Default)).thenReturn(Future.successful(PagedResult(Vector.empty, 0, 0, 200)))

  // HEL-667 design.md D2/tasks.md 7.2 — a real, non-empty find result (matched against the "orders"
  // query the findInput fixture already sends).
  def stubFindWithResults(outputRepo: OutputRepository): Unit =
    when(outputRepo.findAllByOwner(ownerId, Page.Default))
      .thenReturn(Future.successful(PagedResult(Vector(pipelineOutput(outputId)), 1, 0, 200)))
}
