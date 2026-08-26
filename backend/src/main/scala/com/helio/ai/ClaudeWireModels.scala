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
 *  same "default-`None`, existing sites unaffected" precedent applied to prompt-cache breakpoints.
 *
 *  `serverToolResult` (HEL-757 design.md D2) carries a `web_search_tool_result` block's `content`
 *  as raw, opaque `JsValue` — a SEPARATE field from `text: Option[String]`, not a reuse of it,
 *  because Anthropic's result content is a JSON array/object (not a string); reusing `text` would
 *  force a lossy `.toString`/stringify round trip. `id`/`name`/`input` (already above) are reused
 *  as-is for `server_tool_use` — identical shape to `tool_use`, just a different `blockType`. */
final case class ClaudeApiContentBlock(
    blockType: String,
    text: Option[String],
    id: Option[String] = None,
    name: Option[String] = None,
    input: Option[JsValue] = None,
    toolUseId: Option[String] = None,
    isError: Option[Boolean] = None,
    cacheControl: Option[ClaudeApiCacheControl] = None,
    serverToolResult: Option[JsValue] = None
)

final case class ClaudeApiResponse(
    id: String,
    content: Seq[ClaudeApiContentBlock],
    stopReason: Option[String],
    usage: ClaudeApiUsage
)

/** Closed set of tool-entry shapes `sendWithTools` may offer Claude in one request's `tools` array
 *  (HEL-757 design.md D2): a custom function-tool ([[ClaudeApiTool]] itself — the "Custom" case)
 *  or Anthropic's server-executed [[ClaudeApiToolSpec.WebSearch]]. `ClaudeClient.toApiToolRequest`
 *  builds `Seq[ClaudeApiTool]` (custom tools) exactly as it did before this ticket — including its
 *  cache-marking logic (design.md D2a), completely untouched and still typed against
 *  `Seq[ClaudeApiTool]` only — then appends at most one `WebSearch` entry after that sequence,
 *  which Scala widens to `Seq[ClaudeApiToolSpec]` automatically (`ClaudeApiTool <: ClaudeApiToolSpec`). */
sealed trait ClaudeApiToolSpec

/** A tool `sendWithTools` offers to the Anthropic API, wire-shaped: `inputSchema` writes out as
 *  `input_schema` (design.md D3). `cacheControl` (design.md D1) defaults `None`, same precedent as
 *  `ClaudeApiContentBlock`/`ClaudeApiMessage`. Also the `Custom` case of [[ClaudeApiToolSpec]]
 *  (HEL-757 design.md D2) — this type itself is unchanged; it merely gains the sealed-trait parent
 *  so it can share a `tools` array slot with [[ClaudeApiToolSpec.WebSearch]]. */
final case class ClaudeApiTool(
    name: String,
    description: String,
    inputSchema: JsValue,
    cacheControl: Option[ClaudeApiCacheControl] = None
) extends ClaudeApiToolSpec

object ClaudeApiToolSpec {

  /** Anthropic's server-side `web_search` tool (HEL-757 design.md D2/D3), wire type
   *  `web_search_20250305` — verified against Anthropic's official Python SDK (PyPI package
   *  `anthropic`, v0.86.0; github.com/anthropics/anthropic-sdk-python) type definitions:
   *  `WebSearchTool20250305Param` during Execution (systematic-debugging Iron Law: probe-confirmed,
   *  not recalled from design.md alone). `maxUses` is the REMAINING cross-hop budget for the hop
   *  this entry is attached to (`ClaudeClient.toApiToolRequest`), not a static config value — it
   *  shrinks hop-to-hop as `sendWithTools`'s loop tallies `ServerToolUse(name = "web_search")`
   *  blocks already seen this turn. Carries no `cacheControl` of its own (design.md D2a) — it is
   *  always appended AFTER the already-marked custom-tool sequence, never included in that
   *  byte-identical-prefix invariant. */
  final case class WebSearch(maxUses: Int) extends ClaudeApiToolSpec
}

/** A tool-use-loop wire message: `content` is a block array (`tool_use`/`tool_result`/`text`
 *  blocks), never a plain string — the reason this is a parallel type to `ClaudeApiMessage`
 *  (`content: String`) rather than a widened field (design.md D3). */
final case class ClaudeApiToolMessage(role: String, content: Seq[ClaudeApiContentBlock])

/** Wire request for `ClaudeTransport.sendTool` (design.md D3/D4). No `stream` field: `sendWithTools`
 *  is non-streaming per hop, mirroring `send` not `stream`. `tools` widened from `Seq[ClaudeApiTool]`
 *  to `Seq[ClaudeApiToolSpec]` (HEL-757 design.md D2) to admit an optional trailing `WebSearch`
 *  entry alongside the custom tools — every existing caller building this with `Seq[ClaudeApiTool]`
 *  keeps compiling unchanged (`Seq` is covariant). */
final case class ClaudeApiToolRequest(
    model: String,
    maxTokens: Int,
    messages: Seq[ClaudeApiToolMessage],
    temperature: Double,
    tools: Seq[ClaudeApiToolSpec]
)

/** Thrown by `HttpClaudeTransport.send`'s returned `Future` on a non-2xx Anthropic response
 *  (design.md D3) — `ClaudeClient.send` catches this and maps it to
 *  `Left(ClaudeError.ApiError(status, body))`, mirroring `RestApiConnectorDriver`'s
 *  "transport throws, client catches and maps" split. */
final case class ClaudeApiException(status: Int, body: String)
    extends RuntimeException(s"Claude API error: HTTP $status")
