## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 2f97736e8f4f1a50bbf134cdfb1f607c9d868927. Base resolved live with resolve-review-base.sh (main, origin): fd7064f7d700e49a2f7dfc1f6a244aab02048fd2. Commits: 7034acfcf, 2f97736e8.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/assistant-system-prompt-every-turn/HEL-1718`.
- **Diff read in full** (`git diff $BASE_SHA...HEAD -- backend/src`). Main-code changes:
  - `ClaudeModels.scala`: `ClaudeToolRequest.system: Option[String] = None` is the last parameter (D1).
  - `ClaudeWireModels.scala:121`: `system: Seq[ClaudeApiContentBlock] = Seq.empty`, placed after `maxTokens` (D2).
  - `ClaudeProtocol.scala`: the `systemField` helper emits `system` only when the list is non-empty (D3).
  - `ClaudeClient.scala:253`: builds a blank-filtered text block with an ephemeral `cache_control`. It is the first named argument (D4).
  - `ClaudeClient.scala:282`: `guardrailRejectTool(system, history)` counts the system prompt on every hop (D5).
  - `AssistantService.scala:90`: `system = Some(AssistantSystemPrompt.text)` on every call. The fold in `seedHistory` is removed, and so are `desanitizeFirstTurn` and both of its call sites (D6).
  - Every other `ClaudeApiToolRequest(` construction uses named arguments (grep: `HttpClaudeTransportSpec.scala:39`, `ClaudeProtocolSpec`), so the parameter insertion in the middle of the list is safe.
  - `AssistantSystemPrompt` is referenced in backend/src/main only by AssistantService, its own file, a doc comment and a README. No frontend reference.
- **AC1 (system prompt on every turn, in a stable position, in the API `system` field):** traced to `AssistantService.scala:90` and the `ClaudeClient.toApiToolRequest` mapping.
  - AssistantServiceSpec's turn-2 test asserts on the serialized wire JSON: `systemOf(req2) == systemOf(req1) == expectedSystem`, which includes `cache_control`.
  - The multi-hop test and ClaudeClientSpec's two-hop test show the same block on every hop.
  - Cache prefix order is tools, then system, then messages. ClaudeClientSpec asserts exactly 3 `cache_control` markers, which is within the API's limit of 4.
- **AC2 (transcript and UI never show the prompt):**
  - `seedHistory` now appends `Text(message)` only.
  - The route seam test sends two POSTs, then a GET. It asserts the body does not include `Worked examples` (a phrase that appears exactly once in AssistantSystemPrompt.scala, confirmed by grep -c = 1), that the transcript has 4 turns, and that turn 1 is `Text("First")`.
  - The message checks use the JSON-escaped prompt, so they can fail. The executor and the evaluator each ran a re-fold mutation that produced 4 failures. I did not repeat it.
  - I read `evidence/legacy-transcripts.md`. Its claim is consistent with what the diff removes: `desanitizeFirstTurn` was the only path to persistence, so no stored transcript holds the prompt, and no migration is needed.
- **AC3 (turn-2 test that fails on current main):**
  - The turn-2 test only uses `ClaudeProtocol.claudeApiToolRequestFormat` and a test-local helper, so it compiles on main.
  - On main, the format writes no `system` key: the removed lines in the diff show the 5-key `JsObject`. `systemOf(req1) shouldBe Some(...)` therefore gets `None` and fails. This matches the recorded red output in `evidence/red-first.md` (`None was not equal to Some([...])`, 5 TESTS FAILED). This is deductive corroboration of the recorded run. I did not re-run on main.
- **Fresh gate run (mine):**
  - Command: `nice -n 19 sbt -J-Xmx3g testOnly` on AssistantServiceSpec, AssistantConversationRoutesSpec, ClaudeClientSpec, ClaudeProtocolSpec, HttpClaudeTransportSpec and AssistantSystemPromptSpec.
  - Summary: `Tests: succeeded 116, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed.`
  - All HEL-1718 tests appear by name in the log.
  - I did not re-run full testFull. The evaluator ran it on 7034acfcf (9493 passed), and 7034acfcf..HEAD changes no main code.
- **HEL-1636 merge recipe (design.md):**
  - Checked read-only with `git merge-tree --write-tree --name-only HEAD bug/assistant-thinking-block-roundtrip/HEL-1636`. The branch was not checked out or modified.
  - Conflicts appear in exactly ClaudeClient.scala, ClaudeProtocol.scala and AssistantService.scala, which are recipe items 1-3.
  - The `system = ...` argument and the new guardrail signature auto-merge into HEL-1636's restructured client (trial tree lines 326 and 362). Only the `loop` guardrail call needs manual resolution.
  - HEL-1636's content-block writer keeps a `case "text"` branch, so the system block still serializes after the merge.
  - The recipe is accurate.
- **Spec deltas:** MODIFIED cache-breakpoint requirement plus ADDED system-field and every-turn requirements. Each scenario matches a test.
- **UI review:** N/A, since this is a backend-only change (no `frontend/**` in the diff).

### Verdict: CONFIRM

### Non-blocking notes
- Running the guardrail estimate on the system prompt as a separate `ClaudeMessage` may add a small per-message overhead compared with the old folded estimate on turn 1. This is negligible and errs on the safe side.
- Not live-verified against Anthropic (the key is expired). The wire shape is the documented `system` text-block array. The first prod turn after deploy is the real check.
