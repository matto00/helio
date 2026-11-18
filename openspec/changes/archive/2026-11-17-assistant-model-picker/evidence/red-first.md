# Red-first and mutation record (HEL-1755)

The tests were written against the implementation, so each proof is shown red by applying a one-line mutation
that restores the pre-fix behaviour (or breaks the guard), running the spec, and reverting. Every mutation was
reverted; the green runs are in the gate output. Runner: `sbt testOnly <spec>` (backend, `nice -n 19`).

| # | Mutation (one line) | Spec | Result |
|---|---|---|---|
| 5.1 | `AssistantModelPolicy.validate` falls back to the first selectable model instead of rejecting (the pre-fix behaviour: an unknown `model` is ignored and the call proceeds) | `AssistantModelSelectionRoutesSpec` | 3 FAILED: `200 OK was not equal to 400 Bad Request` (converse, PATCH, trailing-space id) |
| 5.3 | `ClaudeClient.wireTemperature` drops the catalog guard (`isCatalogId`) | `ClaudeModelRequestSpec` | 5 FAILED: `Some(0.2) was not equal to None` (3 catalog ids, catalog config default, non-tool `send`) |
| 5.4 | `AssistantService.persistable` keeps `Thinking`/`RedactedThinking` blocks | `AssistantModelSwitchSpec` | 9 FAILED: turn 2's first request carries a thinking block (`true was not equal to false`), 400 from the fake for every pair |
| 5.5 | route charges weight 1 regardless of model (`checkConverseCap(..., 1, ...)`) | `AssistantModelSelectionRoutesSpec` | 3 FAILED: `2 was not equal to 5` (Sonnet), `1 was not equal to 8` (narrowed-out Opus default), Opus not denied with 3 units left (`200 OK was not equal to 429`) |
| 5.6 | `.copy(model = None)` removed from create/`/messages` | `AssistantModelSelectionRoutesSpec` | 1 FAILED: `Vector(Some("claude-opus-5-5")) was not equal to Vector(None)` |
| skeptic (b) | replay short-circuit disabled (`if false =>`) so a replay becomes a real send | `AssistantModelSelectionRoutesSpec` | 1 FAILED: the fake transport saw 2 requests instead of 1 |

The 5.4 fake is itself guarded by a positive control in the same spec (a request holding another model's thinking
block yields `Failed`), so a fake that never rejects cannot pass silently.

## Frontend (jest, `npx jest --maxWorkers=3 <spec>`)

| # | Mutation (one line) | Spec | Result |
|---|---|---|---|
| F1 | `startConversationWithMessage` drops the pending pick (`model: undefined`) | `ModelPicker.test.tsx` | 1 FAILED: the first converse is not called with `claude-opus-5-5` |
| F2 | a rejected model PATCH no longer restores the previous model | `assistantConversationsSlice.test.ts` | 1 FAILED: `restores the previous values and records the error on rejection` |
| F3 | a Settings save no longer refetches the open conversation | `AssistantModelSection.test.tsx` | 1 FAILED: `saves a pick, then refetches the model list and the open conversation` |
| F4 | `answerGroupModels` labels every assistant text block instead of the closing one | `answerModels.test.ts` | 1 FAILED: `labels only the closing text block when the assistant also spoke before its tool call` (the first version of this test did not catch a split-at-tool-result mutation; the added case is the one that fails) |

## Cycle 2 (evaluation-1 CR1/CR2): the remaining guards

Same method: one-line mutation, run the spec, revert. Backend specs via `sbt testOnly`, frontend via `jest`.

| # | Mutation | Spec | Result |
|---|---|---|---|
| a | converse route stamps no model on new turns (`m.copy(model = None)`) | `AssistantModelSelectionRoutesSpec` | 3 FAILED: `Vector(None, None) was not equal to Vector(None, Some("claude-haiku-5-5"))`, the two-model sequence, and the non-catalog server default stamp |
| b | create route drops the user-default stamp (`stamped = None`) | same | 1 FAILED: `null was not equal to "claude-sonnet-5-5"` |
| c | `AssistantModelPolicy.effective` stops filtering a stored model by `isSelectable` | same | 1 FAILED: `"claude-sonnet-5-5" was not equal to "claude-haiku-5-5"` |
| d1 | weight SQL reverted to `message_count < $limit` | `AssistantDailyUsageRepositorySpec` | 2 FAILED: heavy weight allowed with 3 units left (`true was not equal to false`), concurrent weighted `3 was not equal to 2` |
| d2 | `weight > limit` short-circuit removed | same | 1 FAILED: first-send over-limit weight allowed |
| e1 | preferences route accepts any string for `assistantModel` | `UserPreferencesRoutesSpec` | 1 FAILED: `200 OK was not equal to 400 Bad Request` |
| e2 | preferences read keeps a non-selectable id | same | 1 FAILED: `Some("claude-fable-5-2") was not equal to None` |
| f1 | `CLAUDE_SELECTABLE_MODELS` ignored | `ClaudeModelCatalogSpec` | 2 FAILED (narrowing, narrowed-out model keeps rules) |
| f2 | weight `>= 1` filter dropped | same | 1 FAILED: `0 was not equal to 1` |
| g | response `model` decode dropped | `ClaudeModelRequestSpec` | 1 FAILED: `None was not equal to Some("claude-haiku-5-5")` |
| g2 | mismatch WARN removed | same | 1 FAILED: the WARN-once test |
| h1 | `composerPickerModel` never offers the server-default option | `modelOptions.test.ts`, `ModelPicker.test.tsx` | 4 FAILED |
| h2 | transcript label never passed to `MessageTurn` | `ActiveConversationPanel.test.tsx` | 1 FAILED |
| h3 | Settings sends the sentinel instead of `null` | `AssistantModelSection.test.tsx` | 1 FAILED |
| ev | `modelError` survives `selectConversation.pending` | `assistantConversationsSlice.test.ts` | 1 FAILED |

### CR2 (the clear option must not promise a model the server will not use)

Fix: `composerPickerModel` now offers "Server default (<id>)" only when a clear resolves to a model that is not itself
selectable, i.e. `defaultModel` (the saved default if any, else the server default) is not in the list. With a saved
default the option is gone (pick that model explicitly), so the picker can no longer snap back from a promised model.
The optimistic value of a clear is now `defaultModel.id`. Red: gating on `serverDefault` instead (the cycle-1
behaviour) fails 3 tests (`never offers a 'Server default' option that a saved default would override`, `offers exactly
the selectable options when a clear would resolve to a selectable default`, `offers no 'Server default' option when
the user's saved default overrides it`).
Equivalent mutant, not recorded as red: replacing `defaultModel.id` by `serverDefault.id` in the optimistic value of
`ModelPicker.onChange` cannot be told apart, because the option now exists only when `defaultModel` is not selectable,
and then `defaultModel` equals the server default by construction.
