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
 *  '''HEL-505 (design.md Decision 7) — the expensive-op guard hook for a future user-facing
 *  chat/assistant route.''' No such route exists yet (see CLAUDE.md's `ANTHROPIC_API_KEY` row:
 *  "no route consumes this yet"), so there is nothing to wire a guard onto today. When one is
 *  built, its Pekko HTTP route MUST wrap itself with `rateLimitDirective.rateLimit(<a tighter
 *  limit than the default>)` — the SAME `RateLimitDirective` `SourcePreviewRoutes`/
 *  `DataSourcePreviewRoutes` already use (HEL-505 design.md Decision 6) — UPSTREAM of (i.e.
 *  wrapping around) any call into this class, never downstream. This is a rate/concurrency
 *  front-end only: it must never duplicate `ClaudeConfig`'s own token/spend budgets (`send`'s
 *  `guardrailReject` above) or HEL-1108's `assistant_daily_usage` tier-gated spend cap (pipeline
 *  AI-step spend is already covered there) — those stay exactly as they are. */
class ClaudeClient(config: ClaudeConfig, transport: ClaudeTransport)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** The configured model id (HEL-401 telemetry) — never the whole `config` (whose own `toString`
   *  is redacted anyway, but this keeps callers that only need the model id from having to reach
   *  into `ClaudeConfig` directly). */
  def modelId: String = config.model

  /** Estimates input tokens → rejects (`GuardrailExceeded`) over `config.maxInputTokens` *before*
   *  any network call; clamps requested `maxTokens` down to `config.maxOutputTokens` (never
   *  rejects for requesting too much output); delegates to `transport.send`; maps transport/API
   *  failures to a typed [[ClaudeError]] (design.md D3/D4). */
  def send(request: ClaudeRequest): Future[Either[ClaudeError, ClaudeResponse]] =
    guardrailReject(request) match {
      case Some(reason) =>
        Future.successful(Left(ClaudeError.GuardrailExceeded(reason)))
      case None =>
        transport
          .send(toApiRequest(request, stream = false))
          .transform {
            case Success(apiResponse) =>
              Success(toClaudeResponse(apiResponse))
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
    guardrailReject(request) match {
      case Some(reason) =>
        Source.single(ClaudeStreamEvent.Error(ClaudeError.GuardrailExceeded(reason)))
      case None =>
        transport.stream(toApiRequest(request, stream = true))
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
        prevToolsJson: Option[JsValue]
    ): Future[ClaudeToolOutcome] = {
      // HEL-1636 D3a: a strip point rewrites the carried history itself, so a thinking block produced
      // before it is never sent again in this loop (and never returned in `FinalResponse.history`).
      val hop     = prepareHop(request, carried, webSearchUsed, prevToolsJson)
      val history = hop.history
      guardrailRejectTool(request.system, history) match {
        case Some(reason) =>
          Future.successful(ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(reason)))
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
                Future.successful(ClaudeToolOutcome.Failed(err))
              case Right(apiResponse) =>
                val totalUsage      = addUsage(usage, apiResponse.usage)
                val blocks          = apiResponse.content.map(toContentBlock)
                val toolUses        = blocks.collect { case tu: ClaudeContentBlock.ToolUse => tu }
                val webSearchCalls  = blocks.collect { case s: ClaudeContentBlock.ServerToolUse if s.name == "web_search" => s }
                val newWebSearchUsed = webSearchUsed + webSearchCalls.size
                val assistantTurn   = ClaudeToolMessage(ClaudeRole.Assistant, blocks)

                if (apiResponse.stopReason.contains("refusal")) {
                  Future.successful(ClaudeToolOutcome.Failed(noAnswer(apiResponse)))
                } else if (toolUses.isEmpty) {
                  // HEL-1636 D6: an `end_turn` with no text stays a (possibly empty) FinalResponse --
                  // after a tool result that is the assistant's normal way to finish. Running out of
                  // tokens or pausing with nothing visible is a failure, never a blank answer.
                  val noVisibleText = !blocks.exists { case ClaudeContentBlock.Text(t) => !ClaudeContentBlock.isBlankText(t); case _ => false }
                  if (noVisibleText && apiResponse.stopReason.exists(r => r == "max_tokens" || r == "pause_turn"))
                    Future.successful(ClaudeToolOutcome.Failed(noAnswer(apiResponse)))
                  else
                    Future.successful(
                      ClaudeToolOutcome.FinalResponse(extractText(blocks), history :+ assistantTurn, totalUsage)
                    )
                } else if (thisHop > request.maxHops) {
                  Future.successful(ClaudeToolOutcome.HopBudgetExhausted(history :+ assistantTurn, totalUsage))
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
                      loop(history :+ assistantTurn :+ userTurn, thisHop, totalUsage, newWebSearchUsed, Some(hop.toolsJson))
                    }
                }
            }
      }
    }

    loop(request.history, hopsUsed = 0, usage = TokenUsage(0, 0), webSearchUsed = 0, prevToolsJson = None)
  }

  /** `NoAnswer` for a response with no usable answer; the refusal `category` comes from
   *  `stop_details.category` (null/absent -> None). */
  private def noAnswer(apiResponse: ClaudeApiResponse): ClaudeError.NoAnswer = {
    val category = apiResponse.stopDetails.collect { case o: JsObject => o }.flatMap(_.fields.get("category")).collect {
      case JsString(c) => c
    }
    ClaudeError.NoAnswer(apiResponse.stopReason, category)
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

  private def addUsage(accumulated: TokenUsage, hop: ClaudeApiUsage): TokenUsage =
    TokenUsage(
      inputTokens = accumulated.inputTokens + hop.inputTokens,
      outputTokens = accumulated.outputTokens + hop.outputTokens,
      cacheCreationInputTokens = accumulated.cacheCreationInputTokens + hop.cacheCreationInputTokens,
      cacheReadInputTokens = accumulated.cacheReadInputTokens + hop.cacheReadInputTokens
    )

  private def extractText(blocks: Seq[ClaudeContentBlock]): String =
    blocks.collect { case ClaudeContentBlock.Text(text) => text }.mkString

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

  private def toApiContentBlock(b: ClaudeContentBlock): ClaudeApiContentBlock = b match {
    case ClaudeContentBlock.Text(text) =>
      ClaudeApiContentBlock(blockType = "text", text = Some(text))
    case ClaudeContentBlock.ToolUse(id, name, input) =>
      ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))
    case ClaudeContentBlock.ToolResult(toolUseId, content, isError) =>
      ClaudeApiContentBlock(blockType = "tool_result", text = Some(content), toolUseId = Some(toolUseId), isError = Some(isError))
    case ClaudeContentBlock.ServerToolUse(id, name, input) =>
      ClaudeApiContentBlock(blockType = "server_tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))
    case ClaudeContentBlock.ServerToolResult(toolUseId, _, result) =>
      ClaudeApiContentBlock(blockType = "web_search_tool_result", text = None, toolUseId = Some(toolUseId), serverToolResult = Some(result))
    case ClaudeContentBlock.Thinking(thinking, signature) =>
      ClaudeApiContentBlock(blockType = "thinking", text = None, thinking = Some(thinking), signature = Some(signature))
    case ClaudeContentBlock.RedactedThinking(data) =>
      ClaudeApiContentBlock(blockType = "redacted_thinking", text = None, data = Some(data))
    case ClaudeContentBlock.Opaque(blockType, raw) =>
      ClaudeApiContentBlock(blockType = blockType, text = None, raw = Some(raw))
  }

  /** Marks the stable prefix's two cache breakpoints (design.md D3): the last CUSTOM `tools`
   *  element (end of the byte-identical-across-hops tools array) and the last content block of the
   *  first message (the end of `AssistantService.seedHistory`'s system-prompt-carrying turn). Both
   *  markers are guarded on non-empty — an empty `tools`/`messages` list is left untouched.
   *
   *  HEL-757 design.md D2a — `markedTools` below is built EXACTLY as before this ticket, typed
   *  `Seq[ClaudeApiTool]` and never touching the sealed `ClaudeApiToolSpec`: the `web_search` entry
   *  (when `request.webSearch`) is appended AFTER this already-marked sequence, always carrying no
   *  `cacheControl` of its own, and is never itself a candidate for the "mark the last element"
   *  breakpoint. `webSearchUsed` (the cumulative count from every prior hop of THIS call) sizes
   *  that hop's `max_uses` down from `config.webSearchMaxUses`; once the remaining budget hits `0`
   *  the tool is dropped from the outbound list entirely (design.md D3) rather than sent with
   *  `max_uses = 0`. */
  private def prepareHop(
      request: ClaudeToolRequest,
      carried: Seq[ClaudeToolMessage],
      webSearchUsed: Int,
      prevToolsJson: Option[JsValue]
  ): PreparedHop = {
    val tools     = buildTools(request, webSearchUsed)
    val toolsJson: JsValue = JsArray(tools.map(t => ClaudeProtocol.claudeApiToolSpecFormat.write(t)).toVector)
    val (normalised, alteredThinking) = ClaudeHistoryNormalizer.normalise(carried)
    val strip = alteredThinking || prevToolsJson.exists(_ != toolsJson)
    val history = if (strip) ClaudeHistoryNormalizer.stripAllThinking(carried) else carried
    val wire    = if (strip) ClaudeHistoryNormalizer.normalise(history)._1 else normalised
    PreparedHop(toApiToolRequest(request, wire, tools), history, toolsJson)
  }

  /** HEL-757 design.md D2a/D3 -- `markedTools` is built EXACTLY as before: typed `Seq[ClaudeApiTool]`,
   *  the last custom tool cache-marked; the `web_search` entry (when `request.webSearch`) is appended
   *  AFTER it with no `cacheControl`, sized to the remaining cross-hop budget and dropped once that
   *  hits `0`. */
  private def buildTools(request: ClaudeToolRequest, webSearchUsed: Int): Seq[ClaudeApiToolSpec] = {
    val apiTools = request.tools.map(t => ClaudeApiTool(t.name, t.description, t.inputSchema))
    val markedTools = apiTools match {
      case Seq() => apiTools
      case _     => apiTools.init :+ apiTools.last.copy(cacheControl = Some(ClaudeApiCacheControl.Ephemeral))
    }
    val remainingWebSearchBudget = math.max(0, config.webSearchMaxUses - webSearchUsed)
    if (request.webSearch && remainingWebSearchBudget > 0)
      markedTools :+ ClaudeApiToolSpec.WebSearch(remainingWebSearchBudget)
    else
      markedTools
  }

  /** Marks the stable prefix's cache breakpoints (design.md D3 of assistant-prompt-caching): the last
   *  custom tool (in `finalTools`) and the last content block of the first message. `messages` is
   *  already normalised (HEL-1636 D5: no empty text block, no empty message). */
  private def toApiToolRequest(request: ClaudeToolRequest, messages: Seq[ClaudeToolMessage], finalTools: Seq[ClaudeApiToolSpec]): ClaudeApiToolRequest = {
    val clampedMaxTokens = math.min(request.maxTokens.getOrElse(config.maxOutputTokens), config.maxOutputTokens)
    val apiMessages = messages.map(m => ClaudeApiToolMessage(m.role, m.content.map(toApiContentBlock)))
    val markedMessages = apiMessages match {
      case Seq() => apiMessages
      case first +: rest =>
        val markedFirst = first.content match {
          case Seq() => first
          case blocks =>
            first.copy(content = blocks.init :+ blocks.last.copy(cacheControl = Some(ClaudeApiCacheControl.Ephemeral)))
        }
        markedFirst +: rest
    }
    ClaudeApiToolRequest(
      system = request.system.filter(_.trim.nonEmpty).toSeq.map(s =>
        ClaudeApiContentBlock(blockType = "text", text = Some(s), cacheControl = Some(ClaudeApiCacheControl.Ephemeral))
      ),
      model = config.model,
      maxTokens = clampedMaxTokens,
      messages = markedMessages,
      temperature = wireTemperature(request.temperature),
      tools = finalTools
    )
  }

  /** HEL-1636 D7: the API default (1.0) is omitted; Haiku 5.5 rejects any other sampling value. */
  private def wireTemperature(requested: Option[Double]): Option[Double] =
    Some(requested.getOrElse(config.temperature)).filter(_ != ClaudeConfig.DefaultTemperature)

  /** Approximates block content as flattened text for the pre-flight guardrail estimate
   *  (design.md D6) — `ClaudeTokenEstimator.estimate` takes `Seq[ClaudeMessage]` (`content:
   *  String`), not `Seq[ClaudeToolMessage]`; this is a pre-flight guardrail, not exact billing
   *  (real accounting always comes from the API's own `usage`, summed in [[addUsage]]). */
  private def flattenForEstimate(history: Seq[ClaudeToolMessage]): Seq[ClaudeMessage] =
    history.map { m =>
      val flattened = m.content
        .map {
          case ClaudeContentBlock.Text(text)                     => text
          case ClaudeContentBlock.ToolUse(_, _, input)           => input.compactPrint
          case ClaudeContentBlock.ToolResult(_, content, _)      => content
          case ClaudeContentBlock.ServerToolUse(_, _, input)     => input.compactPrint
          case ClaudeContentBlock.ServerToolResult(_, _, result) => result.compactPrint
          case ClaudeContentBlock.Thinking(thinking, signature)  => thinking + signature
          case ClaudeContentBlock.RedactedThinking(data)         => data
          case ClaudeContentBlock.Opaque(_, raw)                 => raw.compactPrint
        }
        .mkString
      ClaudeMessage(m.role, flattened)
    }

  private def guardrailRejectTool(system: Option[String], history: Seq[ClaudeToolMessage]): Option[String] = {
    // HEL-1718: the system prompt is sent on every hop, so it counts on every hop.
    val systemMessage = system.filter(_.trim.nonEmpty).toSeq.map(s => ClaudeMessage(ClaudeRole.User, s))
    val estimated     = ClaudeTokenEstimator.estimate(systemMessage ++ flattenForEstimate(history))
    if (estimated > config.maxInputTokens)
      Some(s"Estimated input tokens ($estimated) exceed the configured limit (${config.maxInputTokens})")
    else
      None
  }

  private def guardrailReject(request: ClaudeRequest): Option[String] = {
    val estimated = ClaudeTokenEstimator.estimate(request.messages)
    if (estimated > config.maxInputTokens)
      Some(s"Estimated input tokens ($estimated) exceed the configured limit (${config.maxInputTokens})")
    else
      None
  }

  /** Marks the first message as the cache breakpoint for `send`/`stream` (design.md D3) — the
   *  system-prompt-carrying turn shared identically across repeat calls. Guarded on non-empty. */
  private def toApiRequest(request: ClaudeRequest, stream: Boolean): ClaudeApiRequest = {
    val clampedMaxTokens = math.min(request.maxTokens.getOrElse(config.maxOutputTokens), config.maxOutputTokens)
    val apiMessages       = ClaudeHistoryNormalizer.normaliseText(request.messages).map(m => ClaudeApiMessage(m.role, m.content))
    val markedMessages = apiMessages match {
      case Seq()         => apiMessages
      case first +: rest => first.copy(cacheControl = Some(ClaudeApiCacheControl.Ephemeral)) +: rest
    }
    ClaudeApiRequest(
      model = config.model,
      maxTokens = clampedMaxTokens,
      messages = markedMessages,
      temperature = wireTemperature(request.temperature),
      stream = stream
    )
  }

  /** HEL-1636 D6: a refusal, or any response with no non-empty text, is `NoAnswer` -- every `send`
   *  caller needs text. */
  private def toClaudeResponse(apiResponse: ClaudeApiResponse): Either[ClaudeError, ClaudeResponse] = {
    val text = apiResponse.content.flatMap(_.text).mkString
    if (apiResponse.stopReason.contains("refusal") || ClaudeContentBlock.isBlankText(text))
      Left(noAnswer(apiResponse))
    else
      Right(
        ClaudeResponse(
          id = apiResponse.id,
          text = text,
          stopReason = apiResponse.stopReason,
          usage = TokenUsage(
            inputTokens = apiResponse.usage.inputTokens,
            outputTokens = apiResponse.usage.outputTokens,
            cacheCreationInputTokens = apiResponse.usage.cacheCreationInputTokens,
            cacheReadInputTokens = apiResponse.usage.cacheReadInputTokens
          )
        )
      )
  }
}
