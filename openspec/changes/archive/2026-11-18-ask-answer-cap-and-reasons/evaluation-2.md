## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: f3a35089a041081a34efaffc111004d134739d2b (cycle-1 HEAD c7d9c9255; base c03fc0a4a).
The cycle-2 delta is f3a35089a: a new `AskReasonsSpec`, the WARN moved out of the pattern guard in `AskDataService`, and artifact updates.
Logs are in `.concertino/scratch/HEL-1761/eval2-*.log`.

### Phase 1: Spec Review — PASS
- Cycle-1 change request 1 is resolved. `AskReasonsSpec` drives `AskReasons.publicOf` with real `InsightValidator.validate` output. It asserts the exact phrase for each category: empty, numeral, date, citation marker, length and sentence count. It also asserts dedupe and distinct kinds, the budget reason, the generic fallback for an unknown reason, and that no output contains a digit. The test therefore now enforces the spec clause "name only the kind of each failure".
- `red-evidence.md` records the M-B mutation.
- AC1–AC5 stay met. The diff since cycle 1 has no scope creep.
- CONSTRAINTS C1–C15 are honoured. The work used fakes only, and scratch stays under `.concertino/scratch/HEL-1761/`.

### Phase 2: Code Review — PASS
Gates, run fresh in WORKTREE_PATH:
- `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.services.ask.* com.helio.api.routes.ask.* com.helio.infrastructure.ai.* com.helio.services.assistant.AssistantServiceSpec"`.
  - The hel1468 summary reads `failed=0 aborted=0 unreadable=0`: 18 suites, 200 succeeded, 0 failed.
  - The run includes AskCitationLedgerSpec, AskReasonsSpec, AskDataServiceSpec, AskRoutesSpec, every ai spec and AssistantServiceSpec.
- `node scripts/check-scala-quality.mjs`: exit 0.
- Full `sbt testFull`: green in cycle 1 at c7d9c9255 (725 suites, 9892 succeeded, 0 failed). I did not re-run it in this cycle. The cycle-2 production change is limited to private code in `AskDataService`, which only the ask specs exercise, and they all ran green above.

Independent mutation:
- M-B collapses `AskReasons.publicOf`'s category lookup to `Unchecked` for every reason. Under it, AskReasonsSpec turned red with 3 failures: "name the kind of each validator failure", "deduplicate repeated kinds" and "map the budget reason". This mutation survived in cycle 1, and the guard now holds. I reverted the mutation with `git checkout`, and the worktree is clean.

Refactor:
- The pattern guards are now pure (`stopReason.contains("max_tokens")`).
- `truncatedPartial()` logs the WARN once, with no answer text, and returns `Truncated`.
- Behaviour is unchanged: the truncation tests are still green.

Issues: none.

### Phase 3: UI Review — N/A
This is a backend-only change. No files match the UI triggers.

### Overall: PASS

### Non-blocking Suggestions
- The string "the tool-call budget was reached before an answer" is typed in two places: `AskDataService.scala:59` and `AskReasonsSpec`. A shared constant (for example `AskReasons.BudgetReached`) would keep the two in sync.
- AskDataServiceSpec.scala is about 388 lines, near the ~400-line split threshold in CONTRIBUTING.md.
