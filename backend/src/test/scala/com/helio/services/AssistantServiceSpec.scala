package com.helio.services

import com.helio.ai._
import com.helio.api.protocols._
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DataTypeRowRepository}
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Coverage for `AssistantService.converse` (HEL-662 tasks.md 6.3-6.8, 6.12) against a hand-written
 *  fake `ClaudeTransport` — mirrors `ClaudeClientSpec`'s own `FakeToolTransport` fixture style
 *  exactly. Zero real network calls anywhere in this suite (task 6.10): every test builds its
 *  `AssistantService` over a `FakeToolTransport`, never `HttpClaudeTransport`, and every underlying
 *  repository is a Mockito mock, never a real database connection — the same "fake transport
 *  throughout" discipline `ClaudeClientSpec`/`WorkspaceSearchServiceSpec` already establish. */
class AssistantServiceSpec extends AnyWordSpec with Matchers with DashboardProposalProtocol with PipelineProposalProtocol {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[A](f: Future[A]): A = Await.result(f, 5.seconds)

  /** HEL-665 (reopened composer ticket, design.md D1): `converse` now returns `Future[Either[
   *  ClaudeError, AssistantTurnResult]]` — every success-path test unwraps the `Right` here
   *  (mechanical update, no behavioral change to any already-passing assertion). */
  private def awaitRight(f: Future[Either[ClaudeError, AssistantTurnResult]]): AssistantTurnResult =
    await(f) match {
      case Right(result) => result
      case Left(err)      => fail(s"expected Right(AssistantTurnResult), got Left($err)")
    }

  private def config(): ClaudeConfig =
    ClaudeConfig(apiKey = "sk-ant-test-should-never-be-used", model = "claude-opus-4-8", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)

  private val now      = Instant.parse("2026-01-01T00:00:00Z")
  private val ownerId  = UserId(UUID.randomUUID().toString)
  private val user     = AuthenticatedUser(ownerId)
  private val outputId = DataTypeId(UUID.randomUUID().toString)

  private def pipelineOutputDataType(id: DataTypeId): DataType =
    DataType(id, None, "Orders", Vector(DataField("amount", "amount", "float", nullable = false)), Vector.empty, 1, now, now, ownerId)

  // ── propose_*/find/get_resource JSON fixtures ───────────────────────────────────────────────

  private def dashboardProposal(dataTypeId: String): DashboardProposal = {
    val panel = ProposalPanel(
      title = "Total", `type` = "metric", dataTypeId = Some(dataTypeId), metricId = None,
      fieldMapping = Some(JsObject("value" -> JsString("amount"))), aggregation = None, content = None,
      url = None, orientation = None, chartType = None, xAxisLabel = None, yAxisLabel = None,
      seriesColors = None, label = None, unit = None, sort = None, layout = None, config = None
    )
    DashboardProposal("Sales", Vector(panel))
  }

  private def inlinePipelineProposal(pipelineName: String = "New Pipeline"): PipelineProposal = {
    val source = PipelineProposalSource(
      sourceId = None, `type` = Some(DataSourceKind.Static), name = Some("Inline"),
      csvConfig = None, restConfig = None, sqlConfig = None,
      staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("value", "string")), Vector(Vector(JsString("x")))))
    )
    PipelineProposal(pipelineName, source, "New Output", Vector.empty)
  }

  private val findInput: JsValue = JsObject("query" -> JsString("orders"), "resourceTypes" -> JsArray(JsString("dataType")))
  private def getResourceInput(id: String): JsValue = JsObject("id" -> JsString(id), "type" -> JsString("dataType"))

  // ── FakeToolTransport (mirrors ClaudeClientSpec's own fixture style) ────────────────────────

  private def toolUseResponse(id: String, name: String, input: JsValue, usage: ClaudeApiUsage = ClaudeApiUsage(10, 5)): ClaudeApiResponse =
    ClaudeApiResponse(
      id = s"msg_$id",
      content = Seq(ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))),
      stopReason = Some("tool_use"),
      usage = usage
    )

  private def multiToolUseResponse(uses: Seq[(String, String, JsValue)], usage: ClaudeApiUsage = ClaudeApiUsage(10, 5)): ClaudeApiResponse =
    ClaudeApiResponse(
      id = "msg_multi",
      content = uses.map { case (id, name, input) => ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input)) },
      stopReason = Some("tool_use"),
      usage = usage
    )

  private def finalTextResponse(text: String, usage: ClaudeApiUsage = ClaudeApiUsage(8, 4)): ClaudeApiResponse =
    ClaudeApiResponse(id = "msg_final", content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some(text))), stopReason = Some("end_turn"), usage = usage)

  private class FakeToolTransport(responses: Vector[Future[ClaudeApiResponse]]) extends ClaudeTransport {
    private val invocationCount = new AtomicInteger(0)
    def toolInvocations: Int    = invocationCount.get()

    // Captures every outbound request this fake actually received (evaluation-1.md CR1
    // regression coverage) — lets a test assert the OUTBOUND request Claude sees is unaffected by
    // the `fullHistory` desanitization fix, i.e. seedHistory's system-prompt fold still reaches the
    // transport even though it no longer leaks into the RETURNED/persisted value.
    private val received = new ConcurrentLinkedQueue[ClaudeApiToolRequest]()
    def firstReceivedRequest: ClaudeApiToolRequest = received.peek()

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

  private def newService(dtRepo: DataTypeRepository, dsRepo: DataSourceRepository, transport: ClaudeTransport): AssistantService = {
    val rowRepo                  = mock(classOf[DataTypeRowRepository])
    when(rowRepo.listRows(any[String](), any[Option[Int]](), any[Set[String]]())).thenReturn(Future.successful(Vector.empty[JsObject]))
    val dataTypeService          = new DataTypeService(dtRepo, rowRepo, dsRepo)
    val workspaceContextService  = new WorkspaceContextService(null, null, dataTypeService, null)
    val workspaceSearchService   = new WorkspaceSearchService(null, null, dataTypeService, null, null, workspaceContextService)
    val panelCapabilityService   = new PanelCapabilityService(dtRepo, rowRepo)
    val dashboardProposalService = new DashboardProposalService(null, null, dtRepo, null)
    val pipelineProposalService  = new PipelineProposalService(null, null, null, null, null, dsRepo, null)
    val claudeClient             = new ClaudeClient(config(), transport)
    // combinedProposalService/patchSetPreviewService: null — no scripted sequence below invokes
    // propose_combined/propose_patch_set (mirrors AssistantToolExecutorSpec's own null-unused
    // pattern; a reached call would NPE and fail the test loudly).
    new AssistantService(claudeClient, workspaceSearchService, panelCapabilityService, dashboardProposalService, pipelineProposalService, null, null)
  }

  private def stubEmptyFind(dtRepo: DataTypeRepository): Unit =
    when(dtRepo.findAll(ownerId, Page.Default, None)).thenReturn(Future.successful(PagedResult(Vector.empty, 0, 0, 200)))

  "converse" should {

    // Task 6.3 — find and propose_dashboard scripted as a SINGLE hop's two tool_use blocks
    // (`ClaudeClient.sendWithTools` executes every tool_use in one hop concurrently via
    // Future.traverse), so only 2 transport invocations happen: hop 1 (both tool calls), hop 2
    // (final text) — matching the task's own "fake transport invoked exactly twice".
    "produce a dashboard proposal from a scripted find + propose_dashboard sequence" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutputDataType(outputId))))

      val expected  = dashboardProposal(outputId.value)
      val transport = new FakeToolTransport(Vector(
        Future.successful(multiToolUseResponse(Seq(("t1", "find", findInput), ("t2", "propose_dashboard", expected.toJson)))),
        Future.successful(finalTextResponse("Here's your dashboard proposal."))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.proposal shouldBe Some(AssistantProposal.Dashboard(expected))
      transport.toolInvocations shouldBe 2
    }

    // Task 6.4 — find turns up nothing, then propose_pipeline succeeds; no AssistantService code
    // path is special-cased on find's emptiness (this test scripts the tool sequence via the fake
    // transport only — AssistantService.converse/AssistantToolExecutor.execute never branch on
    // find's result at all, confirmed by code review of both files).
    "produce a pipeline proposal from a scripted empty find + propose_pipeline sequence" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)

      val expected  = inlinePipelineProposal()
      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(toolUseResponse("t2", "propose_pipeline", expected.toJson)),
        Future.successful(finalTextResponse("No existing data — proposing a new pipeline."))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Track weekly revenue", user))

      result.proposal shouldBe Some(AssistantProposal.Pipeline(expected))
      transport.toolInvocations shouldBe 3
    }

    // Task 6.5 — find + get_resource only, ending in a text-only final response: no propose_* call
    // ever happens, so proposal stays None.
    "produce proposal = None for a find/get_resource-only sequence with a final text-only response" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutputDataType(outputId))))

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(toolUseResponse("t2", "get_resource", getResourceInput(outputId.value))),
        Future.successful(finalTextResponse("Here's what I found; let me know what you'd like to build."))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "What data do we have?", user))

      result.proposal shouldBe None
      result.text should include("what you'd like to build")
    }

    // Task 6.6 — a rejected propose_dashboard is fed back as an isError tool_result and the loop
    // continues to a LATER successful propose_pipeline; the side channel only records the eventual
    // success, never the earlier rejected attempt.
    "record only the eventual success when an earlier propose_dashboard attempt is rejected" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      // The rejected attempt's dataTypeId resolves to nothing -> DashboardProposalService.validate
      // rejects it (BadRequest), never touching the side channel.
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(None))

      val rejected = dashboardProposal(outputId.value)
      val accepted = inlinePipelineProposal("Recovered Pipeline")
      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "propose_dashboard", rejected.toJson)),
        Future.successful(toolUseResponse("t2", "propose_pipeline", accepted.toJson)),
        Future.successful(finalTextResponse("Proposing a new pipeline instead."))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.proposal shouldBe Some(AssistantProposal.Pipeline(accepted))
    }

    // Task 6.7 — hard cap: mirrors ClaudeClientSpec's own hard-cap fixture style. maxHops = 3 is
    // fixed inside AssistantService (never test-configurable) — a 4th tool_use attempt terminates
    // gracefully via HopBudgetExhausted, not a 5th transport call.
    "resolve a hop-budget-exhausted result for a 4-tool_use-attempt sequence" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)

      val findAttempt = Future.successful(toolUseResponse("t", "find", findInput))
      val transport   = new FakeToolTransport(Vector.fill(4)(findAttempt))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.hopBudgetExhausted shouldBe true
      result.proposal shouldBe None
      transport.toolInvocations shouldBe 4
    }

    // Task 6.1 (HEL-665 design.md D1) — a FinalResponse outcome's fullHistory includes the
    // original (empty) history, the new user message turn, and Claude's final response turn, in
    // order. Also locks in evaluation-1.md CR1 (cycle 2): the first turn's content is EXACTLY the
    // caller-supplied message, never AssistantSystemPrompt.text folded in.
    "populate fullHistory with the new user turn and Claude's final response, in order" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val transport = new FakeToolTransport(Vector(
        Future.successful(finalTextResponse("Here you go."))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Hello", user))

      result.fullHistory should have size 2
      result.fullHistory.head.role shouldBe ClaudeRole.User
      result.fullHistory.head.content shouldBe Seq(ClaudeContentBlock.Text("Hello"))
      result.fullHistory.last.role shouldBe ClaudeRole.Assistant
      result.fullHistory.last.content should contain(ClaudeContentBlock.Text("Here you go."))
    }

    // evaluation-1.md Change Request 1 (cycle 2, live-verified defect) — dedicated regression
    // coverage. Root cause: `seedHistory` folds `AssistantSystemPrompt.text + "\n\n" + message`
    // into the SAME ClaudeToolMessage used as the first turn whenever the caller-supplied `history`
    // is empty (a brand-new conversation's first message — exactly AC4's own scenario); before the
    // fix, that literal seeded text flowed straight through into `AssistantTurnResult.fullHistory`
    // (now persisted via `AssistantConversationRoutes.converseFlow`'s `appendTurn` and rendered
    // verbatim by `MessageTurn.tsx`). This test asserts BOTH sides of the fix: the RETURNED/
    // persisted value never leaks the system prompt, AND the OUTBOUND request Claude actually
    // receives still carries it unchanged (no regression to response quality).
    "never leak AssistantSystemPrompt.text into fullHistory's first turn for an empty-history call, while the outbound request to Claude is unaffected" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val transport = new FakeToolTransport(Vector(
        Future.successful(finalTextResponse("Hi there!"))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "What's our revenue?", user))

      // RETURNED/persisted/rendered value: exactly the typed message, nothing else.
      result.fullHistory.head.content shouldBe Seq(ClaudeContentBlock.Text("What's our revenue?"))

      // OUTBOUND request Claude actually received: system prompt still folded in (unaffected by
      // the fix) -- the fold must survive, only the RETURNED value changes.
      val outboundFirstTurnText = transport.firstReceivedRequest.messages.head.content.flatMap(_.text).mkString
      outboundFirstTurnText should include(AssistantSystemPrompt.text)
      outboundFirstTurnText should include("What's our revenue?")
    }

    // Task 6.2 (HEL-665 design.md D1) — fullHistory is populated (not empty/partial) even when the
    // hop budget is exhausted, mirroring task 6.7's own 4-tool_use-attempt scripted sequence.
    "populate fullHistory even when the hop budget is exhausted" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)

      val findAttempt = Future.successful(toolUseResponse("t", "find", findInput))
      val transport   = new FakeToolTransport(Vector.fill(4)(findAttempt))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.hopBudgetExhausted shouldBe true
      result.fullHistory should not be empty
      result.fullHistory.size should be > 1
    }

    // Task 6.2a (HEL-665 design.md D1, design-gate round-1 fix) — a ClaudeToolOutcome.Failed
    // outcome (here: a transport-level API failure) yields Left(claudeError), never a value-less
    // or fabricated Right(AssistantTurnResult).
    "yield Left(claudeError) for a real transport/API failure, never a fabricated result" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val transport = new FakeToolTransport(Vector(
        Future.failed(ClaudeApiException(500, "internal server error"))
      ))

      val result = await(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Hello", user))

      result shouldBe Left(ClaudeError.ApiError(500, "internal server error"))
    }

    // Task 6.12 — a single hop with TWO successful propose_* tool_use calls still ends with exactly
    // one captured proposal; design.md D6 documents this as "some one of the successful calls'
    // proposals wins, non-deterministically" — this test asserts *some* proposal is present, not
    // which one.
    "capture exactly one proposal when a single hop contains two successful propose_* calls" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutputDataType(outputId))))

      val dashboard = dashboardProposal(outputId.value)
      val pipeline  = inlinePipelineProposal()
      val transport = new FakeToolTransport(Vector(
        Future.successful(multiToolUseResponse(Seq(("t1", "propose_dashboard", dashboard.toJson), ("t2", "propose_pipeline", pipeline.toJson)))),
        Future.successful(finalTextResponse("Done."))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Help me out", user))

      result.proposal shouldBe defined
      transport.toolInvocations shouldBe 2
    }
  }

  // Task 6.8 — AC3's tool-list assertion: no apply-shaped tool is ever a member of the bounded
  // set handed to Claude, enforced by the schema itself (there is no tool through which an apply
  // could even be requested).
  "AssistantProtocol.assistantTools" should {

    "contain exactly the 6 expected tools, none apply-shaped" in {
      val names = AssistantProtocol.assistantTools.map(_.name)

      names should contain theSameElementsAs Vector(
        "find", "get_resource", "propose_dashboard", "propose_pipeline", "propose_combined", "propose_patch_set"
      )
      AssistantProtocol.assistantTools.foreach { tool =>
        tool.name.toLowerCase should not include "apply"
        tool.description.toLowerCase should not include "apply the"
      }
    }
  }
}
