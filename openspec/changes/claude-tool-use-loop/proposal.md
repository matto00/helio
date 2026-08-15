## Why

HEL-659's top-level workspace assistant needs Claude to call tools mid-conversation (`find`,
`get_resource`, `propose_*`) and get results fed back, bounded by a hard hop cap. `ClaudeClient`
(HEL-390) today only supports a single send/stream round trip with no tool-use support at all —
this is the one new backend primitive the assistant design (`docs/superpowers/specs/
2026-08-14-top-level-assistant-design.md`) calls out as still missing.

## What Changes

- Add `ClaudeClient.sendWithTools(history, tools, executor, maxHops)`: parses `tool_use` content
  blocks from Claude's response, invokes the caller-supplied executor, feeds the `tool_result`
  back as the next user turn, and loops until Claude returns a final (non-`tool_use`) response or
  `maxHops` is reached.
- `maxHops` is a caller-supplied parameter, not a `ClaudeClient`-internal constant — HEL-662's
  `AssistantService` is the caller that will pass `3`; `ClaudeClient` stays a reusable low-level
  primitive per the design spec's Architecture section.
- On exceeding `maxHops`, the loop terminates gracefully with a typed "budget exhausted" outcome
  — no exception, no further Claude call.
- Extend the wire/domain models minimally to carry `tool_use`/`tool_result` content blocks and an
  outbound `tools` schema list, without changing the shape of any existing plain-text message.
- `send`/`stream` are unchanged; guardrails (max input tokens, key handling) apply identically to
  `sendWithTools`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `claude-api-client`: adds a bounded, multi-turn tool-use loop (`sendWithTools`) alongside the
  existing single-shot `send`/`stream` requirements.

## Impact

- `backend/src/main/scala/com/helio/ai/`: `ClaudeClient`, `ClaudeModels`, `ClaudeWireModels`,
  `ClaudeProtocol`, `ClaudeTransport` (new default-bodied `sendTool` member — see design.md D4),
  `HttpClaudeTransport` (overrides it for real).
- No other file changes: `ClaudeTransport`'s other 6 implementers (`HttpClaudeTransport` aside) —
  `ClaudeClientSpec`'s fake plus 5 more `FakeClaudeTransport`s in `AuthoringTelemetrySpec`,
  `DashboardAuthoringRoutesSpec`, `RefinementRoutesSpec`, `DashboardAuthoringServiceSpec`,
  `RefinementServiceSpec` — keep compiling untouched thanks to the default body.
- No route/API surface changes; `ClaudeClient` already has a real caller today (`ApiRoutes.scala`
  via `DashboardAuthoringService`/`RefinementService`), but nothing calls the new `sendWithTools`
  yet (HEL-662 is next). No schema/migration changes; no frontend changes.

## Non-goals

- No actual tools (`find`, `get_resource`, `propose_*`) — HEL-661/HEL-662.
- No hardcoded 3-hop cap inside `ClaudeClient` — that policy value belongs to the caller.
- No conversation persistence, system-prompt construction, or telemetry — later tickets in the
  epic (HEL-663, HEL-667).
