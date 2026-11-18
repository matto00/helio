## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: c7d9c925556da7a3cec04aadadc611decccce242 (base c03fc0a4ad97b1dd17000c0fa2a543e37b57cce5, resolved live with resolve-review-base.sh).
Evaluator logs: `.concertino/scratch/HEL-1761/eval-*.log`.

### Phase 1: Spec Review — PASS
- AC1: the fake-transport thinking-only `max_tokens` hop is red in the executor's recorded run (`Left(Failed(BadGateway(...max_tokens)))`, and `502` at the route). It is now `Left(AskError.Truncated)`, and `422 ASK_ANSWER_TRUNCATED` at the route. Met.
- AC2: a partial-text `max_tokens` hop maps to `Truncated` before validation, on the first hop and on the corrective hop (`AskDataService.scala:60,71`). The route test asserts that the cut-off text is absent from the wire. Met.
- AC3: the cap is 4096 (`AskDataService.MaxAnswerTokens`). design.md D1 gives the sizing rationale and D4 gives the measurement position: not measured, no live call. Met.
- AC4: `422 ASK_UNGROUNDED` reasons go through `AskReasons.publicOf`. The route test proves there is no digit, and no `99` or `2026-11-30` anywhere in the body. Met.
- AC5: the pin tests cover a distinct root id, the no-step and no-root fallback, and a create round trip. Each is red under its own mutation (mut-m5a/m5b logs). Met.
- Tasks match the diff. There is no scope creep, and no schema change is needed (`schemas/ask/` covers only the request and the 200 response). The spec delta and the CLAUDE.md line match the behaviour.
- CONSTRAINTS C1–C15 are honoured. No .env access appears in the diff or the logs, no live calls were made (ScriptedTransport only), and scratch stays in `.concertino/scratch/HEL-1761/`.

### Phase 2: Code Review — FAIL
Gates (fresh, in WORKTREE_PATH; backend-only change):
- `nice -n 19 sbt -J-Xmx3g testFull`: hel1468 summary `failed=0 aborted=0 unreadable=0`; 725 suites, 9892 succeeded, 0 failed, 5 canceled.
- `testOnly com.helio.services.ask.* com.helio.api.routes.ask.* com.helio.infrastructure.ai.* com.helio.services.assistant.AssistantServiceSpec`: 17 suites (including AskDataServiceSpec, AskRoutesSpec, AskCitationLedgerSpec, ClaudeClientSpec, AssistantServiceSpec), 196 succeeded, 0 failed. This matches the executor's claimed 196.
- `node scripts/check-scala-quality.mjs`: exit 0. No inline-FQN violations. Its file-size note lists AskDataServiceSpec.scala at 388 lines, which is informational.

Independent mutations (each reverted with `git checkout`; worktree clean afterwards):
- M-A: delete the corrective-hop truncation case (`AskDataService.scala:71`). AskDataServiceSpec "map a max_tokens corrective hop to Truncated" FAILED (23/1). The guard holds. (eval-mut-corrective.log)
- M-B: collapse `AskReasons.publicOf`'s category lookup to the generic `Unchecked` phrase for every reason. **Every ask test stays green (44 succeeded, 0 failed).** (eval-mut-categories.log)

Issue (blocking):
1. The value-free reason categories in `backend/src/main/scala/com/helio/services/ask/AskReasons.scala:10-18` are never asserted. The only test, AskRoutesSpec "return value-free ASK_UNGROUNDED reasons", checks only that no reason has a digit. Mutation M-B, which turns every reason into "the answer could not be checked against the data", survives. That breaks the spec requirement that `reasons` "SHALL name only the kind of each failure", and the design D5 mapping. It also means that a wording change in `InsightValidator` (the `numeral `, `date `, `citation marker `, `the text has ` prefixes) would silently degrade every public reason to the generic phrase. C12 requires a guard that a mutation can turn red, and this one cannot be turned red.

Everything else is clean:
- `FinalResponse.stopReason` is added in the second parameter list, so no extractor changes, and AssistantServiceSpec is green.
- `pause_turn` keeps its 502 mapping.
- The WARN lines carry no answer text.
- The response type is small and explicit.
- No dead code.

### Phase 3: UI Review — N/A
Backend-only change. No files match `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: FAIL

### Change Requests
1. Add assertions that pin the public category phrases. Either:
   - (a) add a small `AskReasonsSpec` in `backend/src/test/scala/com/helio/services/ask/`. Feed it the literal `InsightValidator` reason strings: `the text is empty`, `numeral '99' does not match ...`, `date '2026-11-30' does not match ...`, `citation marker [c12] is not in the pack`, `the text has 1300 characters, more than 1200`, `the text has 7 sentences, more than 6`, the tool-call budget reason and an unknown string. Assert each exact output phrase, plus dedupe. Or:
   - (b) extend the AskRoutesSpec reasons test so it asserts that `reasons` contains `"a number is not backed by a cited value"` and `"a date is not backed by a cited date"`.

   Option (a) is preferred, because only real `InsightValidator` output exercises the prefix coupling. Strongest is to produce the inputs by calling `InsightValidator.validate` on an ungrounded text rather than hand-typing them. Then record mutation M-B (collapse to `Unchecked`) turning the new test red in `red-evidence.md`.

### Non-blocking Suggestions
- `AskDataService.truncated` logs inside a pattern guard, which gives a guard a side effect. It works, because the guard is evaluated once per match. A plain `if` inside the `FinalResponse` case would read more directly.
- `AskReasons.publicOf`'s `.filterNot(_.isDigit)` runs over fixed digit-free phrases, so it only matters if a future phrase gains a digit. That is fine as a backstop, as design D5 intended.
- AskDataServiceSpec.scala is now 388 lines, close to the ~400 split threshold in CONTRIBUTING.md. The two HEL-1761 blocks are good candidates for a separate spec if it grows.
