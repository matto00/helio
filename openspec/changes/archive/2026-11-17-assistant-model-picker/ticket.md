# HEL-1755: Assistant model picker: choose Haiku 5.5, Sonnet 5.5 or Opus 5.5 per conversation, with a default in Settings

## Description

The owner wants to test the latest models from the chat UI, the way other chat apps allow, instead of redeploying with a new `CLAUDE_MODEL`. Today the server uses a single `CLAUDE_MODEL`, and prod pins `claude-haiku-5-5` (HEL-1636).

### Owner rulings (2026-11-17)

* Models: Haiku 5.5 (`claude-haiku-5-5`), Sonnet 5.5 (`claude-sonnet-5-5`) and Opus 5.5 (`claude-opus-5-5`). No Fable for now.
* Who: owner and beta tiers. Free tier has no chat, so nothing changes there.
* Persistence: stored per conversation, plus a per-user default model setting in Settings. A new conversation starts on the user's default, or the server default if the user hasn't set one.
* Scope: assistant chat (this ticket) and insights. Insights are handled in the HEL-921 leaves (HEL-1740 L1 `model` config key, HEL-1743 L4 render uses it, HEL-1744 L5 editor field). Keep the allow-list in one place that both surfaces read.

### What

* Picker: a model control in the assistant composer, similar to other chat apps, showing the current model. Changing it applies to the conversation from the next turn on.
* Turn record: every assistant turn stores the model that answered it, so answers can be compared. The transcript shows it subtly.
* Default model: a Settings field for the user's default. A user with none set gets the server default (`CLAUDE_MODEL`).
* Server allow-list: the server validates the model id against an allow-list held in config. Any other value is a 400. Never pass a client string through to the API.
* Per-model request shape: follow what HEL-1636 established and the official model docs: temperature, top_p and top_k omitted where a model rejects them; thinking mode set per model; the thinking-signature round trip kept within the tool loop. Switching model mid-conversation must not send a thinking block made by another model. Verify against the docs; HEL-1636 drops persisted thinking from stored history.
* Cost on beta: beta users are capped only by message count (`HELIO_BETA_DAILY_MESSAGE_LIMIT`), so an Opus turn costs the same cap as a Haiku turn. The design must propose a cost weighting and escalate it to the owner before building. Options include a per-model weight on the daily counter, Opus restricted to owner tier, or a separate Opus sub-cap.
* MCP / API: the converse request accepts an optional model. Update the schema and contract.

Agent notes: default model trap: the code default is `claude-opus-4-8` (`ClaudeConfig.scala:37`); pin each live check explicitly. Key files: `AssistantService.converse`, `ClaudeClient`, `ClaudeConfig`, `ChatAccessService`, `UserTierConfig`, the assistant composer UI, and the Settings page.

## Acceptance criteria

- [ ] The owner can pick each of the three models; a conversation keeps its pick; Settings sets the default for new conversations.
- [ ] A beta user can pick, under the owner-approved cost rule.
- [ ] Each assistant turn records its model.
- [ ] A model id outside the allow-list gets a 400. This test fails first.
- [ ] Switching models mid-conversation (Haiku to Opus, and Opus to Haiku) with tool use and thinking never produces an API 400. Prove it with recorded-fixture tests per model pair.
- [ ] Live check: one short tool-using turn per model, after the owner OKs a dollar cap in the design. Assert the model id from the response before counting it.
- [ ] UI checked against the running app in light and dark, on desktop and phone (the composer).
- [ ] CLAUDE.md's `CLAUDE_MODEL` row is updated: it becomes the server default, overridable per conversation.
