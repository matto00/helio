## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 5bd0e7f94b0dd1acc8cb515d2697de80ceb0fb03. The change dir is untracked and there are no code changes yet.
I took the owner rulings as given and did not re-open them: weights 1/4/8 (env-overridable, owner uncounted), the $2 cap stopping at a projected $1.50, and V140.

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/assistant-model-picker/HEL-1755`.
- Round-1 CR1 (shared `Select`) is addressed. D10, C20 and tasks 4.2/4.4 now use `shared/ui/Select.tsx`, plus `FormField` in Settings. The `Select` is consumed, not edited. C19 is retired in workflow-state.md.
- Round-1 CR2 (closed schemas) is addressed. Task 3.1 and the proposal's Impact now list `assistant-conversation-summary`, `update-assistant-conversation-request`, `auth/user-preferences` and `auth/update-user-preferences-request`. All six `schemas/assistant/*.json` have top-level `additionalProperties: false`. `assistant-conversation.schema.json` transcript items are open objects, so a per-turn `model` does not break that contract. It should still be documented under 3.1.
- Round-1 CR3 (null or unusable stored model) is addressed **for an existing conversation**:
  - D3 gives one rule: stored if selectable, else user default if selectable, else server default.
  - It separates catalog-defined from selectable.
  - D4 adds `effectiveModel` to the summary and detail responses.
  - D10 defines how a non-selectable effective model renders ("Server default (<id>)").
  - The spec has a "Stored model no longer selectable falls through" scenario, and task 5.6 covers it.
- Round-1 CR4 is addressed:
  - D6 now says the fixtures are synthetic and names D11 as the real-API corroboration.
  - D11 and task 5.9 require every turn of the Haiku -> Opus -> Haiku conversation to use a tool.
  - The live check records a per-hop thinking-present flag and `stop_reason`.
- The round-1 non-blocking notes are adopted:
  - The INFO line is logged after the body is parsed (D2).
  - Client-supplied turn `model` is stripped (D5).
  - Catalog-defined vs selectable is now explicit (D3).
- Tier-gated spec delta: the live spec (`openspec/specs/tier-gated-assistant-access/spec.md`) has 5 scenarios under "Beta-tier message sends are capped per day". The MODIFIED delta keeps all 5 with weight-aware wording and adds "A heavier model is denied while a lighter one still fits".
- Migrations: the last one on HEAD and on origin/main (fetched) is V137, so V140 is free.
- Composer null-conversation path (ground truth):
  - `ActiveConversationPanel.tsx:264` renders `<MessageComposer conversationId={effectiveId}>`, and `effectiveId` can be `null`.
  - `MessageComposer`'s null branch and the palette `/chat` hand-off both use `startConversationWithMessage.ts:28`. It calls `createConversation({})` and then `converse({id, message, idempotencyKey})`.
  - `create-assistant-conversation-request.schema.json` is closed (title, firstMessage).
  - This is the basis for CR1 below.
- AC coverage:

  | AC | Covered by |
  |---|---|
  | AC1 | 2.3, 2.4, 2.7, 4.x |
  | AC2 | 2.5, 5.5 |
  | AC3 | 2.2 |
  | AC4 | 5.1 (red first) |
  | AC5 | 5.4 + D11 |
  | AC6 | 5.9 |
  | AC7 | 5.8 |
  | AC8 | 3.2 |

- I found no placeholders, TODOs or TBDs.

### Verdict: REFUTE

### Change Requests

1. **D10 / tasks 4.2 and 5.7 do not cover the picker when no conversation exists yet.** This is the most common way a chat starts.
   - The composer is rendered with `conversationId === null` on an empty `/chat` and after a fresh start. The palette `/chat` auto-send takes the same path.
   - D10 defines the picker's value as the conversation's `effectiveModel`, and a pick as a `PATCH` on the conversation. With no conversation there is neither an `effectiveModel` nor anything to `PATCH`.
   - A competent implementer could therefore do any of these: hide the picker, disable it, or show a locally derived value and drop the pick. If the pick is dropped, a user who chose Opus before their first message gets the default model silently. That contradicts AC1's "a conversation keeps its pick".
   - Deriving the value locally from `serverDefault` (D8) plus `preferences.assistantModel` would also contradict D4's stated goal that "the client never re-derives the rule".

   Specify the null-conversation behaviour in D10 and in the spec's composer requirement. Add a test for it in 5.7. That means:
   - **What the picker shows.** For example: the user default if selectable, else `serverDefault`, from `GET /api/assistant-models` (or have that endpoint return the user's resolved default, so the client still does not derive the rule).
   - **Where the pick goes.** Either it is held locally and sent as `model` on the first `converse` in `startConversationWithMessage` (D3 already persists a request model), or it is sent on `createConversation`. The second option means adding `model` to `create-assistant-conversation-request.schema.json`, task 3.1 and the proposal's Impact.
   - **The palette `/chat` hand-off.** Say whether it uses the default.

### Non-blocking notes

- **Stale `effectiveModel` after a Settings change.** A conversation with a null stored `model` resolves through the user default. When the default changes in Settings, any `effectiveModel` already in the slice is stale until a refetch, and the picker shows the old default while the server sends on the new one. Refetch or invalidate on a preference save, or state that the next converse response corrects it.
- **The "Server default (<id>)" option when picked.** Say whether picking it `PATCH`es `model: null`. Note that `null` resolves to the user default if one is set, not necessarily to the server default.
- **Settings "Server default" option label.** Consider naming the model it resolves to (from `serverDefault.label`/`id`) so the user knows what "clear" means.
- **Per-turn `model` in the schema.** Task 3.1 should also document the per-turn `model` in the description of `assistant-conversation.schema.json`'s transcript items. The items are open objects, so this is not a contract violation, but the contract should say so.
- **HEL-1740 coordination is still the driver's.** The insight `model` key must validate against `ClaudeModelCatalog`.
