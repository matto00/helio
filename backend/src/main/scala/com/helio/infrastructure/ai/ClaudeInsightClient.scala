package com.helio.infrastructure.ai

import com.helio.domain.insights._
import org.slf4j.LoggerFactory
import spray.json.JsValue

import scala.concurrent.{ExecutionContext, Future}

/** Production [[InsightModelClient]] over [[ClaudeClient]] (HEL-1741 D1). Sends one user turn through
 *  `sendWithTools` with a top-level `system` prompt, no tools, `maxHops = 0` and no web search, capped at 4096
 *  output tokens. The model is the request's (a catalog id) or else the shared `CLAUDE_MODEL`.
 *
 *  It applies NO quota gate itself: `InsightRenderService` charges the owner-keyed gate before every send. */
final class ClaudeInsightClient(client: ClaudeClient, catalog: ClaudeModelCatalog = ClaudeModelCatalog.all)(implicit ec: ExecutionContext) extends InsightModelClient {

  private val log = LoggerFactory.getLogger(getClass)

  private val noTools = new ClaudeToolExecutor {
    def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
      Future.successful(Left("no tools are available"))
  }

  override def render(request: InsightModelRequest): Future[Either[InsightModelFailure, InsightModelResponse]] = {
    val toolRequest = ClaudeToolRequest(
      history = Seq(ClaudeToolMessage.text(ClaudeRole.User, request.user)),
      tools = Nil,
      maxHops = 0,
      maxTokens = Some(math.min(request.maxOutputTokens, ClaudeInsightClient.MaxOutputTokens)),
      webSearch = false,
      system = Some(request.system),
      // HEL-1743 D7: a catalog id selects its spec (so `ClaudeClient` applies the catalog request rules); `None`, or an id
      // the catalog does not define (a non-catalog server default), is sent as `CLAUDE_MODEL`.
      model = request.model.flatMap(catalog.definition)
    )
    val requested = request.model.filter(catalog.definition(_).isDefined).getOrElse(client.modelId)
    client.sendWithTools(toolRequest, noTools).map {
      case r @ ClaudeToolOutcome.FinalResponse(text, _, usage) =>
        val answered = r.responseModel.getOrElse(requested)
        if (!answered.startsWith(requested)) log.warn(s"insight render requested model '$requested' but the API answered with '$answered'")
        Right(InsightModelResponse(text, InsightUsage(usage.inputTokens, usage.outputTokens, usage.cacheCreationInputTokens, usage.cacheReadInputTokens), answered))
      // HEL-1637 D9: the other two budget stops cannot occur (this caller never sets failureBudget/stopOnInputBudget).
      case _: ClaudeToolOutcome.HopBudgetExhausted | _: ClaudeToolOutcome.FailureBudgetExhausted | _: ClaudeToolOutcome.InputBudgetExhausted =>
        Left(InsightModelFailure.NoAnswer("the model asked for a tool"))
      case ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(reason)) => Left(InsightModelFailure.Guardrail(reason))
      case ClaudeToolOutcome.Failed(ClaudeError.ApiError(status, body))    => Left(InsightModelFailure.Api(status, body))
      case ClaudeToolOutcome.Failed(ClaudeError.TransportFailure(message)) => Left(InsightModelFailure.Transport(message))
      case f @ ClaudeToolOutcome.Failed(ClaudeError.NoAnswer(reason, category)) =>
        val usage = f.usage.map(u => InsightUsage(u.inputTokens, u.outputTokens, u.cacheCreationInputTokens, u.cacheReadInputTokens)).getOrElse(InsightUsage.Zero)
        Left(InsightModelFailure.NoAnswer(ClaudeErrorMessages.noAnswerMessage(reason, category), usage, Some(f.responseModel.getOrElse(requested))))
    }
  }
}

object ClaudeInsightClient {
  /** HEL-1743 D14 (owner, cycle 2): thinking and text share the output budget, so 400 left Haiku 5.5 with thinking only. */
  val MaxOutputTokens: Int = 4096
}
