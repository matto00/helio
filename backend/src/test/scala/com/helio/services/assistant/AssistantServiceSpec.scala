package com.helio.services.assistant

import com.helio.api.protocols.sources.{RestApiConfigPayload, StaticColumnPayload, StaticDataPayload}
import com.helio.api.protocols.assistant.{AssistantProposal, AssistantProtocol}
import com.helio.api.protocols.pipelines.{PipelineProposalSource, ProposalRestApiConfig}
import com.helio.api.protocols.assistant.AssistantTurnResult
import com.helio.api.protocols.pipelines.{PipelineProposal, PipelineProposalProtocol}
import com.helio.api.protocols.proposals.{DashboardProposal, DashboardProposalProtocol, ProposalPanel}
import com.helio.services.assistant.AssistantSystemPrompt
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.pipelines.PipelineProposalService
import com.helio.services.proposals.DashboardProposalService
import com.helio.services.assistant.AssistantService
import com.helio.services.pipelines.DataTypeService
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
import com.helio.ai._
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository}
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


  private def dashboardProposal(dataTypeId: String): DashboardProposal = {
    val panel = ProposalPanel(
      title = "Total", `type` = "output", dataTypeId = Some(dataTypeId), metricId = None,
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
    val pipelineProposalService  = new PipelineProposalService(null, null, null, null, null, dsRepo, null, null)
    val claudeClient             = new ClaudeClient(config(), transport)
    // combinedProposalService/patchSetPreviewService/sourceService: null — no scripted sequence
    // below invokes propose_combined/propose_patch_set/test_connection (mirrors
    // AssistantToolExecutorSpec's own null-unused pattern; a reached call would NPE and fail the
    // test loudly).
    new AssistantService(claudeClient, workspaceSearchService, panelCapabilityService, dashboardProposalService, pipelineProposalService, null, null, null)
  }

  private def stubEmptyFind(dtRepo: DataTypeRepository): Unit =
    when(dtRepo.findAll(ownerId, Page.Default, None)).thenReturn(Future.successful(PagedResult(Vector.empty, 0, 0, 200)))

  // HEL-667 design.md D2/tasks.md 7.2 — a real, non-empty find result (matched against the "orders"
  // query the findInput fixture already sends).
  private def stubFindWithResults(dtRepo: DataTypeRepository): Unit =
    when(dtRepo.findAll(ownerId, Page.Default, None))
      .thenReturn(Future.successful(PagedResult(Vector(pipelineOutputDataType(outputId)), 1, 0, 200)))

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

      // HEL-700 tasks.md 3.4 (design.md D5) — a FinalResponse outcome carries the executor's own
      // propose-call counters: one clean attempt, zero failures.
      result.proposeAttempts shouldBe 1
      result.proposeDecodeFailures shouldBe 0
      result.proposeValidationFailures shouldBe 0
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

    // Task 6.7 (HEL-756 tasks.md 2.8 — maxHops raised 3 -> 4): hard cap mirrors ClaudeClientSpec's
    // own hard-cap fixture style. maxHops = 4 is fixed inside AssistantService (never
    // test-configurable) — a 5th tool_use attempt terminates gracefully via HopBudgetExhausted, not
    // a 6th transport call.
    "resolve a hop-budget-exhausted result for a 5-tool_use-attempt sequence" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)

      val findAttempt = Future.successful(toolUseResponse("t", "find", findInput))
      val transport   = new FakeToolTransport(Vector.fill(5)(findAttempt))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.hopBudgetExhausted shouldBe true
      result.proposal shouldBe None
      transport.toolInvocations shouldBe 5
    }

    // HEL-700 tasks.md 3.4 (design.md D5) — a HopBudgetExhausted outcome ALSO carries the
    // executor's propose-call counters, not just FinalResponse. Every one of the 5 SCRIPTED
    // transport responses is an unparseable propose_dashboard call, but (mirrors task 6.7's own
    // "5th tool_use attempt terminates gracefully... not a 6th transport call" doc comment, and
    // ClaudeClient.sendWithTools's own "thisHop > maxHops" guard) only the first 4 (maxHops,
    // HEL-756) are ever actually dispatched to the executor — the 5th arrives but is never executed.
    "carry the executor's propose-call counters on a hop-budget-exhausted outcome" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val badProposeAttempt = Future.successful(toolUseResponse("t", "propose_dashboard", JsObject("dashboardName" -> JsNumber(1))))
      val transport          = new FakeToolTransport(Vector.fill(5)(badProposeAttempt))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.hopBudgetExhausted shouldBe true
      result.proposeAttempts shouldBe 4
      result.proposeDecodeFailures shouldBe 4
      result.proposeValidationFailures shouldBe 0
    }

    // HEL-667 design.md D2/tasks.md 7.2, spec Scenario 1 — a zero-result find immediately followed
    // by a plain final answer (no propose_* call) sets searchedWithNoResults.
    "set searchedWithNoResults for a zero-result find followed by a plain final answer" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(finalTextResponse("I couldn't find anything matching that — can you narrow it down?"))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Track weekly revenue", user))

      result.searchedWithNoResults shouldBe true
      result.hopBudgetExhausted shouldBe false
      result.proposal shouldBe None
    }

    // HEL-667 design.md D2/tasks.md 7.2, spec Scenario 2 — a find call that DOES return results
    // never sets the flag, even with no proposal.
    "not set searchedWithNoResults for a find call with results" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubFindWithResults(dtRepo)

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(finalTextResponse("Here's what I found; let me know what you'd like to build."))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Track weekly revenue", user))

      result.searchedWithNoResults shouldBe false
    }

    // HEL-667 design.md D2/tasks.md 7.2, spec Scenario 3 — a turn whose tool calls never include
    // find (only get_resource) never sets the flag.
    "not set searchedWithNoResults for a turn with no find call at all" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutputDataType(outputId))))

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "get_resource", getResourceInput(outputId.value))),
        Future.successful(finalTextResponse("Here's the detail you asked for."))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "What is this DataType?", user))

      result.searchedWithNoResults shouldBe false
    }

    // HEL-667 design.md D2 — a hop-budget-exhausted outcome never sets searchedWithNoResults, even
    // when the last (never-executed) tool_use requested was find. HEL-756: 5 scripted attempts
    // (maxHops raised to 4).
    "not set searchedWithNoResults for a hop-budget-exhausted outcome" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)

      val findAttempt = Future.successful(toolUseResponse("t", "find", findInput))
      val transport   = new FakeToolTransport(Vector.fill(5)(findAttempt))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.hopBudgetExhausted shouldBe true
      result.searchedWithNoResults shouldBe false
    }

    // skeptic-final-1.md CR1 (final-gate round 1, live-verified defect against the real dev backend
    // + real Claude API) — root cause: `seedHistory` unconditionally appended the new user turn as
    // plain text onto whatever `history` it was given. A conversation that just hit the hop cap
    // persists a transcript whose LAST turn is an assistant turn with an UNRESOLVED `tool_use`
    // block (exactly `ClaudeToolOutcome.HopBudgetExhausted`'s own shape) — appending a bare text
    // user turn directly after that violates the Anthropic Messages API's structural invariant that
    // a `tool_use` block must be immediately followed by a `tool_result` in the very next message,
    // so EVERY subsequent `converse` call against that conversation failed identically with a 400.
    // This test constructs that exact dangling-history shape directly (mirrors the real persisted
    // shape without needing to script a full 4-hop sequence) and asserts the outbound request
    // resolves the dangling tool_use in the immediately-following message, and that no two
    // consecutive outbound messages share the same role (the OTHER structural invariant a naive
    // "always append a separate resolving turn" fix would break, since `seedHistory` would then
    // append its own new user turn right after an already-user-role synthetic repair turn).
    "repair a dangling tool_use left by a prior hop-cap-exhausted turn before continuing the conversation" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val danglingHistory = Seq(
        ClaudeToolMessage.text(ClaudeRole.User, "Build me a huge dashboard"),
        ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.ToolUse("toolu_dangling", "find", JsObject.empty)))
      )
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("Sure, let's narrow it down."))))

      awaitRight(newService(dtRepo, dsRepo, transport).converse(danglingHistory, "Just show total revenue", user))

      val outboundMessages = transport.firstReceivedRequest.messages
      outboundMessages.zipWithIndex.foreach {
        case (msg, idx) =>
          msg.content.filter(_.blockType == "tool_use").flatMap(_.id).foreach { danglingId =>
            withClue(s"tool_use '$danglingId' at message $idx must be resolved in the very next message: ") {
              outboundMessages(idx + 1).content.flatMap(_.toolUseId) should contain(danglingId)
            }
          }
      }
      outboundMessages.map(_.role).sliding(2).foreach {
        case Seq(a, b) => withClue("no two consecutive outbound messages may share a role: ") { a should not be b }
        case _         => ()
      }
    }

    // HEL-667 ticket.md "Post-delivery fold-in" (tasks.md 8.1) — final-gate skeptic round 2 flagged
    // that the test above only constructs ONE dangling tool_use block; danglingToolUseIds collects
    // over the ENTIRE last turn's content via `.collect` (not `.headOption`), so this mirrors that
    // test's exact structure/assertions but with THREE unresolved tool_use blocks in the SAME
    // hop-cap-exhausted assistant turn (multi-tool-use hops are real — task 6.3's own
    // multiToolUseResponse fixture scripts one) — locks in that every dangling block gets its own
    // paired synthetic isError tool_result, not just the first.
    "repair MULTIPLE dangling tool_use blocks left by a prior hop-cap-exhausted turn before continuing the conversation" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val danglingHistory = Seq(
        ClaudeToolMessage.text(ClaudeRole.User, "Build me a huge dashboard"),
        ClaudeToolMessage(
          ClaudeRole.Assistant,
          Seq(
            ClaudeContentBlock.ToolUse("toolu_dangling_1", "find", JsObject.empty),
            ClaudeContentBlock.ToolUse("toolu_dangling_2", "get_resource", getResourceInput(outputId.value)),
            ClaudeContentBlock.ToolUse("toolu_dangling_3", "find", findInput)
          )
        )
      )
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("Sure, let's narrow it down."))))

      awaitRight(newService(dtRepo, dsRepo, transport).converse(danglingHistory, "Just show total revenue", user))

      val outboundMessages = transport.firstReceivedRequest.messages
      val danglingTurnIdx  = outboundMessages.indexWhere(_.content.exists(_.id.contains("toolu_dangling_1")))
      danglingTurnIdx should be >= 0
      val repairTurn = outboundMessages(danglingTurnIdx + 1)

      // Every dangling id from the assistant turn gets its OWN paired tool_result in the very next
      // message, not just the first — the exact defect class a `.headOption`-based fix would leave
      // toolu_dangling_2/3 unresolved for, which would still 400 on the very next `converse` call.
      Seq("toolu_dangling_1", "toolu_dangling_2", "toolu_dangling_3").foreach { danglingId =>
        withClue(s"tool_use '$danglingId' must be resolved in the immediately-following message: ") {
          repairTurn.content.flatMap(_.toolUseId) should contain(danglingId)
        }
      }
      // Each paired tool_result is a synthetic isError block (mirrors ClaudeClient.executeTool's own
      // recovery idiom, applied here to a never-attempted call rather than a failed one).
      repairTurn.content.count(_.blockType == "tool_result") shouldBe 3
      repairTurn.content.filter(_.blockType == "tool_result").foreach { block =>
        withClue(s"tool_result for '${block.toolUseId}' must be marked isError: ") {
          block.isError shouldBe Some(true)
        }
      }

      // The other structural invariant (strict user/assistant alternation) must still hold with
      // multiple dangling blocks folded into a single repair turn.
      outboundMessages.map(_.role).sliding(2).foreach {
        case Seq(a, b) => withClue("no two consecutive outbound messages may share a role: ") { a should not be b }
        case _         => ()
      }
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
    // hop budget is exhausted, mirroring task 6.7's own 5-tool_use-attempt scripted sequence
    // (HEL-756: maxHops raised to 4).
    "populate fullHistory even when the hop budget is exhausted" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)

      val findAttempt = Future.successful(toolUseResponse("t", "find", findInput))
      val transport   = new FakeToolTransport(Vector.fill(5)(findAttempt))

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

    // HEL-757 design.md D1/tasks.md 5.5 -- every converse call offers web_search unconditionally,
    // never gated on message content/intent -- even for a goal with nothing to do with an external
    // API (find/get_resource only, no propose_* call).
    "set webSearch = true on every outbound request, regardless of message content" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(dtRepo)

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(finalTextResponse("Here's what I found."))
      ))

      awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "What data do we have?", user))

      val outboundTools = transport.firstReceivedRequest.tools
      outboundTools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } should have size 1
    }

    // HEL-757 tasks.md 5.6, assistant-web-research spec.md's "still enforces the existing
    // test_connection requirement unchanged" -- a preceding web_search call earlier in the SAME hop
    // does not bypass HEL-756's structural test_connection gate: propose_pipeline for an untested
    // inline REST source is still rejected identically, exactly as it would be with no preceding
    // search at all (AssistantToolExecutorSpec's own "reject propose_pipeline for an untested
    // inline rest_api source" coverage, replayed here with a web_search call ahead of it in history).
    "still enforce the existing test_connection requirement for a REST-source proposal after a preceding web_search call" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val restSource = PipelineProposalSource(
        sourceId = None,
        `type` = Some("rest_api"),
        name = Some("Inline REST"),
        csvConfig = None,
        restConfig = Some(ProposalRestApiConfig(url = Some("https://api.example.com/data"), method = Some("GET"), headers = None)),
        sqlConfig = None,
        staticConfig = None
      )
      val restProposal = PipelineProposal("REST Pipeline", restSource, "New Output", Vector.empty)

      val searchThenProposeHop = ClaudeApiResponse(
        id = "msg_search_then_propose",
        content = Seq(
          ClaudeApiContentBlock(
            blockType = "server_tool_use",
            text = None,
            id = Some("s1"),
            name = Some("web_search"),
            input = Some(JsObject("query" -> JsString("example API docs")))
          ),
          ClaudeApiContentBlock(blockType = "web_search_tool_result", text = None, toolUseId = Some("s1"), serverToolResult = Some(JsArray.empty)),
          ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some("t1"), name = Some("propose_pipeline"), input = Some(restProposal.toJson))
        ),
        stopReason = Some("tool_use"),
        usage = ClaudeApiUsage(10, 5)
      )

      val transport = new FakeToolTransport(Vector(
        Future.successful(searchThenProposeHop),
        Future.successful(finalTextResponse("Please verify this source with test_connection first."))
      ))

      val result = awaitRight(newService(dtRepo, dsRepo, transport).converse(Seq.empty, "Build a pipeline from this REST API", user))

      result.proposal shouldBe None
      result.proposeAttempts shouldBe 1
      result.proposeValidationFailures shouldBe 1
      transport.toolInvocations shouldBe 2
    }
  }

  // Task 6.8 — AC3's tool-list assertion: no apply-shaped tool is ever a member of the bounded
  // set handed to Claude, enforced by the schema itself (there is no tool through which an apply
  // could even be requested). HEL-756 tasks.md 2.2 extends this (rather than duplicating it) to
  // also assert the new 7th tool, test_connection, is present.
  "AssistantProtocol.assistantTools" should {

    "contain exactly the 7 expected tools, including test_connection, none apply-shaped" in {
      val names = AssistantProtocol.assistantTools.map(_.name)

      names should contain theSameElementsAs Vector(
        "find", "get_resource", "test_connection", "propose_dashboard", "propose_pipeline", "propose_combined", "propose_patch_set"
      )
      AssistantProtocol.assistantTools.foreach { tool =>
        tool.name.toLowerCase should not include "apply"
        tool.description.toLowerCase should not include "apply the"
      }
    }
  }
}
