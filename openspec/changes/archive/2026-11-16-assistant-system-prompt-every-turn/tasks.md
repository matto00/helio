## Standing Constraints

- [C1] Never read/cat/grep/source/print any `.env` file; never run env-dumping commands (`env`, `printenv`, `sbt show Test/envVars`).
- [C2] Heredocs quoted only (`<<'EOF'`); no backticks or `$(...)` inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh.
- [C4] Resource caps: jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19; timeout 600000 on every test/hook call.
- [C5] sbt can exit 0 with "*** N TESTS FAILED ***": always read the test summary.
- [C6] No live Anthropic calls (expired key); never check out, modify or push the HEL-1636 branch.
- [C7] Place new parameters/arguments exactly as design.md D2/D4 say, to keep HEL-1636's merge conflict minimal.

### Backend

## 1. Wire and client

- [x] 1.1 Add `system: Option[String] = None` (last param) to `ClaudeToolRequest` (D1)
- [x] 1.2 Add `system: Seq[ClaudeApiContentBlock] = Seq.empty` to `ClaudeApiToolRequest` after `maxTokens` (D2)
- [x] 1.3 Emit top-level `system` only when non-empty via one helper in `claudeApiToolRequestFormat` (D3)
- [x] 1.4 Map `request.system` to a cache-marked text block as the first named arg in `toApiToolRequest` (D4)
- [x] 1.5 Count the system prompt in `guardrailRejectTool` on every hop (D5)

## 2. Assistant service

- [x] 2.1 Pass `system = Some(AssistantSystemPrompt.text)` on every `converse` call (D6)
- [x] 2.2 Stop folding the prompt in `seedHistory`; remove `desanitizeFirstTurn` and its call sites; update scaladoc in AssistantService, AssistantSystemPrompt.scala:21-24 and ClaudeToolRequest (D6)
- [x] 2.3 Re-verify every assistant-transcript writer never stored the prompt; record in evidence/legacy-transcripts.md (D7)

### Tests

## 3. Tests and evidence

- [x] 3.1 AssistantServiceSpec: turn-2 serialized body carries `system` equal to turn 1's; no message (search the whole serialized `messages` JSON, any block type) or returned turn contains the prompt; legacy history case (D8)
- [x] 3.2 AssistantConversationRoutesSpec seam: two POSTs, second wire body has `system`, persisted transcript has no prompt (D8)
- [x] 3.3 ClaudeProtocolSpec/ClaudeClientSpec: absent = no `system` key; system marker; same `system` on every hop; guardrail counts it: messages alone under the limit, messages+system over it (D8)
- [x] 3.4 Update existing tests that asserted the fold/desanitize behaviour (do not weaken unrelated assertions)
- [x] 3.5 Red-first: run 3.1/3.2 against unfixed main code, record failing output in evidence/red-first.md
- [x] 3.6 Run backend gates (sbt testFull for touched specs at least, then full; read the summary) and the pre-commit hook
