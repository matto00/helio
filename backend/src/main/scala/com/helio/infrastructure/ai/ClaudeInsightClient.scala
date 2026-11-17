package com.helio.infrastructure.ai

import com.helio.domain.insights._
import spray.json.JsValue

import scala.concurrent.{ExecutionContext, Future}

/** Production [[InsightModelClient]] over [[ClaudeClient]] (HEL-1741 D1). Sends one user turn through
 *  `sendWithTools` with a top-level `system` prompt, no tools, `maxHops = 0` and no web search, capped at 400
 *  output tokens. The model is the shared `CLAUDE_MODEL` (`client.modelId`).
 *
 *  NOT wired into Main, ApiRoutes or any trigger, and it applies NO quota gate: the leaf that gives it a caller
 *  must wrap it with the owner-keyed gate. */
final class ClaudeInsightClient(client: ClaudeClient)(implicit ec: ExecutionContext) extends InsightModelClient {

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
      system = Some(request.system)
    )
    client.sendWithTools(toolRequest, noTools).map {
      case ClaudeToolOutcome.FinalResponse(text, _, usage) =>
        Right(InsightModelResponse(text, InsightUsage(usage.inputTokens, usage.outputTokens, usage.cacheCreationInputTokens, usage.cacheReadInputTokens), client.modelId))
      case ClaudeToolOutcome.HopBudgetExhausted(_, _) => Left(InsightModelFailure.NoAnswer("the model asked for a tool"))
      case ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(reason)) => Left(InsightModelFailure.Guardrail(reason))
      case ClaudeToolOutcome.Failed(ClaudeError.ApiError(status, body))    => Left(InsightModelFailure.Api(status, body))
      case ClaudeToolOutcome.Failed(ClaudeError.TransportFailure(message)) => Left(InsightModelFailure.Transport(message))
      case ClaudeToolOutcome.Failed(ClaudeError.NoAnswer(reason, category)) =>
        Left(InsightModelFailure.NoAnswer(ClaudeErrorMessages.noAnswerMessage(reason, category)))
    }
  }
}

object ClaudeInsightClient {
  val MaxOutputTokens: Int = 400
}
