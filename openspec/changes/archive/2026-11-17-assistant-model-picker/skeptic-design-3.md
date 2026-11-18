## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 5bd0e7f94b0dd1acc8cb515d2697de80ceb0fb03. The change dir is untracked and there are no code changes yet.
I took the owner rulings as given and did not re-open them: weights 1/4/8 (env-overridable, owner uncounted), the $2 cap stopping at a projected $1.50, and V140.

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/assistant-model-picker/HEL-1755`.
- Migrations: the last migration on HEAD and on a freshly fetched origin/main is V137, so V140 is free. V138 and V139 are reserved per C18.
- **Round-2 CR1 (picker with no conversation) is addressed.**
  - D8: `GET /api/assistant-models` now returns `defaultModel`, the caller's resolved default (the user default if selectable, else the server default). The client therefore does not derive the rule.
  - D10: with no conversation, the picker's value is `defaultModel`. A pick is held in the slice and sent as `model` on the first `converse` inside `startConversationWithMessage`. D3 already persists a validated request model in the same append. The palette `/chat` hand-off has no picker and uses the default, which is the create stamp from D4.
  - The spec scenario "Pick before the first message" was added, and tasks 4.5 and 5.7 cover it.
  - Ground truth: `startConversationWithMessage.ts` calls `createConversation({})` and then `converse({id, message, idempotencyKey})`. Adding `model` to that converse call is a local change. `create-assistant-conversation-request.schema.json` stays untouched, which is consistent because the model travels on converse.
- **The round-2 non-blocking notes are all adopted.**
  - D10 refetches `/api/assistant-models` and the active conversation after a Settings save.
  - Picking "Server default (<id>)" sends a `PATCH` with `model: null`.
  - The Settings clear option names the resolved server default.
  - Task 3.1 documents the per-turn `model` on transcript items.
- **Round-1 CRs 1 to 4 are still addressed** (re-read cold):
  - CR1: the shared `Select` and `FormField` are used, consumed and never edited (C20). `Select.tsx` takes `className` (line 24), so a compact composer variant needs no edit to `Select`.
  - CR2: all closed schemas are listed in 3.1 and in Impact.
  - CR3: `effectiveModel` follows one server-side rule, and catalog-defined is distinguished from selectable.
  - CR4: the fixtures are explicitly synthetic, D11 provides the real-API corroboration, every turn of the switch conversation uses a tool, and a per-hop thinking flag and `stop_reason` are recorded.
- The converse response is the `AssistantConversationResponse` (converse-request.schema.json description). D4 adds `model` and `effectiveModel` to it, so the picker sees the persisted pick right after the first send.
- The D5 claim holds. `ClaudeClient.scala:309` builds `ClaudeApiToolMessage(m.role, m.content...)`, so a new `ClaudeToolMessage.model` field never reaches the wire.
- The wire `model` is written in `ClaudeProtocol.scala:49,241`, from `r.model`. That matches D2's plan to substitute `spec.id`.
- AC coverage:

  | AC | Covered by |
  |---|---|
  | AC1 | 2.3, 2.4, 2.7, 4.2, 4.4, 4.5 |
  | AC2 | 2.5, 5.5 |
  | AC3 | 2.2, 5.6 |
  | AC4 | 5.1 (red first) |
  | AC5 | 5.4 + D11 |
  | AC6 | 5.9 |
  | AC7 | 5.8 |
  | AC8 | 3.2 |

- I found no placeholders, TODOs or TBDs. I found no contradiction between the proposal, design, tasks and spec deltas that would block implementation.

### Verdict: CONFIRM

### Non-blocking notes

- **D1 `allowsForcedToolChoice = true` for Haiku is dead data.** C17 and the spec say no catalog model ever gets a forced `tool_choice`, and the client never sends `tool_choice` at all. The executor should either drop the field or document it as informational only, so nobody later reads it as permission.
- **Task order.** Task 4.5 sits between 4.2 and 4.3. This is cosmetic only.
- **The idempotent replay of a converse that carries `model`** short-circuits before the append, so it persists nothing. That is correct, and a test should pin it alongside 5.1.
- **HEL-1740 must consume `ClaudeModelCatalog` rather than define its own allow-list.** This is still the driver's coordination job.
