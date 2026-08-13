package com.helio.ai

/** Wire-format types mirroring the Anthropic Messages API's own JSON shape (`model`,
 *  `max_tokens`, `messages`, `temperature`, `stream`, `content`, `usage`) — see
 *  `ClaudeProtocol.scala` for the spray-json formatters that translate Scala's camelCase field
 *  names to/from the API's snake_case wire fields. `ClaudeClient` translates between these and
 *  the domain-facing types in `ClaudeModels.scala` (design.md D3). */

final case class ClaudeApiMessage(role: String, content: String)

final case class ClaudeApiRequest(
    model: String,
    maxTokens: Int,
    messages: Seq[ClaudeApiMessage],
    temperature: Double,
    stream: Boolean
)

final case class ClaudeApiUsage(inputTokens: Int, outputTokens: Int)

final case class ClaudeApiContentBlock(blockType: String, text: Option[String])

final case class ClaudeApiResponse(
    id: String,
    content: Seq[ClaudeApiContentBlock],
    stopReason: Option[String],
    usage: ClaudeApiUsage
)

/** Thrown by `HttpClaudeTransport.send`'s returned `Future` on a non-2xx Anthropic response
 *  (design.md D3) — `ClaudeClient.send` catches this and maps it to
 *  `Left(ClaudeError.ApiError(status, body))`, mirroring `RestApiConnector`'s
 *  "transport throws, client catches and maps" split. */
final case class ClaudeApiException(status: Int, body: String)
    extends RuntimeException(s"Claude API error: HTTP $status")
