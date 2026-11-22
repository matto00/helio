package com.helio.infrastructure.ai

import spray.json._

/** The config-dependent request shaping `ClaudeClient` applies before a call: the pre-flight guardrails, the wire
 *  temperature, the per-hop tool list and the cache breakpoints. Pure: it logs nothing and holds no transport, so the
 *  client keeps every logging method (HEL-1803). */
private[ai] final class ClaudeRequestBuilder(config: ClaudeConfig) {

  /** The model id this request is sent with: the catalog spec's own id, else the configured default. */
  private[ai] def requestedId(model: Option[ClaudeModelSpec]): String = model.map(_.id).getOrElse(config.model)

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
  private[ai] def prepareHop(
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
    val apiMessages = messages.map(m => ClaudeApiToolMessage(m.role, m.content.map(ClaudeBlockCodec.toApiContentBlock)))
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
      model = requestedId(request.model),
      maxTokens = clampedMaxTokens,
      messages = markedMessages,
      temperature = wireTemperature(request.temperature, requestedId(request.model)),
      tools = finalTools
    )
  }

  /** HEL-1636 D7: the API default (1.0) is omitted; Haiku 5.5 rejects any other sampling value. */
  private def wireTemperature(requested: Option[Double]): Option[Double] =
    Some(requested.getOrElse(config.temperature)).filter(_ != ClaudeConfig.DefaultTemperature)

  /** HEL-1755 C17: a catalog model never gets a sampling parameter, whatever the caller or `CLAUDE_TEMPERATURE` says
   *  (all three reject them). Any other model keeps the HEL-1636 D7 rule. */
  private def wireTemperature(requested: Option[Double], modelId: String): Option[Double] =
    if (ClaudeModelCatalog.isCatalogId(modelId)) None else wireTemperature(requested)

  private[ai] def guardrailRejectTool(system: Option[String], history: Seq[ClaudeToolMessage]): Option[String] = {
    // HEL-1718: the system prompt is sent on every hop, so it counts on every hop.
    val systemMessage = system.filter(_.trim.nonEmpty).toSeq.map(s => ClaudeMessage(ClaudeRole.User, s))
    val estimated     = ClaudeTokenEstimator.estimate(systemMessage ++ ClaudeBlockCodec.flattenForEstimate(history))
    if (estimated > config.maxInputTokens)
      Some(s"Estimated input tokens ($estimated) exceed the configured limit (${config.maxInputTokens})")
    else
      None
  }

  private[ai] def guardrailReject(request: ClaudeRequest): Option[String] = {
    val estimated = ClaudeTokenEstimator.estimate(request.messages)
    if (estimated > config.maxInputTokens)
      Some(s"Estimated input tokens ($estimated) exceed the configured limit (${config.maxInputTokens})")
    else
      None
  }

  /** Marks the first message as the cache breakpoint for `send`/`stream` (design.md D3) — the
   *  system-prompt-carrying turn shared identically across repeat calls. Guarded on non-empty. */
  private[ai] def toApiRequest(request: ClaudeRequest, stream: Boolean): ClaudeApiRequest = {
    val clampedMaxTokens = math.min(request.maxTokens.getOrElse(config.maxOutputTokens), config.maxOutputTokens)
    val apiMessages       = ClaudeHistoryNormalizer.normaliseText(request.messages).map(m => ClaudeApiMessage(m.role, m.content))
    val markedMessages = apiMessages match {
      case Seq()         => apiMessages
      case first +: rest => first.copy(cacheControl = Some(ClaudeApiCacheControl.Ephemeral)) +: rest
    }
    ClaudeApiRequest(
      model = requestedId(request.model),
      maxTokens = clampedMaxTokens,
      messages = markedMessages,
      temperature = wireTemperature(request.temperature, requestedId(request.model)),
      stream = stream
    )
  }
}
