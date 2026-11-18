package com.helio.services.assistant

import com.helio.api.protocols.assistant.AssistantTurnResult
import com.helio.domain.model._
import com.helio.infrastructure.ai._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.pipelines.PipelineProposalService
import com.helio.services.proposals.DashboardProposalService
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.mockito.Mockito.{mock, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1755 tasks.md 5.4 / D6: switching the model between turns. The fixtures are SYNTHETIC: the fake transport
 *  hand-builds the documented response shapes (an omitted-display `thinking` block with a signature, then `tool_use`,
 *  then `end_turn`) and signs every thinking block with the model that produced it. It then answers `400` for any
 *  request that holds a thinking block signed by a DIFFERENT model, or a sampling / `budget_tokens` / forced
 *  `tool_choice` field. It encodes our reading of the docs (evidence/api-contract.md), so the real-API corroboration
 *  of both switch directions is the live check, not this spec. */
class AssistantModelSwitchSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val Models = Seq(ClaudeModelCatalog.HaikuId, ClaudeModelCatalog.SonnetId, ClaudeModelCatalog.OpusId)
  private val user   = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val Forbidden = Set("temperature", "top_p", "top_k", "budget_tokens", "tool_choice")

  /** Records every request; replies per hop with thinking (signed by the request's own model) + tool_use, then text. */
  private final class ModelAwareTransport extends ClaudeTransport {
    private val seen = new ConcurrentLinkedQueue[ClaudeApiToolRequest]()
    def requests: Vector[ClaudeApiToolRequest] = seen.asScala.toVector

    private def keys(v: JsValue): Set[String] = v match {
      case o: JsObject => o.fields.keySet ++ o.fields.values.flatMap(keys)
      case JsArray(es) => es.flatMap(keys).toSet
      case _           => Set.empty
    }

    private def thinkingSignatures(req: ClaudeApiToolRequest): Seq[String] =
      req.messages.flatMap(_.content).flatMap(_.signature)

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = Future.failed(new UnsupportedOperationException)
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = {
      seen.add(request)
      val wire = ClaudeProtocol.claudeApiToolRequestFormat.write(request)
      if (keys(wire).intersect(Forbidden).nonEmpty)
        Future.failed(ClaudeApiException(400, "forbidden field for this model"))
      else if (thinkingSignatures(request).exists(_ != s"SIG_${request.model}"))
        Future.failed(ClaudeApiException(400, "thinking block from another model"))
      else {
        val afterToolResult = request.messages.lastOption.exists(_.content.exists(_.blockType == "tool_result"))
        val thinking        = ClaudeApiContentBlock("thinking", None, thinking = Some(""), signature = Some(s"SIG_${request.model}"))
        val body =
          if (afterToolResult) Seq(thinking, ClaudeApiContentBlock("text", Some(s"answer from ${request.model}")))
          else Seq(thinking, ClaudeApiContentBlock("tool_use", None, id = Some(s"toolu_${seen.size}"), name = Some("find"), input = Some(JsObject("query" -> JsString("x"), "resourceTypes" -> JsArray(JsString("dataType"))))))
        Future.successful(
          ClaudeApiResponse("msg", body, Some(if (afterToolResult) "end_turn" else "tool_use"), ClaudeApiUsage(10, 5), model = Some(request.model))
        )
      }
    }
  }

  private def service(transport: ClaudeTransport): AssistantService = {
    val outputRepo = mock(classOf[OutputRepository])
    when(outputRepo.findAllByOwner(user.id, Page.Default)).thenReturn(Future.successful(PagedResult(Vector.empty, 0, 0, 200)))
    val ctxService = new WorkspaceContextService(null, null, outputRepo, null)
    val search     = new WorkspaceSearchService(null, null, outputRepo, null, ctxService)
    val client     = new ClaudeClient(ClaudeConfig("sk-ant-test-never-logged", "claude-opus-4-8", 1.0, 4096, 100000), transport)
    new AssistantService(client, search, new PanelCapabilityService(outputRepo, null), new DashboardProposalService(null, null, outputRepo),
      new PipelineProposalService(null, null, null, null, mock(classOf[DataSourceRepository]), null, SourceFetchBudget.default()), null, null, null)
  }

  private def spec(id: String): ClaudeModelSpec = ClaudeModelCatalog.all.select(id).get

  private def converse(s: AssistantService, history: Seq[ClaudeToolMessage], model: String): Either[ClaudeError, AssistantTurnResult] =
    Await.result(s.converse(history, "look something up", user, Some(spec(model))), 5.seconds)

  private def persisted(r: AssistantTurnResult): Seq[ClaudeToolMessage] = r.fullHistory.toJson.convertTo[Seq[ClaudeToolMessage]]

  "switching between catalog models across turns" should {
    for (a <- Models; b <- Models) {
      s"never send ${a}'s thinking to $b, and answer both turns with a tool call on each ($a -> $b)" in {
        val transport = new ModelAwareTransport
        val s         = service(transport)

        val turn1 = converse(s, Seq.empty, a).getOrElse(fail("turn 1 failed"))
        val turn2 = converse(s, persisted(turn1), b).getOrElse(fail("turn 2 must not 400"))

        // Four hops: find + answer on A, find + answer on B; each loop fixed on its own model.
        transport.requests.map(_.model) shouldBe Vector(a, a, b, b)
        turn1.responseModel shouldBe Some(a)
        turn2.responseModel shouldBe Some(b)
        turn1.toolCallCount shouldBe 1
        turn2.toolCallCount shouldBe 2 // cumulative in fullHistory: turn 1's call plus turn 2's own
        // Turn 2's first request carries no thinking block at all (persisted history drops them).
        transport.requests(2).messages.flatMap(_.content).exists(_.blockType == "thinking") shouldBe false
      }
    }

    "be detected by the fake itself: a request holding another model's thinking block gets a 400 (positive control)" in {
      val transport = new ModelAwareTransport
      val foreign = Seq(
        ClaudeToolMessage.text(ClaudeRole.User, "hi"),
        ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.Thinking("", s"SIG_${ClaudeModelCatalog.OpusId}"), ClaudeContentBlock.Text("old")))
      )
      val outcome = Await.result(
        new ClaudeClient(ClaudeConfig("k", "claude-opus-4-8", 1.0, 4096, 100000), transport)
          .sendWithTools(ClaudeToolRequest(foreign :+ ClaudeToolMessage.text(ClaudeRole.User, "more"), Seq.empty, 2, model = Some(spec(ClaudeModelCatalog.HaikuId))), new ClaudeToolExecutor {
            def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = Future.successful(Right("[]"))
          }),
        5.seconds
      )
      outcome shouldBe a[ClaudeToolOutcome.Failed]
    }
  }
}
