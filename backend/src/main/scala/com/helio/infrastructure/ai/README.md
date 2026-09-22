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
between the two model sets. `ClaudeAiStepClient` is the production
`com.helio.domain.ai.AiStepClient` adapter over `ClaudeClient`, the single
call point every pipeline AI step's model call passes through.

Not a domain — this is structural infrastructure: an outbound third-party
HTTP integration, the same kind of concern as `infrastructure/storage/`.
Does NOT hold: feature-specific prompt construction or the conversation
loop that consumes this client (e.g. `AssistantService`, `services/proposals/`,
`services/patchsets/`), which live in their own service packages, or the
`AiStepClient` domain trait itself (`domain/ai/`), which this package only
implements.
