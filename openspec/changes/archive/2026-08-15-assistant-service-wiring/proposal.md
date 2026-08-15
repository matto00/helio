## Why

HEL-660 (Claude tool-use loop) and HEL-661 (find/get_resource tools) are both merged but have no
caller yet. HEL-659's top-level assistant needs one entry point that runs Claude's bounded tool-use
loop against the full tool set (`find`, `get_resource`, `propose_dashboard`, `propose_pipeline`,
`propose_combined`, `propose_patch_set`), so a user's goal can be answered by searching the
workspace and proposing whichever kind of change fits — a dashboard from existing data, a new
pipeline when none exists, or a patch to something already built — without ever mutating the
workspace itself mid-conversation.

## What Changes

- Add `AssistantService.converse(history, message, user)`: builds the static system prompt + tool set,
  calls `ClaudeClient.sendWithTools` with `maxHops = 3` (HEL-660's caller-supplied cap, finally
  given its concrete value), and returns a structured result (final text + an optional structured
  proposal extracted from the last successful `propose_*` tool call, not just prose).
- Add `AssistantToolExecutor` (`ClaudeToolExecutor`): dispatches `find`/`get_resource` to
  `WorkspaceSearchService` (HEL-661), and `propose_dashboard`/`propose_pipeline`/`propose_combined`/
  `propose_patch_set` to the corresponding existing proposal service's **non-mutating** validation
  path — never `apply`.
- **New**: `PipelineProposalService.validate` and `CombinedProposalService.validate` — non-mutating
  structural + reference validation, mirroring `DashboardProposalService.validate`'s existing shape
  and doc-comment framing exactly ("no side effects, nothing created either way"). Required because
  today only `DashboardProposalService` has a non-mutating entry point; `PipelineProposalService`/
  `CombinedProposalService` expose only a mutating `apply`, which a `propose_*` tool must never call.
  `propose_patch_set` needs no new method — `PatchSetPreviewService.preview` (HEL-408) is already
  public and non-mutating.
- Add a static system prompt (`AssistantSystemPrompt`): role, tool descriptions, the 3-hop cap
  stated explicitly, the propose-never-apply boundary — carrying forward HEL-401's guardrail
  wording, not reinventing it.
- Add `AssistantStreamEvent` (protocol-layer sealed trait only, mirroring `AuthoringStreamEvent`'s
  shape): new event kinds for tool-call-started/finished and a structured-proposal result, so a
  future streaming route has a target shape to build against. **No live route, no SSE wiring, no
  frontend changes in this ticket** — `converse` is buffered-only here; a streaming variant and any
  route/DI wiring are left to whichever later ticket needs a live endpoint (consistent with HEL-661
  shipping `WorkspaceSearchService` fully tested with zero route wiring).
- `DashboardAuthoringService`/`DashboardAuthoringRoutes`/`AuthoringChatDrawer` are **untouched** —
  retiring them is explicitly HEL-666's job ("single global entry point, retires
  AuthoringChatDrawer"), not this ticket's.
- Conversation persistence (Postgres + GCS transcript storage) is explicitly **not** built here —
  HEL-663's job. `converse` takes an explicit, caller-supplied message history parameter rather than
  its own DB-backed lookup, so HEL-663 can slot a real history-loading step in front of this
  ticket's loop mechanics unchanged.

## Capabilities

### New Capabilities

- `assistant-conversation-loop`: `AssistantService.converse`, the bounded 6-tool loop, the
  propose-never-apply enforcement, and the static system prompt.

### Modified Capabilities

- `pipeline-proposal-apply`: adds a non-mutating `validate` requirement alongside the existing
  atomic `apply` requirement.
- `combined-proposal-apply`: adds a non-mutating `validate` requirement alongside the existing
  atomic `apply` requirement.

## Impact

- `backend/src/main/scala/com/helio/services/`: new `AssistantService.scala`,
  `AssistantToolExecutor.scala`, `AssistantSystemPrompt.scala`; `PipelineProposalService.scala`,
  `CombinedProposalService.scala` gain a `validate` method each.
- `backend/src/main/scala/com/helio/api/protocols/`: new `AssistantProtocol.scala` (turn
  result/proposal wrapper types, `AssistantStreamEvent`, `propose_*` `ClaudeTool` schema
  definitions).
- No route/API surface; no schema/migration changes; no frontend changes.

## Non-goals

- No conversation persistence (HEL-663) — explicit caller-supplied history parameter instead.
- No live streaming route or frontend wiring — `AssistantStreamEvent` is a defined shape only.
- No retirement of `DashboardAuthoringService`/`AuthoringChatDrawer` (HEL-666).
- No new mutation logic anywhere — every `propose_*` path is provably non-mutating.
