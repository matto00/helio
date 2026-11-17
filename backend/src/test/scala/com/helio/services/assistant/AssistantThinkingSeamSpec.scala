package com.helio.services.assistant

import com.helio.api.protocols.assistant.AssistantTurnResult
import com.helio.api.protocols.proposals.{DashboardProposal, DashboardProposalProtocol, ProposalPanel}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.ai.ClaudeFixtures._
import com.helio.infrastructure.ai._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.pipelines.PipelineProposalService
import com.helio.services.proposals.DashboardProposalService
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
import org.mockito.Mockito.mock
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID
import org.mockito.Mockito.when
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1636 tasks.md 5.1 / 5.3 seam: a Haiku-5.5-shaped response runs through the real protocol
 *  reader, `ClaudeClient.sendWithTools`, `AssistantService.converse`, the repository's JSON blob
 *  format and a second `converse`. */
class AssistantThinkingSeamSpec extends AnyWordSpec with Matchers with DashboardProposalProtocol {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val user = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  private val outputId = OutputId(UUID.randomUUID().toString)
  private val now      = Instant.parse("2026-01-01T00:00:00Z")

  private def service(transport: ClaudeTransport, outputRepo: OutputRepository = mock(classOf[OutputRepository])): AssistantService = {
    val dsRepo     = mock(classOf[DataSourceRepository])
    val ctxService = new WorkspaceContextService(null, null, outputRepo, null)
    val search     = new WorkspaceSearchService(null, null, outputRepo, null, ctxService)
    val client = new ClaudeClient(
      ClaudeConfig(apiKey = "sk-ant-test-never-logged", model = "claude-haiku-5-5", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000),
      transport
    )
    new AssistantService(client, search, new PanelCapabilityService(outputRepo, null), new DashboardProposalService(null, null, outputRepo),
      new PipelineProposalService(null, null, null, null, dsRepo, null, SourceFetchBudget.default()), null, null, null)
  }

  private def converse(s: AssistantService, history: Seq[ClaudeToolMessage], msg: String): AssistantTurnResult =
    Await.result(s.converse(history, msg, user), 5.seconds) match {
      case Right(r)  => r
      case Left(err) => fail(s"expected Right, got Left($err)")
    }

  /** What `AssistantConversationService` does to the persisted turns: JSON blob out, JSON blob in. */
  private def persistRoundTrip(turns: Seq[ClaudeToolMessage]): Seq[ClaudeToolMessage] =
    turns.toJson.convertTo[Seq[ClaudeToolMessage]]

  private def allText(turns: Seq[ClaudeToolMessage]): Seq[String] =
    turns.flatMap(_.content).collect { case ClaudeContentBlock.Text(t) => t }

  "converse on a thinking model (5.1)" should {

    "save no empty assistant text and send no empty text or thinking block on the next turn" in {
      val transport = new RecordingToolTransport(Vector(fixture("haiku55-thinking-then-text.json"), textResponse("Sure, here is more.")))
      val s         = service(transport)

      val turn1 = converse(s, Seq.empty, "Hello")
      val persisted = persistRoundTrip(turn1.fullHistory)
      allText(persisted) should not contain ""
      allText(persisted) should contain("Hi, how can I help with your dashboards?")
      persisted.flatMap(_.content).map(_.getClass.getSimpleName).toSet.diff(Set("Text")) shouldBe empty

      converse(s, persisted, "Can you update my Standings dashboard with more charts please?")

      transport.invocations shouldBe 2
      val req2 = transport.requestJson(1)
      emptyTextBlocks(req2) shouldBe empty
      req2.compactPrint should not include "\"thinking\""
      req2.compactPrint should not include "SIG_S1_opaque"
      // the request ends with the user's new message
      transport.messagesJson(1).last.fields("role") shouldBe JsString("user")
    }
  }

  "converse with an unknown block type (5.3)" should {

    "strip the unknown block from the persisted turns and keep only the text" in {
      val transport = new RecordingToolTransport(Vector(fixture("unknown-block-then-text.json")))
      val turn      = converse(service(transport), Seq.empty, "hi")

      val persisted = persistRoundTrip(turn.fullHistory)
      allText(persisted) should not contain ""
      persisted.flatMap(_.content).map(_.getClass.getSimpleName).toSet.diff(Set("Text")) shouldBe empty
      allText(persisted) should contain("Done.")
    }
  }

  private def proposalFor(id: String): DashboardProposal =
    DashboardProposal("Sales", Vector(ProposalPanel(
      title = "Total", `type` = "output", outputId = Some(id),
      fieldMapping = Some(JsObject("value" -> JsString("amount"))), aggregation = None, content = None,
      url = None, orientation = None, chartType = None, xAxisLabel = None, yAxisLabel = None,
      seriesColors = None, label = None, unit = None, sort = None, layout = None, config = None
    )))

  private def proposeHop1(): ClaudeApiResponse = {
    val r = fixture("propose-hop1.json")
    r.copy(content = r.content.map { b =>
      if (b.blockType == "tool_use") b.copy(input = Some(proposalFor(outputId.value).toJson)) else b
    })
  }

  private def mockedOutputs(): OutputRepository = {
    val repo = mock(classOf[OutputRepository])
    val out = Output(outputId, "Orders", user.id, NodeRef(PipelineId("adapter"), None), OutputKind.Table, now, now, schema = Vector(SchemaField("amount", "float")))
    when(repo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(out)))
    repo
  }

  private def messageIsEmpty(m: JsObject): Boolean = m.fields("content") match {
    case JsArray(es) => es.isEmpty
    case JsString(t) => t.trim.isEmpty
    case _           => true
  }

  "a proposal followed by an empty end_turn (5.8)" should {
    "succeed, persist the proposal's tool_use and tool_result, and leave no empty message in the next request" in {
      val transport = new RecordingToolTransport(Vector(proposeHop1(), fixture("empty-end-turn.json"), textResponse("Next answer")))
      val s         = service(transport, mockedOutputs())

      val turn1 = converse(s, Seq.empty, "Build me a sales dashboard")
      turn1.proposal.isDefined shouldBe true
      val persisted = persistRoundTrip(turn1.fullHistory)
      val blocks    = persisted.flatMap(_.content)
      blocks.exists(_.isInstanceOf[ClaudeContentBlock.ToolUse]) shouldBe true
      blocks.exists(_.isInstanceOf[ClaudeContentBlock.ToolResult]) shouldBe true

      converse(s, persisted, "thanks")
      val msgs = transport.messagesJson(2)
      msgs.filter(messageIsEmpty) shouldBe empty
      emptyTextBlocks(transport.requestJson(2)) shouldBe empty
      msgs.last.fields("role") shouldBe JsString("user")
    }

    "fail with NoAnswer(end_turn) when the end_turn is blank and no proposal was captured" in {
      val transport = new RecordingToolTransport(Vector(fixture("empty-end-turn.json")))
      Await.result(service(transport).converse(Seq.empty, "hi", user), 5.seconds) shouldBe Left(ClaudeError.NoAnswer(Some("end_turn"), None))
    }
  }

  "converse failures (5.4)" should {
    "return the refusal as Left(NoAnswer) so nothing is persisted" in {
      val transport = new RecordingToolTransport(Vector(fixture("refusal.json")))
      Await.result(service(transport).converse(Seq.empty, "hi", user), 5.seconds) shouldBe Left(ClaudeError.NoAnswer(Some("refusal"), Some("cyber")))
    }
  }

  "every converse request ends with a user turn (5.5)" should {
    "hold for a fresh, a continued and a dangling-tool_use history" in {
      val transport = new RecordingToolTransport(Vector.fill(3)(textResponse("ok")))
      val s         = service(transport)
      val prior     = Seq(ClaudeToolMessage.text(ClaudeRole.User, "q1"), ClaudeToolMessage.text(ClaudeRole.Assistant, "a1"))
      val dangling  = prior :+ ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.ToolUse("t1", "find", JsObject.empty)))

      converse(s, Seq.empty, "m")
      converse(s, prior, "m")
      converse(s, dangling, "m")

      (0 until 3).foreach(i => transport.messagesJson(i).last.fields("role") shouldBe JsString("user"))
      emptyTextBlocks(JsArray(transport.messagesJson(2))) shouldBe empty
    }
  }
}
