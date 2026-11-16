## Context

`AssistantService.converse` (backend/src/main/scala/com/helio/services/assistant/AssistantService.scala) is the
only caller of `ClaudeClient.sendWithTools`. Today `seedHistory` (line 117) prepends `AssistantSystemPrompt.text`
to the new user turn only when `history` is empty, and `desanitizeFirstTurn` (line 227) rewrites turn 1 back to the
plain message in the returned `fullHistory`, which `AssistantConversationRoutes.converseFlow` slices
(`fullHistory.drop(history.length)`) and persists via `appendTurn`. Turn 2+ therefore carries no prompt.
`ClaudeToolRequest` (ClaudeModels.scala:153) and `ClaudeApiToolRequest` (ClaudeWireModels.scala:118) have no
`system` field; `claudeApiToolRequestFormat` (ClaudeProtocol.scala:206) writes model/max_tokens/messages/
temperature/tools only. `ClaudeClient.toApiToolRequest` marks the last custom tool and the first message's last
block with `cache_control`. `desanitizeFirstTurn` landed in the same commit as the converse route (65adba30d,
HEL-665), so no persisted transcript has ever stored the prompt.

## Goals / Non-Goals

**Goals:** the prompt in the API `system` field on every hop of every turn, byte-identical across turns; no message
and no persisted/rendered turn ever contains it; a red-on-main turn-2 test; a diff that HEL-1636 can absorb with
trivial, documented conflict resolutions.

**Non-Goals:** the non-tool `send`/`stream` path (`ClaudeRequest`, used by RefinementService/DashboardAuthoring
Service/AI steps); thinking-block persistence (HEL-1636); any live Anthropic call; any data migration.

## Decisions

**D1 Domain field.** `ClaudeToolRequest` gains `system: Option[String] = None` as its LAST parameter (HEL-1636 does
not touch this case class). `None` or an empty/blank string means "no system prompt".

**D2 Wire field.** `ClaudeApiToolRequest` gains `system: Seq[ClaudeApiContentBlock] = Seq.empty`, reusing the
existing text-block wire type (it already serializes `text` + optional `cache_control`). Insert the parameter
immediately after `maxTokens: Int,` (NOT after `tools`): HEL-1636 rewrites the `temperature` line, and an insertion
adjacent to it would conflict. All construction sites use named arguments (verified: the only test site,
HttpClaudeTransportSpec.scala:39, is named).

**D3 Serialization.** `claudeApiToolRequestFormat.write` emits `"system" -> JsArray(blocks)` only when `system` is
non-empty; with no system the JSON is byte-identical to today (no `system` key). Keep the conditional in ONE
private helper, `systemField(r.system): Map[String, JsValue]` (or equivalent `Option` pair), appended to the
object's fields, so the HEL-1636 resolution is a single `++ systemField(r.system)` append.

**D4 Client mapping and cache breakpoint.** `toApiToolRequest` builds
`system = request.system.filter(_.trim.nonEmpty).toSeq.map(s => ClaudeApiContentBlock(blockType = "text",
text = Some(s), cacheControl = Some(ClaudeApiCacheControl.Ephemeral)))`. Pass it as the FIRST named argument of
the `ClaudeApiToolRequest(...)` construction (inserted right after the opening line), so it is not adjacent to the
`temperature =` line HEL-1636 rewrites. Breakpoints become: last custom tool, system block, first message's last
block (3 of the API's 4 allowed). The prefix order tools -> system -> messages makes tools+system a stable cached
prefix across turns. The first-message marker stays (HEL-1636 keeps it too); it is now just a later breakpoint.

**D5 Guardrail.** `guardrailRejectTool` counts the system prompt on every hop: estimate
`flattenForEstimate(history)` prefixed with a `ClaudeMessage(ClaudeRole.User, system)` when present (the estimator
is a heuristic over `Seq[ClaudeMessage]`; this preserves today's turn-1 count, which included the folded prompt).
Change its signature to take the system text. This keeps turn-1 guardrail behaviour equal to today's and makes
turns 2+ honest.

**D6 AssistantService.** `converse` sets `system = Some(AssistantSystemPrompt.text)` on every call. `seedHistory`
no longer folds anything: the new turn's trailing block is always `Text(message)` (the dangling-tool_use handling
is unchanged). `desanitizeFirstTurn` and its two call sites are removed (nothing is folded, so there is nothing to
undo; keeping it would be dead code). `toTurnResult` keeps `history` (still needed by
`computeSearchedWithNoResults`) and drops `message` only if it becomes unused. Update the scaladoc that describes
the fold.

**D7 Legacy conversations.** Persisted transcripts already store turn 1 as the plain message (D-context), so a
legacy conversation simply starts receiving `system` on its next turn. No migration, no defensive stripping. The
executor SHALL re-verify this against `AssistantConversationRoutes.converseFlow`, `AssistantConversationService
.appendTurn`/the transcript store, and any other writer of assistant transcripts (grep), and record the finding.

**D8 Proof (red first).** Tests assert on the SERIALIZED JSON of the captured `ClaudeApiToolRequest`
(`claudeApiToolRequestFormat.write(req).asJsObject.fields.get("system")`), not on a new Scala field, so the
turn-2 test compiles on main and fails there. Required:
- AssistantServiceSpec: converse(empty) -> converse(returned history) through a capturing fake transport; turn 2's
  body has `system` == `[{"type":"text","text":AssistantSystemPrompt.text,"cache_control":{"type":"ephemeral"}}]`,
  equal to turn 1's; no `messages` entry contains the prompt; returned history never contains it; legacy-shaped
  history case.
- AssistantConversationRoutesSpec (seam): two POSTs through the real route with a fake transport, then GET the
  conversation: the second captured wire body carries `system`; no persisted turn contains the prompt.
- ClaudeProtocolSpec/ClaudeClientSpec: no `system` key when absent (byte-identical); marker on the system block;
  every hop of a two-hop loop carries the same `system`; guardrail counts `system`.
Red evidence: run the turn-2 AssistantServiceSpec and route tests against the unfixed main code (e.g. stash the
main-code change, keep the tests) and record the failing output in `evidence/red-first.md`.

## Merge recipe for HEL-1636

HEL-1636 (`bug/assistant-thinking-block-roundtrip/HEL-1636`) does not thread `system`. Expected conflicts when it
merges main after this lands, and their resolutions:
1. `ClaudeProtocol.claudeApiToolRequestFormat.write`: take HEL-1636's `Map(...) ++ r.temperature.map(...)` form and
   append `++ systemField(r.system)` (D3).
2. `ClaudeClient`: HEL-1636 splits `toApiToolRequest` into `prepareHop`/`buildTools`/`toApiToolRequest(request,
   messages, finalTools)`. Keep HEL-1636's structure; re-add the `system = ...` first argument (D4) to its
   `ClaudeApiToolRequest(...)` construction. Its `guardrailRejectTool(history)` call in `loop` becomes
   `guardrailRejectTool(request.system, history)` (D5 signature). Its `flattenForEstimate` new cases are
   independent of D5.
3. `AssistantService.toTurnResult`: HEL-1636 changes `desanitizeFirstTurn(fullHistory, ...)` to
   `desanitizeFirstTurn(persistable(fullHistory), ...)`; this change deletes `desanitizeFirstTurn`. Resolve to
   `persistable(fullHistory)`.
4. `ClaudeWireModels.ClaudeApiToolRequest`: no conflict expected (D2 placement). HEL-1636's prefix-change strip
   check compares `tools` JSON only; `system` is constant within a loop, so no change is needed there.
HEL-1636's spec deltas only ADD requirements, so this change's MODIFIED cache-breakpoint requirement does not
collide at archive time.

## Risks / Trade-offs

- Prompt-cache shape changes once (system block becomes a breakpoint): a one-time cache miss after deploy.
- The guardrail now counts the prompt on turns 2+, so a very long conversation hits `GuardrailExceeded` slightly
  earlier than today. That is the honest estimate of what is sent.
- No live verification (expired key): the wire shape follows the Messages API's documented `system` array of text
  blocks with `cache_control`; the seam tests prove what is sent, not what Anthropic accepts.

## Planner Notes

Self-approved: D1-D8, keeping the first-message breakpoint, and no live check (the wire format is the documented
public API shape, and the AC asks for a test, not a live call).
