package com.helio.infrastructure.ai

import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Non-blocking, guardrail-enforcing wrapper over a [[ClaudeTransport]] (design.md D2-D4). Never
 *  performs a blocking network/I/O call on the calling thread: `send` returns immediately with a
 *  `Future`, `stream` returns immediately with a `Source`.
 *
 *  Never logs `apiKey`: this class never holds one — it only holds `config.model`/
 *  `config.temperature`/token ceilings and a [[ClaudeTransport]] (which encapsulates the key, if
 *  any, entirely on its own side of the SPI boundary).
 *
 *  '''HEL-505 (design.md Decision 7) — the expensive-op guard hook for a user-facing
 *  chat/assistant route.''' Routes now consume this client (the assistant, authoring and refinement
 *  routes; see CLAUDE.md's `ANTHROPIC_API_KEY` row), so any further such Pekko HTTP route MUST wrap itself with `rateLimitDirective.rateLimit(<a tighter
 *  limit than the default>)` — the SAME `RateLimitDirective` `SourcePreviewRoutes`/
 *  `DataSourcePreviewRoutes` already use (HEL-505 design.md Decision 6) — UPSTREAM of (i.e.
 *  wrapping around) any call into this class, never downstream. This is a rate/concurrency
 *  front-end only: it must never duplicate `ClaudeConfig`'s own token/spend budgets (`ClaudeRequestBuilder.guardrailReject`,
 *  which `send` and `stream` call, and `guardrailRejectTool` for `sendWithTools`) or HEL-1108's `assistant_daily_usage` tier-gated spend cap (pipeline
 *  AI-step spend is already covered there) — those stay exactly as they are. */
class ClaudeClient(config: ClaudeConfig, transport: ClaudeTransport)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val requests = new ClaudeRequestBuilder(config)

  /** The configured model id (HEL-401 telemetry) — never the whole `config` (whose own `toString`
   *  is redacted anyway, but this keeps callers that only need the model id from having to reach
   *  into `ClaudeConfig` directly). */
  def modelId: String = config.model

  /** Estimates input tokens → rejects (`GuardrailExceeded`) over `config.maxInputTokens` *before*
   *  any network call; clamps requested `maxTokens` down to `config.maxOutputTokens` (never
   *  rejects for requesting too much output); delegates to `transport.send`; maps transport/API
   *  failures to a typed [[ClaudeError]] (design.md D3/D4). */
  def send(request: ClaudeRequest): Future[Either[ClaudeError, ClaudeResponse]] =
    requests.guardrailReject(request) match {
      case Some(reason) =>
        Future.successful(Left(ClaudeError.GuardrailExceeded(reason)))
      case None =>
        transport
          .send(requests.toApiRequest(request, stream = false))
          .transform {
            case Success(apiResponse) =>
              Success(ClaudeBlockCodec.toClaudeResponse(apiResponse))
            case Failure(ClaudeApiException(status, body)) =>
              log.warn(s"Claude API request failed with status $status")
              Success(Left(ClaudeError.ApiError(status, body)))
            case Failure(e) =>
              log.error("Claude API request failed", e)
              Success(Left(ClaudeError.TransportFailure("Request failed")))
          }
    }

  /** Runs the identical pre-flight guardrail check as [[send]]. On rejection, returns
   *  `Source.single(ClaudeStreamEvent.Error(GuardrailExceeded(reason)))` and completes — reusing
   *  the same error-event handling path a stream consumer already needs for mid-stream API
   *  errors — with zero `ClaudeTransport.stream` invocations (design.md D4a). */
  def stream(request: ClaudeRequest): Source[ClaudeStreamEvent, NotUsed] =
    requests.guardrailReject(request) match {
      case Some(reason) =>
        Source.single(ClaudeStreamEvent.Error(ClaudeError.GuardrailExceeded(reason)))
      case None =>
        transport.stream(requests.toApiRequest(request, stream = true))
    }

  /** Bounded, multi-turn tool-use loop (design.md D1/D5-D7): send `request.history`/`request.tools`
   *  to the transport; when the response has no `tool_use` block, resolve `FinalResponse`; when it
   *  has one or more and the hop budget (`request.maxHops`, a REQUIRED caller-supplied parameter —
   *  never hardcoded here) is not yet exhausted, invoke `executor` for every `tool_use` block in
   *  that response, append a `tool_result`-bearing turn, and recurse. `request.maxHops` round trips
   *  is the max transport calls that may execute a tool; a response requesting tools on what would
   *  be a `maxHops + 1`th round trip is detected — and the loop stops, with no execution and no
   *  further transport call — after that round trip's own response already arrived (design.md D5).
   *  Never blocks the calling thread: every branch returns/completes a `Future`.
   *
   *  `webSearchUsed` (HEL-757 design.md D3) tallies `ServerToolUse(name = "web_search")` blocks
   *  seen across every hop of THIS call only — `toApiToolRequest` uses it to shrink (and eventually
   *  omit) the `web_search` tool entry hop-to-hop, enforcing `config.webSearchMaxUses` as a genuine
   *  cross-hop budget rather than a per-request one. Server-tool blocks are folded into
   *  `assistantTurn`/history exactly like every other block (`blocks` already carries them,
   *  `toContentBlock` decodes them) but are excluded from `toolUses` — so they are NEVER passed to
   *  `executor.execute` (design.md D2's "AssistantToolExecutor must never see one"). */
  def sendWithTools(request: ClaudeToolRequest, executor: ClaudeToolExecutor): Future[ClaudeToolOutcome] = {

    def loop(
        carried: Seq[ClaudeToolMessage],
        hopsUsed: Int,
        usage: TokenUsage,
        webSearchUsed: Int,
        prevToolsJson: Option[JsValue],
        failedCalls: Vector[FailedToolCall] = Vector.empty,
        lastModel: Option[String] = None
    ): Future[ClaudeToolOutcome] = {
      // HEL-1636 D3a: a strip point rewrites the carried history itself, so a thinking block produced
      // before it is never sent again in this loop (and never returned in `FinalResponse.history`).
      val hop     = requests.prepareHop(request, carried, webSearchUsed, prevToolsJson)
      val history = hop.history
      requests.guardrailRejectTool(request.system, history) match {
        case Some(_) if request.stopOnInputBudget && hopsUsed >= 1 =>
          // HEL-1637 D4: keep the work of the round trips already made.
          Future.successful(ClaudeToolOutcome.InputBudgetExhausted(history, usage)(lastModel, hopsUsed, failedCalls.size))
        case Some(reason) =>
          Future.successful(ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(reason))())
        case None =>
          val thisHop = hopsUsed + 1
          transport
            .sendTool(hop.apiRequest)
            .transform {
              case Success(apiResponse) =>
                Success(Right(apiResponse))
              case Failure(ClaudeApiException(status, body)) =>
                log.warn(s"Claude API tool-use request failed with status $status")
                Success(Left(ClaudeError.ApiError(status, body)))
              case Failure(e) =>
                log.error("Claude API tool-use request failed", e)
                Success(Left(ClaudeError.TransportFailure("Request failed")))
            }
            .flatMap {
              case Left(err) =>
                Future.successful(ClaudeToolOutcome.Failed(err)())
              case Right(apiResponse) =>
                logHop(requests.requestedId(request.model), apiResponse)
                val totalUsage      = ClaudeBlockCodec.addUsage(usage, apiResponse.usage)
                val blocks          = apiResponse.content.map(toContentBlock)
                val toolUses        = blocks.collect { case tu: ClaudeContentBlock.ToolUse => tu }
                val webSearchCalls  = blocks.collect { case s: ClaudeContentBlock.ServerToolUse if s.name == "web_search" => s }
                val newWebSearchUsed = webSearchUsed + webSearchCalls.size
                val assistantTurn   = ClaudeToolMessage(ClaudeRole.Assistant, blocks)

                if (apiResponse.stopReason.contains("refusal")) {
                  Future.successful(ClaudeToolOutcome.Failed(ClaudeBlockCodec.noAnswer(apiResponse))(Some(totalUsage), apiResponse.model))
                } else if (toolUses.isEmpty) {
                  // HEL-1636 D6: an `end_turn` with no text stays a (possibly empty) FinalResponse --
                  // after a tool result that is the assistant's normal way to finish. Running out of
                  // tokens or pausing with nothing visible is a failure, never a blank answer.
                  val noVisibleText = !blocks.exists { case ClaudeContentBlock.Text(t) => !ClaudeContentBlock.isBlankText(t); case _ => false }
                  if (noVisibleText && apiResponse.stopReason.exists(r => r == "max_tokens" || r == "pause_turn"))
                    Future.successful(ClaudeToolOutcome.Failed(ClaudeBlockCodec.noAnswer(apiResponse))(Some(totalUsage), apiResponse.model))
                  else
                    Future.successful(
                      ClaudeToolOutcome.FinalResponse(ClaudeBlockCodec.extractText(blocks), history :+ assistantTurn, totalUsage)(apiResponse.model, apiResponse.stopReason, hopsUsed, failedCalls.size)
                    )
                } else if (thisHop > request.maxHops) {
                  Future.successful(ClaudeToolOutcome.HopBudgetExhausted(history :+ assistantTurn, totalUsage)(apiResponse.model, hopsUsed, failedCalls.size))
                } else {
                  val rejected = rejectedOncePerResponse(toolUses, request.oncePerResponseTools)
                  Future
                    .traverse(toolUses) { tu =>
                      rejected.get(tu.id) match {
                        case Some(message) => Future.successful(ClaudeContentBlock.ToolResult(tu.id, message, isError = true))
                        case None          => executeTool(executor, tu)
                      }
                    }
                    .flatMap { toolResults =>
                      val userTurn = ClaudeToolMessage(ClaudeRole.User, toolResults)
                      val nextHistory = history :+ assistantTurn :+ userTurn
                      // HEL-1637 D1/D2: only calls actually dispatched are classified (never the once-per-response
                      // synthetic rejections); failures are totalled across the loop.
                      val newFailures = request.failureBudget.toVector.flatMap { budget =>
                        toolUses.zip(toolResults).collect {
                          case (tu, tr) if !rejected.contains(tu.id) => budget.classify(tu, tr).map(FailedToolCall(tu.name, _))
                        }.flatten
                      }
                      val allFailures = failedCalls ++ newFailures
                      if (request.failureBudget.exists(b => allFailures.size >= b.maxFailures))
                        Future.successful(ClaudeToolOutcome.FailureBudgetExhausted(nextHistory, totalUsage, allFailures)(apiResponse.model, thisHop))
                      else
                        loop(nextHistory, thisHop, totalUsage, newWebSearchUsed, Some(hop.toolsJson), allFailures, apiResponse.model)
                    }
                }
            }
      }
    }

    loop(request.history, hopsUsed = 0, usage = TokenUsage(0, 0), webSearchUsed = 0, prevToolsJson = None)
  }

  /** HEL-1755 D2: one INFO line per hop AFTER the body parsed, correlated with the transport's own status line by
   *  `request-id`: requested id, the response's `model`, `stop_reason`, the token usage counters and the content block TYPES (never content).
   *  A response model that differs from the requested id is a WARN naming the two ids. */
  private def logHop(requested: String, response: ClaudeApiResponse): Unit = {
    val blockTypes = response.content.map(_.blockType).mkString(",")
    log.info(
      s"Claude hop request-id=${response.requestId.getOrElse("none")} requested=$requested " +
        s"response-model=${response.model.getOrElse("none")} stop_reason=${response.stopReason.getOrElse("none")} blocks=[$blockTypes] " +
        s"usage=in:${response.usage.inputTokens},out:${response.usage.outputTokens}," +
        s"cache_write:${response.usage.cacheCreationInputTokens},cache_read:${response.usage.cacheReadInputTokens}"
    )
    response.model.filter(_ != requested).foreach { actual =>
      log.warn(s"Claude responded with model=$actual for a request pinned to $requested (request-id=${response.requestId.getOrElse("none")})")
    }
  }

  /** HEL-1639 D5: within ONE response, the first `tool_use` among the tools named in `oncePerResponse` (block order) runs;
   *  every later one maps to the error text the model gets instead of a result, by tool-use id. A `tool_use` of any other tool is never rejected. */
  private def rejectedOncePerResponse(toolUses: Seq[ClaudeContentBlock.ToolUse], oncePerResponse: Set[String]): Map[String, String] =
    // The named tools share ONE slot per response regardless of which one: a turn yields one proposal.
    toolUses.filter(tu => oncePerResponse.contains(tu.name)).drop(1).map(tu => tu.id -> OncePerResponseMessage).toMap

  private val OncePerResponseMessage: String =
    "only one propose_* call per response is evaluated. A turn yields ONE proposal: put every edit (all Output creates " +
      "and panel creates) in a single propose_patch_set call, and re-propose the whole set if it fails"

  /** Invokes the caller-supplied executor for a single `tool_use` block; an explicit `Left` becomes
   *  an `isError = true` `ToolResult` rather than failing the overall `Future` (design.md D7) — and
   *  so does a THROWN exception or a FAILED inner `Future` from `executor.execute` itself (HEL-667
   *  design.md D3): `Future(executor.execute(...))` catches a synchronous throw the same way a
   *  failed `Future` is already caught by `.transform`'s `Failure` branch, so every failure shape
   *  converges on the same recovery path. The recovered exception is logged at `warn` FIRST (HEL-667
   *  design.md's own Risk mitigation) so a genuine programming-error bug in an executor stays
   *  observable rather than silently masked as an ordinary tool failure. */
  private def executeTool(executor: ClaudeToolExecutor, toolUse: ClaudeContentBlock.ToolUse): Future[ClaudeContentBlock.ToolResult] =
    Future(executor.execute(toolUse.name, toolUse.input)).flatMap(identity).transform {
      case Success(Right(output)) => Success(ClaudeContentBlock.ToolResult(toolUse.id, output, isError = false))
      case Success(Left(message)) => Success(ClaudeContentBlock.ToolResult(toolUse.id, message, isError = true))
      case Failure(e) =>
        log.warn(s"Tool execution failed for '${toolUse.name}' (toolUseId=${toolUse.id}); recovering as an isError tool_result", e)
        Success(ClaudeContentBlock.ToolResult(toolUse.id, Option(e.getMessage).getOrElse(e.getClass.getName), isError = true))
    }

  private def toContentBlock(b: ClaudeApiContentBlock): ClaudeContentBlock = b.blockType match {
    case "tool_use" =>
      ClaudeContentBlock.ToolUse(b.id.getOrElse(""), b.name.getOrElse(""), b.input.getOrElse(JsObject.empty))
    case "tool_result" =>
      ClaudeContentBlock.ToolResult(b.toolUseId.getOrElse(""), b.text.getOrElse(""), b.isError.getOrElse(false))
    // HEL-757 design.md D2 — Anthropic's own server-executed tools (currently only web_search in
    // scope for this ticket); ServerToolUse.name drives sendWithTools's cross-hop budget tally.
    case "server_tool_use" =>
      ClaudeContentBlock.ServerToolUse(b.id.getOrElse(""), b.name.getOrElse(""), b.input.getOrElse(JsObject.empty))
    case "web_search_tool_result" =>
      // The wire block carries no `name` field (see ServerToolResult's own doc comment) — "web_search"
      // is the only server-tool result shape this ticket wires, so it's the constant supplied here.
      ClaudeContentBlock.ServerToolResult(b.toolUseId.getOrElse(""), name = "web_search", result = b.serverToolResult.getOrElse(JsObject.empty))
    case "text" =>
      ClaudeContentBlock.Text(b.text.getOrElse(""))
    // HEL-1636 D1/D2: model-internal blocks are kept exactly; never reduced to text.
    case "thinking" =>
      ClaudeContentBlock.Thinking(b.thinking.getOrElse(""), b.signature.getOrElse(""))
    case "redacted_thinking" =>
      ClaudeContentBlock.RedactedThinking(b.data.getOrElse(""))
    case other =>
      // Names the type only -- never the content.
      log.warn(s"Preserving an unmodeled Claude content block of type '$other' verbatim")
      ClaudeContentBlock.Opaque(other, b.raw.getOrElse(JsObject("type" -> JsString(other))))
  }
}
