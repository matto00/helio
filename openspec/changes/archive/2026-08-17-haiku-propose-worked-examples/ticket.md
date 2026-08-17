# HEL-700: Improve Haiku's propose_* tool-call quality via worked examples (Sonnet upgrade as fallback)

## Description

Since pinning `CLAUDE_MODEL` to Haiku 4.5 (HEL-696-adjacent cost fix), the assistant is reportedly fine at the "gathering" steps (find/get_resource calls) but weaker at "shaping" — constructing a well-formed final `propose_*` tool call that actually conforms to its schema.

Grounded in code:

- `AssistantSystemPrompt.scala` (68 lines): detailed hard rules and tool descriptions, but zero worked examples of an actual well-formed call.
- `AssistantProposalToolSchemas.scala` (212 lines): per-field JSON-Schema `description` strings throughout, but zero `examples`.

Rules-only guidance with no concrete example is a known weak spot for smaller/faster models on structured output — this is a well-scoped, cheap first thing to try before reaching for a bigger model.

## Scope

- Add 1-2 concrete worked examples per `propose_*` tool (JSON-Schema `examples` arrays and/or a short few-shot block appended to `AssistantSystemPrompt.text`), focused on the "shaping" step specifically (a fully-formed, schema-valid call), not the search/gathering tools which are reportedly already fine.
- Add a way to measure whether this actually helped — e.g. logging/telemetry on tool-call schema-validation failures by model, or a documented before/after manual comparison — so this isn't a guess.

## Explicit fallback

If richer examples/docs don't measurably improve Haiku's propose_* call quality, the fallback is switching `CLAUDE_MODEL` back to a Sonnet model (globally, or scoped just to this route) — call this out as a real decision point in the implementation, not something to reach for reflexively before trying the cheaper fix.

## Acceptance criteria

- [ ] `propose_*` tool schemas and/or the system prompt include at least one concrete worked example per tool.
- [ ] A measurable signal (telemetry or a documented manual test) exists to compare tool-call quality before/after.
- [ ] If the measured improvement is insufficient, the ticket/PR explicitly states that the Sonnet-upgrade fallback was considered and why it was or wasn't taken.

## Delivery notes (orchestrator)

- Priority: Medium. Project: Helio v1.6 — Agentic Workflows & Pipelines.
- Explicitly NOT a "just switch the model" ticket: try the cheaper fix (worked examples) first and build the measurement mechanism; the Sonnet fallback is a documented decision point in the PR, not a code change to reach for by default.
- Do NOT touch `AssistantToolExecutor.scala` / `WorkspaceAssistantTools.scala` find/get_resource tool behavior (reportedly already fine) beyond what telemetry wiring strictly requires.
- Pure backend prompt/schema/telemetry change — no migration, no frontend, JSON-Schema `examples` are non-normative/additive.
- Concurrent orchestrator on HEL-703 (AuthService/OAuthRoutes/UserRepository/AssistantConversationRoutes) — no file overlap expected.
