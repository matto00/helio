## MODIFIED Requirements

### Requirement: Config is env-sourced and never hardcoded at call sites
The backend SHALL define `ClaudeConfig` in `com.helio.ai`, constructed via `ClaudeConfig.fromEnv():
Either[String, ClaudeConfig]`, reading the API key from `ANTHROPIC_API_KEY`, the model id from
`CLAUDE_MODEL` (default `claude-opus-4-8`), temperature from `CLAUDE_TEMPERATURE` (default `1.0`),
token ceilings from `CLAUDE_MAX_TOKENS` (default `4096`) / `CLAUDE_MAX_INPUT_TOKENS` (default
`100000`), and the per-turn `web_search` call budget from `CLAUDE_WEB_SEARCH_MAX_USES` (default `3`).
No call site SHALL hardcode a model id, temperature, max-tokens value, web-search-budget value, or
API key literal.

#### Scenario: Key present
- **WHEN** `ANTHROPIC_API_KEY` is set to a non-blank value in the environment
- **THEN** `ClaudeConfig.fromEnv()` returns `Right(config)` with `config.apiKey` equal to that value

#### Scenario: Key absent or blank
- **WHEN** `ANTHROPIC_API_KEY` is unset or blank in the environment
- **THEN** `ClaudeConfig.fromEnv()` returns `Left(<clear error message naming the missing variable>)`

#### Scenario: Model id defaults and is overridable
- **WHEN** `CLAUDE_MODEL` is unset
- **THEN** `ClaudeConfig.fromEnv()`'s resulting config has `model == "claude-opus-4-8"`, and setting
  `CLAUDE_MODEL` to another value overrides it

#### Scenario: Temperature defaults and is overridable
- **WHEN** `CLAUDE_TEMPERATURE` is unset
- **THEN** `ClaudeConfig.fromEnv()`'s resulting config has `temperature == 1.0`, and setting
  `CLAUDE_TEMPERATURE` to another value overrides it

#### Scenario: Token ceilings default when unset
- **WHEN** `CLAUDE_MAX_TOKENS` and `CLAUDE_MAX_INPUT_TOKENS` are both unset
- **THEN** `ClaudeConfig.fromEnv()`'s resulting config has `maxOutputTokens == 4096` and
  `maxInputTokens == 100000`, and setting either env var overrides its respective default

#### Scenario: web_search budget defaults and is overridable
- **WHEN** `CLAUDE_WEB_SEARCH_MAX_USES` is unset
- **THEN** `ClaudeConfig.fromEnv()`'s resulting config has `webSearchMaxUses == 3`, and setting
  `CLAUDE_WEB_SEARCH_MAX_USES` to another value overrides it

## ADDED Requirements

### Requirement: A caller can request Anthropic's server-side web_search tool on a tool-use request
`ClaudeToolRequest` SHALL carry a `webSearch: Boolean` field, defaulting `false` so every existing
caller is unaffected. When `true`, `ClaudeClient.sendWithTools` SHALL include one server-side
`web_search` tool object (Anthropic's documented wire shape, distinct from a custom
`ClaudeTool`/`ClaudeApiTool`) in the outbound request's tool list, alongside `request.tools`'
ordinary custom tools.

#### Scenario: webSearch defaults to false and adds nothing to the outbound tool list
- **WHEN** a `ClaudeToolRequest` is built without setting `webSearch`
- **THEN** the outbound API request's tool list contains only the custom tools from `request.tools`

#### Scenario: webSearch = true adds the server-side tool alongside custom tools
- **WHEN** a `ClaudeToolRequest` with `webSearch = true` and two custom tools is sent
- **THEN** the outbound API request's tool list contains both custom tools plus one web_search
  server-tool entry

### Requirement: The web_search budget is enforced across the whole tool-use loop, not per hop
`sendWithTools` SHALL track the cumulative count of `web_search` server-tool invocations across every
hop of one `ClaudeToolRequest`, and SHALL stop offering the web_search tool (omit it from the
outbound tool list) on any hop once that cumulative count reaches `ClaudeConfig.webSearchMaxUses` —
regardless of `maxHops`, so a multi-hop request can never exceed the configured per-turn budget.

#### Scenario: The web_search tool is dropped once the cross-hop budget is exhausted
- **GIVEN** `ClaudeConfig.webSearchMaxUses = 2` and a fake transport whose first two scripted
  responses each contain two `web_search` server-tool-use blocks
- **WHEN** `sendWithTools` issues its third hop
- **THEN** that hop's outbound tool list omits the web_search tool entirely

#### Scenario: Budget tracking is independent per ClaudeToolRequest call
- **WHEN** two separate `sendWithTools` calls each set `webSearch = true`
- **THEN** each call's web_search budget starts fresh at `ClaudeConfig.webSearchMaxUses`, unaffected
  by how many searches the other call used

### Requirement: Server-tool content blocks are never dispatched to the caller's ClaudeToolExecutor
`ClaudeContentBlock` SHALL gain `ServerToolUse(id, name, input)` and `ServerToolResult(toolUseId,
name, result: JsValue)` cases for Anthropic's server-executed tool blocks (`server_tool_use`/
`web_search_tool_result`). `sendWithTools` SHALL append these to the accumulated history exactly as
received, but SHALL NOT invoke `executor.execute` for a `ServerToolUse` block — server tools are
already resolved by Anthropic during generation, requiring no client-side execution or synthesized
`tool_result`.

#### Scenario: A web_search call in a hop's response never reaches the executor
- **WHEN** a fake transport's scripted response contains a `server_tool_use`/`web_search_tool_result`
  pair and no client `tool_use` block
- **THEN** `executor.execute` is invoked zero times for that hop, and the loop resolves to
  `ClaudeToolOutcome.FinalResponse` once no further client tool_use is pending

#### Scenario: A web_search call and a client tool_use in the same hop are handled independently
- **WHEN** a fake transport's scripted response contains both a `server_tool_use`/
  `web_search_tool_result` pair and a client `tool_use` block
- **THEN** `executor.execute` is invoked exactly once (for the client `tool_use` block only), and the
  server-tool blocks are preserved in the appended history unchanged
