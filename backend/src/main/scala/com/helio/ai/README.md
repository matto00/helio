# AI

Server-side Anthropic Claude client: `ClaudeClient`/`ClaudeConfig`, the
`ClaudeTransport` abstraction with its `HttpClaudeTransport` implementation,
SSE streaming (`ClaudeSseAssembler`, `ClaudeSseFrameParser`), and
`ClaudeTokenEstimator`. Types are split two ways per `ClaudeModels.scala`'s
own scaladoc: `ClaudeModels` holds the domain-facing types callers actually
work with (`ClaudeRequest`, `ClaudeResponse`, `ClaudeMessage`, `ClaudeError`,
`ClaudeStreamEvent`, `ClaudeContentBlock`, tool types), `ClaudeWireModels`
holds the wire-format types mirroring the Anthropic Messages API's own JSON
shape, and `ClaudeProtocol` is the spray-json `RootJsonFormat` trait for
those wire types (not a wire type itself) — `ClaudeClient` translates
between the two model sets.

**Belongs here:** talking to the Anthropic API — auth, requests, streaming,
token accounting.
**Does not belong here:** feature-specific prompt construction or the
conversation loop that consumes this client (e.g. `AssistantService`), which
live in their own service packages.
