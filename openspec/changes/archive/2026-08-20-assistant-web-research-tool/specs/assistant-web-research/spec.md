## ADDED Requirements

### Requirement: The assistant can ground its claims in real, current external documentation
The top-level workspace assistant (`AssistantService.converse`) SHALL have access to genuine external
research — Anthropic's server-side `web_search` tool — on every conversation turn, so that factual
claims about an external API (base URL, auth scheme, field names, pagination shape) that inform a
`propose_pipeline`/`propose_combined` REST-source proposal can be checked against real, current
content rather than relying solely on the model's training-data recall.

#### Scenario: A REST-source proposal can be grounded by a prior web_search in the same turn
- **WHEN** a user asks the assistant to build a pipeline against an external API, and the scripted
  turn includes a `web_search` call that returns real documentation content before the eventual
  `propose_pipeline` call
- **THEN** the turn completes normally and the resulting `PipelineProposal`'s inline REST source still
  passes the existing `test_connection` requirement unchanged

#### Scenario: Availability does not depend on message content
- **WHEN** any `converse` call is made, regardless of whether the user's message concerns an external
  API at all
- **THEN** `web_search` is available to Claude for that turn (no per-message intent classification
  gates it)

### Requirement: The per-turn web_search budget is hard-capped
A single `converse` call SHALL NOT result in more than `ClaudeConfig.webSearchMaxUses` (default `3`)
`web_search` invocations, enforced across the whole multi-hop tool-use loop (see claude-api-client's
"The web_search budget is enforced across the whole tool-use loop, not per hop").

#### Scenario: A turn needing more research than the budget allows still completes
- **GIVEN** `ClaudeConfig.webSearchMaxUses = 3` and a scripted turn where Claude would otherwise issue
  a 4th `web_search` call
- **WHEN** `converse` is called
- **THEN** the 4th call is never issued (the tool is omitted from that hop's request) and the turn
  still resolves — via a final response, a proposal, or `HopBudgetExhausted` if `maxHops` is also
  reached — never an unhandled exception

### Requirement: web_search results are not additionally filtered for freshness or safety in v1
The assistant SHALL NOT apply any additional freshness check, domain allowlist/blocklist, or
content-safety scan to `web_search` results beyond what Anthropic's server-side tool itself already
applies. Fetched content is trusted as-is and folded into Claude's own reasoning for that turn.

#### Scenario: A search result is used without additional filtering
- **WHEN** a `web_search` call in a turn returns a result
- **THEN** that result is available to Claude's subsequent reasoning in the same turn with no
  additional freshness/safety check applied by `AssistantService`/`ClaudeClient`
