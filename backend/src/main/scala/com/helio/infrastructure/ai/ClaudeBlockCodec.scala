package com.helio.infrastructure.ai

import spray.json._

/** Pure conversions between the wire types and the domain types `ClaudeClient` exposes: no config and no logger
 *  (the one conversion that logs, `toContentBlock`, stays in `ClaudeClient`; HEL-1803). */
private[ai] object ClaudeBlockCodec {

  /** `NoAnswer` for a response with no usable answer; the refusal `category` comes from
   *  `stop_details.category` (null/absent -> None). */
  private[ai] def noAnswer(apiResponse: ClaudeApiResponse): ClaudeError.NoAnswer = {
    val category = apiResponse.stopDetails.collect { case o: JsObject => o }.flatMap(_.fields.get("category")).collect {
      case JsString(c) => c
    }
    ClaudeError.NoAnswer(apiResponse.stopReason, category)
  }

  private[ai] def addUsage(accumulated: TokenUsage, hop: ClaudeApiUsage): TokenUsage =
    TokenUsage(
      inputTokens = accumulated.inputTokens + hop.inputTokens,
      outputTokens = accumulated.outputTokens + hop.outputTokens,
      cacheCreationInputTokens = accumulated.cacheCreationInputTokens + hop.cacheCreationInputTokens,
      cacheReadInputTokens = accumulated.cacheReadInputTokens + hop.cacheReadInputTokens
    )

  private[ai] def extractText(blocks: Seq[ClaudeContentBlock]): String =
    blocks.collect { case ClaudeContentBlock.Text(text) => text }.mkString

  private[ai] def toApiContentBlock(b: ClaudeContentBlock): ClaudeApiContentBlock = b match {
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

  /** Approximates block content as flattened text for the pre-flight guardrail estimate
   *  (design.md D6) — `ClaudeTokenEstimator.estimate` takes `Seq[ClaudeMessage]` (`content:
   *  String`), not `Seq[ClaudeToolMessage]`; this is a pre-flight guardrail, not exact billing
   *  (real accounting always comes from the API's own `usage`, summed in [[addUsage]]). */
  private[ai] def flattenForEstimate(history: Seq[ClaudeToolMessage]): Seq[ClaudeMessage] =
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

  /** HEL-1636 D6: a refusal, or any response with no non-empty text, is `NoAnswer` -- every `send`
   *  caller needs text. */
  private[ai] def toClaudeResponse(apiResponse: ClaudeApiResponse): Either[ClaudeError, ClaudeResponse] = {
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
