## Standing Constraints

- [C1] Root cause is confirmed ONLY by the D2 shifted-real-clock probe (real elapsed time crossing UTC midnight through the production date expression, two usage_date rows one day apart); a clock-jump fake is illustration only. Loop iterations are judged by log grep, never exit code; a zero-test iteration is not green.
- [C2] Do not edit any `EmbeddedPostgres` startup line (HEL-1445 owns them); probe and mutation edits are temporary and never committed.
- [C3] Production behaviour is unchanged: the repository's default clock is `SystemClock`; `ApiRoutes` is not edited.
- [C4] Every today/yesterday in a pinned spec derives from the pinned clock; `grep -n LocalDate.now` over the four pinned specs returns zero hits.

### Backend

## 1. Seam

- [x] 1.1 Add `clock: Clock = SystemClock` to `AssistantDailyUsageRepository`, derive today via `LocalDate.ofInstant(clock.now(), ZoneOffset.UTC)`, update doc comment; verify compile and the existing repo spec passes unchanged

### Tests

## 2. Probe (root cause)

- [x] 2.1 D2 probe in ClaudeRoutesChatGateSpec cap test (temp, shifted real clock aimed at midnight, <=6 attempts): read-backs use the shifted clock; RED only if the expected-429 call returns 200/201; capture it, per-call shifted instants, two usage_date rows; save transcript to run evidence dir
- [x] 2.2 Same D2 probe in AssistantConversationRoutesSpec cap test; save transcript

## 3. Fix

- [x] 3.1 Pin a mid-day clock in ClaudeRoutesChatGateSpec and AssistantConversationRoutesSpec; read-back helpers use the pinned date; add the usage_date == pinned-date wiring guard; verify both specs green
- [x] 3.2 D3 mutation: drop the pin temporarily, observe the wiring guard red, revert; save transcript
- [x] 3.3 D4 sweep: classify every test constructor of the repo; pin the sensitive ones (expected AssistantDailyUsageRepositorySpec incl. "yesterday" test, AiPipelineQuotaGateSpec); record all with reasons in files-modified.md
- [x] 3.3a Every today/yesterday in pinned specs from the pinned clock (incl. AssistantDailyUsageRepositorySpec RLS tests ~l.196/210/221); `grep -n LocalDate.now` over the four pinned specs = zero hits, pasted into files-modified.md
- [x] 3.4 Confirm per-spec isolation under the shared pinned instant (fresh users or TRUNCATE); record it
- [x] 3.5 Loop proof: 20 iterations of all changed specs per D5, judged by log incl. `[hel1468-guard] ... failed=0 aborted=0`; save log summary
