# Legacy transcript verification (task 2.3, design D7)

Question: could any persisted assistant transcript contain the folded system prompt?

Writers of assistant transcripts (grep for `appendTurn` / transcript writes under backend/src/main):
1. `AssistantConversationRoutes.converseFlow` -> `service.appendTurn(user, id, newTurns, idempotencyKey)`, where
   `newTurns = result.fullHistory.drop(history.length)` and `fullHistory` came from `AssistantService.toTurnResult`.
   On unfixed main that value went through `desanitizeFirstTurn`, which rewrote turn 1 back to the plain message.
2. `AssistantConversationRoutes` `POST .../messages` -> `service.appendTurn(user, id, request.turns...)`: client-supplied
   turns, never produced by `AssistantService`; it has no access to the prompt.
3. `RefinementConversationTurns` / `AuthoringConversationTurns` write different tables (refinement/authoring
   conversations), and never use `AssistantSystemPrompt` (only AssistantService references it; grep of
   `AssistantSystemPrompt` in backend/src/main hits only AssistantService, AssistantSystemPrompt, AssistantProtocol (a doc comment) and README).

History: `git show 65adba30d` (HEL-665, the commit that added the converse route) contains `desanitizeFirstTurn`, and
`AssistantService` has folded the prompt only inside `seedHistory` (outbound request) since. So no persisted transcript
ever stored the prompt; turn 1 is the plain user message. A legacy conversation therefore starts receiving `system` on
its next turn with no migration, covered by the "legacy conversation" test in AssistantServiceSpec.
