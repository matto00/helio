package com.helio.ai

import spray.json.JsValue

/** Wire-format types mirroring the Anthropic Messages API's own JSON shape (`model`,
 *  `max_tokens`, `messages`, `temperature`, `stream`, `content`, `usage`) — see
 *  `ClaudeProtocol.scala` for the spray-json formatters that translate Scala's camelCase field
 *  names to/from the API's snake_case wire fields. `ClaudeClient` translates between these and
 *  the domain-facing types in `ClaudeModels.scala` (design.md D3). */

/** A prompt-cache breakpoint marker (design.md D1) — mirrors the Anthropic Messages API's
 *  `cache_control` object shape (`{"type": "ephemeral"}`; future TTL variants may add fields, hence
 *  a case class rather than a bare `Boolean`). Use the `Ephemeral` companion value rather than
 *  constructing directly. */
final case class ClaudeApiCacheControl(cacheType: String)

object ClaudeApiCacheControl {
  val Ephemeral: ClaudeApiCacheControl = ClaudeApiCacheControl("ephemeral")
}

final case class ClaudeApiMessage(role: String, content: String, cacheControl: Option[ClaudeApiCacheControl] = None)

final case class ClaudeApiRequest(
    model: String,
    maxTokens: Int,
    messages: Seq[ClaudeApiMessage],
    temperature: Double,
    stream: Boolean
)

/** Gains `cacheCreationInputTokens`/`cacheReadInputTokens` (design.md D4) — both default `0` and
 *  parsed absent-tolerantly, since the Anthropic API only populates them when a request actually
 *  set a `cache_control` breakpoint. */
final case class ClaudeApiUsage(
    inputTokens: Int,
    outputTokens: Int,
    cacheCreationInputTokens: Int = 0,
    cacheReadInputTokens: Int = 0
)

/** Additive `tool_use`/`tool_result` fields (design.md D2) alongside the pre-existing `blockType`/
 *  `text`: `id`/`name`/`input` describe a `tool_use` block Claude emitted; `toolUseId`/`isError`
 *  describe a `tool_result` block a caller sends back. All default `None` so every existing
 *  `ClaudeApiContentBlock(blockType = ..., text = ...)` construction site (`send`/`stream`'s own
 *  plain-text blocks) keeps compiling and behaving unchanged. `cacheControl` (design.md D1) is the
 *  same "default-`None`, existing sites unaffected" precedent applied to prompt-cache breakpoints. */
final case class ClaudeApiContentBlock(
    blockType: String,
    text: Option[String],
    id: Option[String] = None,
    name: Option[String] = None,
    input: Option[JsValue] = None,
    toolUseId: Option[String] = None,
    isError: Option[Boolean] = None,
    cacheControl: Option[ClaudeApiCacheControl] = None
)

final case class ClaudeApiResponse(
    id: String,
    content: Seq[ClaudeApiContentBlock],
    stopReason: Option[String],
    usage: ClaudeApiUsage
)

/** A tool `sendWithTools` offers to the Anthropic API, wire-shaped: `inputSchema` writes out as
 *  `input_schema` (design.md D3). `cacheControl` (design.md D1) defaults `None`, same precedent as
 *  `ClaudeApiContentBlock`/`ClaudeApiMessage`. */
final case class ClaudeApiTool(
    name: String,
    description: String,
    inputSchema: JsValue,
    cacheControl: Option[ClaudeApiCacheControl] = None
)

/** A tool-use-loop wire message: `content` is a block array (`tool_use`/`tool_result`/`text`
 *  blocks), never a plain string — the reason this is a parallel type to `ClaudeApiMessage`
 *  (`content: String`) rather than a widened field (design.md D3). */
final case class ClaudeApiToolMessage(role: String, content: Seq[ClaudeApiContentBlock])

/** Wire request for `ClaudeTransport.sendTool` (design.md D3/D4). No `stream` field: `sendWithTools`
 *  is non-streaming per hop, mirroring `send` not `stream`. */
final case class ClaudeApiToolRequest(
    model: String,
    maxTokens: Int,
    messages: Seq[ClaudeApiToolMessage],
    temperature: Double,
    tools: Seq[ClaudeApiTool]
)

/** Thrown by `HttpClaudeTransport.send`'s returned `Future` on a non-2xx Anthropic response
 *  (design.md D3) — `ClaudeClient.send` catches this and maps it to
 *  `Left(ClaudeError.ApiError(status, body))`, mirroring `RestApiConnector`'s
 *  "transport throws, client catches and maps" split. */
final case class ClaudeApiException(status: Int, body: String)
    extends RuntimeException(s"Claude API error: HTTP $status")
