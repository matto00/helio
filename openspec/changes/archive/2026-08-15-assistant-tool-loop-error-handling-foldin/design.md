## Context

HEL-660/661/662/663/664/665/666 already shipped: `ClaudeClient.sendWithTools` (bounded tool loop,
`ClaudeToolOutcome` = `FinalResponse`/`HopBudgetExhausted`/`Failed`), `AssistantService.converse`
(`maxHops = 3`, `AssistantTurnResult(text, fullHistory, hopBudgetExhausted, usage)`),
`AssistantToolExecutor` (dispatches `find`/`get_resource`/4 `propose_*` tools, Hard Boundary: never
`apply`), `AssistantConversationRoutes`'s `POST /:id/converse` (fetch → converse → append → re-fetch,
returns `AssistantConversationResponse`), and the chat surface (`ChatPage`, `ActiveConversationPanel`,
`MessageTurn`, `ToolCallIndicator`, `MessageComposer`).

Confirmed by reading the real code (not the ticket's own framing) before drafting this:
- `ClaudeToolOutcome.HopBudgetExhausted` already exists and is already produced correctly
  (`ClaudeClient.scala:104-105`) — the gap is downstream: `AssistantService.toTurnResult` computes a
  synthetic hop-cap message but `AssistantConversationRoutes.converseFlow` only reads
  `result.fullHistory`, never `result.text`/`hopBudgetExhausted` — the message is silently dropped.
- A tool executor's `Left` already becomes an `isError` tool_result and the loop recovers
  (`ClaudeClient.scala:120-126`) — but this only covers an explicit `Left`. `executeTool`'s `.map`
  has no `.recover`; a thrown exception or a failed inner `Future` from any service call inside
  `AssistantToolExecutor.execute` would fail `sendWithTools`'s whole `Future` chain, not degrade to
  an `isError` result. `claude-api-client`'s own spec requirement ("A failed tool execution is fed
  back to Claude, not raised as an exception") already promises this — it's just not fully true yet.
- `find` never throws, returns `Vector.empty` on no match (`WorkspaceSearchService.scala:61-105`).
  The system prompt already says "if find turns up nothing... propose_pipeline/combined can create
  the data" — this ticket's "ask a clarifying question" AC is a *refinement* of that guidance for
  underspecified goals, not a replacement.
- `ToolCallIndicator.tsx:79-91` renders nothing when `result === null` — a hop-cap-hit persists a
  transcript ending in an unpaired `tool_use`, which today renders as a permanently stuck-looking row.
- HEL-401's `AuthoringTelemetry` is a fire-and-forget MDC/`LogstashEncoder` JSON log line (no DB
  table, no query API) scoped specifically to `DashboardAuthoringService`'s goal→proposal→apply
  funnel — zero telemetry exists today for the tool loop.

## Goals / Non-Goals

**Goals:**
- Every one of the ticket's 3 failure modes has a deterministic, fake-executor-driven test and a
  defined UI treatment.
- Telemetry records tool-call count and hop-cap-hit rate per turn, same log-line discipline as
  HEL-401.

**Non-Goals:**
- No new hop-cap value, no change to the Hard Boundary, no telemetry query API (no precedent exists).
- No retrofit of the new signals onto historical turns — converse-response-only, ephemeral.
- No change to `DashboardAuthoringService`/`AuthoringTelemetry` (a separate, still-independently-used
  flow) — this ticket's telemetry is a sibling, not a merge.

## Decisions

**D1 — `searchedWithNoResults`/`hopBudgetExhausted` are ephemeral, converse-response-only signals.**
Two new `Option[Boolean]` fields on `AssistantConversationResponse` (`jsonFormat5` → `jsonFormat7`),
populated only by `POST /:id/converse`'s `detailOf` call, left `None` by `GET /:id`. Alternative
considered: persist them into the transcript turn itself (a badge that survives reload) — rejected as
disproportionate scope creep into `ClaudeToolMessage`'s shared wire format (used by `send` and
`sendWithTools` alike) for a same-request-only UX signal; HEL-665's composer design explicitly
avoided widening `AssistantConversationResponse`'s "reuses the existing shape" invariant for anything
less than a real need — two new optional fields preserves that invariant (still one response type,
no new endpoint-specific type) while satisfying this ticket's actual requirement (immediate feedback
on the turn that just happened).

**D2 — `searchedWithNoResults` computed in `AssistantService.converse`, not derived from history.**
Definition: the turn's outcome is `FinalResponse` (no proposal captured) AND the last tool call
executed in `fullHistory`'s new turns was `find` with an empty result array. Computed directly from
data `converse` already has post-`sendWithTools` (no new history-parsing helper, no dependency on
persisted transcript shape) — deterministically testable via a fake `ClaudeToolExecutor` returning
`Right("[]")` for `find`, exactly matching AC1's own "fake tool executor returning the relevant
empty-result shape" requirement.

**D3 — Tool-execution hardening lives in `ClaudeClient.executeTool`, not `AssistantToolExecutor`.**
`executeTool`'s existing doc comment already states the intended contract ("a `Left` becomes an
`isError = true` ToolResult rather than failing the overall Future") — adding `.recover` there
enforces that promise for *every* `ClaudeToolExecutor` implementation (present and future), not just
this one. Alternative (wrapping only `AssistantToolExecutor.execute`'s dispatch in a `Try`/`recover`)
was rejected: it would leave the trait-level contract still broken for any other executor, and
`claude-api-client`'s spec requirement is phrased at the `sendWithTools`/`executeTool` level already.

**D4 — System-prompt nuance is one edited, explicitly conditional sentence, not an appended second
one.** (Revised after design-gate round 1 REFUTE — see Planner Notes.) The existing sentence
("If find turns up nothing relevant to the goal, don't give up: propose_pipeline or
propose_combined can create the data the goal needs from scratch.") is EDITED in place to become
one explicit branch of a single if/else, not left untouched next to a new, separately-worded
clause: qualify it with "...for goals concrete enough to act on," and have the new clarifying-
question guidance read as its explicit else-branch (e.g. "If the goal is too underspecified to
confidently build a propose_pipeline/propose_combined call, ask a targeted clarifying question
instead."). One conditional statement, two branches, textually linked — not two unlinked absolutes
on the same trigger. (Real-model behavior itself isn't deterministically testable; only the system
prompt text and the downstream handling of a plain-text `FinalResponse` with no proposal are — see
D2/D5.)

**D7 — `schemas/assistant-conversation.schema.json` gains the 2 new optional properties.** (Added
after design-gate round 1 REFUTE — see Planner Notes.) `AssistantConversationResponse`'s 2 new
`Option[Boolean]` fields (D1) need matching optional properties in the JSON Schema contract file —
`check:schemas` (`scripts/check-schema-drift.mjs`) is a mandatory `.husky/pre-commit` gate that
diffs case classes against schemas and fails loudly on a mismatch; skipping this would either block
every subsequent commit or tempt a hooks bypass against CLAUDE.md policy. This is a real contract
update, not a DB migration — proposal.md's Impact section now says so explicitly.

**D5 — Frontend: `ToolCallIndicator` gets a `cutShort` treatment for an unresolved `tool_use`;
`MessageTurn` gets a distinct badge/style for a final turn where `hopBudgetExhausted` or
`searchedWithNoResults` is true.** Both driven by explicit boolean props threaded down from
`ActiveConversationPanel` (from the converse response / slice state), never inferred from message
text content — keeps the UI logic deterministic and testable, consistent with D1/D2.

**D6 — New `AssistantTelemetry` object, sibling to `AuthoringTelemetry`, not a merge.**
Same MDC/`MdcPropagatingExecutionContext`/fire-and-forget pattern, new event name
`assistant_tool_loop_outcome`, called from `AssistantConversationRoutes.converseFlow` right after a
successful `converse` (mirrors `DashboardAuthoringRoutes`'s own call-site placement — MDC snapshot
captured at route-evaluation time). Fields: `conversationId`, `toolCallCount` (new turns' `ToolUse`
block count), `hopBudgetExhausted`, `searchedWithNoResults`, `modelId`, `inputTokens`/`outputTokens`.
No goal/message text logged (same privacy rule as HEL-401). New capability
`assistant-tool-loop-telemetry`, not a delta on `authoring-error-telemetry` — that capability's
Purpose is explicitly scoped to `DashboardAuthoringService`'s flow, a genuinely different code path.

## Risks / Trade-offs

- [Risk] `.recover` in `ClaudeClient.executeTool` could mask a genuine bug (e.g. a programming error
  in an executor) as a normal "tool failed" result → Mitigation: log the recovered exception at
  `warn` before converting it to a `Left`-shaped tool_result, so it's still observable without
  crashing the turn.
- [Risk] The system-prompt nuance (D4) is unverifiable by a deterministic test → Mitigation: tests
  cover the deterministic downstream handling (D2/D5) via a fake executor; the prompt text itself is
  reviewed, not unit-tested — consistent with how `AssistantSystemPrompt`'s existing text is untested
  today.
- [Risk] Two new optional response fields (D1) could be misread by a future caller as "always
  populated" → Mitigation: doc comment on both fields states explicitly they are `None` outside a
  converse response.

## Planner Notes

- Confirmed via direct code research (not the ticket's own framing) that `HopBudgetExhausted` and
  the `Left`→`isError` tool-result path already exist — this ticket's real gap is the *wiring*
  (route → response → frontend) and *hardening* (thrown/failed-Future executor errors), not building
  the outcome types from scratch.
- Self-approved: telemetry is a new sibling capability/object, not a literal extension of
  `AuthoringTelemetry`/`authoring-error-telemetry` — those stay scoped to the older single-shot flow.
- **Design-gate round 1 REFUTE, both items addressed above (D4, D7):** (1) the plan's original
  "Impact: no schema/migration changes" line was wrong for the JSON Schema contract specifically —
  `schemas/assistant-conversation.schema.json` needs the 2 new optional properties, now D7 + tasks.md
  4.3 + proposal.md's Impact section. (2) D4 originally left the existing "propose anyway" sentence
  untouched next to a new clause, risking two unlinked absolute instructions on the same trigger —
  now the existing sentence itself is edited to become one explicit branch of a single conditional.
