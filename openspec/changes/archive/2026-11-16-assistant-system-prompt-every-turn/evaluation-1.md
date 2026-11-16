## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 7034acfcff63fb9e065938990b949d9296fbf5b3. Diff base: fd7064f7d700e49a2f7dfc1f6a244aab02048fd2, resolved live with resolve-review-base.sh.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (system prompt on every turn, in a fixed position): met. `ClaudeToolRequest.system` maps to a top-level `system` array with one cache-marked text block (ClaudeClient.scala:253-255). `AssistantService.converse` sets it on every call. The seam and service tests check that turn 2's `system` equals turn 1's.
- AC2 (prompt never in the persisted or rendered transcript): met. The fold is removed (`seedHistory` always appends `Text(message)`), and `desanitizeFirstTurn` is deleted. The route seam test reads the transcript back and checks it.
- AC3 (turn-2 test that fails on main): met and independently verified (see Phase 2).
- D2 and D4 placement (C7) are as specified: wire `system` comes after `maxTokens`, and the client passes `system =` as the first named argument. I checked the merge recipe against the HEL-1636 branch, read only. Its `claudeApiToolRequestFormat` uses the `Map(...) ++ r.temperature.map(...)` form, the `ClaudeApiToolRequest(...)` construction is at line 304, `guardrailRejectTool(history)` is at line 103, and `desanitizeFirstTurn(persistable(fullHistory), ...)` is at lines 162 and 177. The recipe matches.
- The spec deltas are consistent. The MODIFIED cache-breakpoint requirement keeps all three canonical scenarios. No canonical requirement describes the old fold, so nothing is left contradicting the change.
- I re-checked the D7 legacy-transcript finding (evidence/legacy-transcripts.md). It is consistent with the code.
- All CONSTRAINTS C1-C7 are honored. No .env was read, and the HEL-1636 branch was only read.

### Phase 2: Code Review — FAIL
Gates, run fresh by the evaluator:
- `sbt -J-Xmx3g testFull` in WORKTREE_PATH: `Tests: succeeded 9493, failed 0, canceled 5` and `All tests passed.` The 5 cancels are the opt-in HELIO_MEASURE perf specs, which are not related to this change. All of this change's new tests appear in the log.
- `npm run check:scala-quality`, `check:openspec`, `check:spec-structure`, `check:no-credential-leak` and `format:check` all pass. No frontend files changed, so lint, jest and build do not apply.

Independent red-first check: I created a throwaway detached worktree at the base SHA and copied in only the new AssistantServiceSpec and AssistantConversationRoutesSpec from HEAD. Running `testOnly` on those two specs compiled 748 test sources fresh, so the result was not replayed from cache. It gave `Tests: succeeded 36, failed 5`, with the same 5 failures listed in evidence/red-first.md. The turn-2, multi-hop and legacy tests fail on `None was not equal to Some([...system...])`, and the route seam test fails on the missing `system`. The red-first claim holds. The throwaway worktree has been removed.

Issues:
1. **A test assertion that can never fail (tests meaningful).** AssistantServiceSpec.scala, in the turn-2 test (`messagesJson(req1)` / `messagesJson(req2) should not include AssistantSystemPrompt.text`) and in the legacy test (`messagesJson(req) should not include AssistantSystemPrompt.text`):
   - `messagesJson` returns `compactPrint` JSON.
   - `AssistantSystemPrompt.text` contains newlines and double quotes (AssistantSystemPrompt.scala:36-40 and others).
   - In the JSON those characters are escaped (`\n`, `\"`), so the raw prompt can never appear as a substring, whether or not the prompt is in a message.
   - Probe: in the base-SHA throwaway worktree, where the prompt IS folded into message 1, I deleted the `systemOf` lines so execution reached these assertions. `messagesJson(req1) should not include AssistantSystemPrompt.text` PASSED, and the same run printed `req1 messages JSON contains escaped prompt head: true`. The assertion is vacuous.

   This is the exact check task 3.1 asks for ("no message (search the whole serialized `messages` JSON, any block type) ... contains the prompt"). Task 3.1 is marked done, but at the service level this property is not proven. The route seam test's `"Worked examples"` probe is not vacuous, but it is the only real guard of the property. The ClaudeClientSpec test is fine because it uses `SYSPROMPT-XYZ`, which has no characters to escape.

No other issues. The code is small and DRY: one `systemField` helper, and the blank-check `filter(_.trim.nonEmpty)` appears in two places, which is acceptable. Typing is sound, no dead code is left after removing `desanitizeFirstTurn`, and the scaladoc is updated.

### Phase 3: UI Review — N/A
Changed files are under `backend/src/**` and `openspec/changes/**` only. None of the Phase 3 triggers match: `frontend/**`, `ApiRoutes.scala`, `schemas/**` and `openspec/specs/**` are all untouched.

### Overall: FAIL

### Change Requests
1. backend/src/test/scala/com/helio/services/assistant/AssistantServiceSpec.scala: make the "never in any message" assertions able to fail. Compare against the JSON-escaped form of the prompt, for example `val escapedPrompt = JsString(AssistantSystemPrompt.text).compactPrint.drop(1).dropRight(1)` and then `messagesJson(r) should not include escapedPrompt`. Alternatively, use a distinctive substring that has no escapable characters, as the route spec does with `"Worked examples"`. Apply this to `req1` and `req2` in the turn-2 test and to `req` in the legacy test. Show that the fixed assertion actually fails: for example, add one line to evidence/red-first.md showing it FAILS on the base SHA once the `systemOf` assertions ahead of it are bypassed.

### Non-blocking Suggestions
- ClaudeClientSpec "send the same marked system block on every hop": the comment says "nothing else" carries a breakpoint, and the spec scenario says "no other element carries one", but the test asserts only the three markers that should be present. Consider also asserting that no other message block or tool carries `cache_control`.
