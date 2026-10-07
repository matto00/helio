## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `0726c92d8dfe28af8ba81b601324899892006303`. Live-resolved base: `9415a44eca125f5bee25bdd4878911d39b6ecc37` (origin/main).
Commits: d0cbe62a5 (fix), 84ad6eb37 (merge main), 47ea843cb (quiet-host remeasure), 0726c92d8 (merge main).

Owner rulings checked in `.concertino/runs/HEL-1298/events.jsonl`: line 21 `remeasure-on-quiet-host`
(HEL-1298-1791268232005-451d3f), line 27 `accept-and-waive-27s` (HEL-1298-1791334299309-2c65fc), both `answer_source: human`.
Per those rulings, the D3 "max <= 27s" bar for hel910 is waived and is NOT a ground for FAIL here.

### Phase 1: Spec Review — FAIL

Passing items:
- AC1 (probe-confirmed root cause, contended failure rate): hel519 is D2 branch A (test defect), 9/9 failing probe
  attempts classified, flipped both ways at 8x (9/20 red -> 0/20 red). hel910 is cumulative boot/render cost against the
  30s budget, no single stalled step, flipped at quiet-host 8x (unfixed 18/20 red -> fixed 20/20 green). Rates are recorded
  as k/n with n >= 20. Reproducing configs meet C7 (hel519 6x: 10/30 = 33%; hel910 quiet 8x: 18/20 = 90%).
- AC2 (fix the real cause, web-first waits, no longer timeout): hel519 adds `expect(heading).toBeVisible()` after
  `waitForURL` at 3 sites. That is a web-first wait on the committed route, and the same wait already exists in the file's
  `root-landing` test (`e2e/hel519-recent-navigation.spec.ts:259`). hel910 drops the UI login in favor of a
  `page.request` API session and seeds before the first page load. There is no `setTimeout`/`test.slow`.
- AC3 / C4 (no quarantine, no loosened assertions): no assertion was removed or weakened. The io count is still 28 and
  `toBeLessThanOrEqual(30)` is unchanged; my own run printed "28 interactions". The removed `page.waitForURL("/")` was a
  setup step for the deleted UI login, not an assertion of the scenario.
- AC5 / C3: `git diff 9415a44ec HEAD -- playwright.config.ts .github/workflows/ci.yml` is empty.
- C6 scope: the only code changes are the two spec files. Everything else is under `openspec/changes/e2e-contention-robustness/`.
- C5: dev-DB residue is recorded by exact id/email in the persisted `dev-db-residue.txt`, and nothing was deleted.
- D4 HEL-1289 verdicts are recorded per file with probe evidence.
- hel910 greens (f8, 20/20) ran on a hel910 spec byte-identical to HEAD: `git diff d0cbe62a5 HEAD -- e2e/hel910-...` is empty.

Issues:
1. **Task 4.1 is still unchecked, and the evidence does not record the owner waiver.**
   - `tasks.md` 4.1 reads `- [ ] 4.1 (... max 28.0s > 27s -- escalated again)`.
   - `root-cause-evidence.md` still says "D3 robustness criterion ... is NOT met ... Escalated, not delivered as done". It
     does not mention the `accept-and-waive-27s` ruling. It also lists hel910's reproducing config as "5x + 3 burners"
     (loaded host) in the D1 section, while the greens that count are quiet-host 8x.
   - As a result the planning artifacts do not reflect the final delivered state. A reader of the PR evidence cannot tell
     whether hel910 was delivered or abandoned.
2. **C8 (binding): the hel519 greens predate an edit to the committed spec.**
   - The 25/25 hel519 greens at 6x were run against the spec as of d0cbe62a5.
   - Merge 0726c92d8 then added 6 lines to `e2e/hel519-recent-navigation.spec.ts`: HEL-1288's
     `test.describe.configure({ mode: "parallel" })` header (`git diff d0cbe62a5 HEAD -- e2e/hel519-recent-navigation.spec.ts`).
   - C8 says "any later spec edit invalidates prior greens", and it has no exception for upstream edits.
   - The header very likely makes no difference to a single `-g`-selected test run with `--repeat-each`. Still, the CI
     failure this ticket targets ran under that header, and the constraint requires a re-run, not an argument.
   - The 6x reproducing config was also calibrated on a host at load 10-17. On the now-quiet host (load 0.43 at review
     time) 6x may no longer reproduce. hel910 showed exactly this: 5x went 14/20 red loaded and 0/20 red quiet.

### Phase 2: Code Review — PASS

I re-ran the gates myself on this worktree at HEAD 0726c92d8. The changed files are only `e2e/**` and `openspec/changes/**`,
so neither the `frontend/**` nor the `backend/**` gate trigger matches. I ran the checks that apply to these files:
- `npx eslint --max-warnings=0` on both specs: exit 0.
- `npx prettier --check` on both specs and the change dir: clean.
- `tsc --noEmit -p e2e/tsconfig.json` (`check:e2e-types`): exit 0.
- `check:no-credential-leak`: 0 violations across 8705 files.
- `check:openspec`: clean.
- `check:repo-integrity`: exit 0.
- Both full spec files, uncontended, against this worktree's own servers:
  - Command: `DEV_PORT=6730 BACKEND_PORT=9637 nice -n 19 npx playwright test <both files> -g "HEL-" --workers=2`
  - Server cwd verified: vite 3635030 and java 3634736 both have cwd = this worktree.
  - Result: 10/10 passed (26.0s). hel910 full-flow took 7.6s with 28 interactions; hel519 tests took 2.5-6.1s.

Checklist:
- CONTRIBUTING comment standard: the new comments explain a hazard (`waitForURL` vs route commit, post-commit
  effect) and a why (API session rationale). Compliant.
- Type safety: removing the `APIRequestContext` import is correct now that it has no use in hel910.
- Behavior-preserving: the scenario steps, io-counted clicks and assertions are unchanged.

Issues: none blocking.

### Phase 3: UI Review — N/A

No changed file matches `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. The only changes are e2e
specs and change-dir artifacts.

### Overall: FAIL

### Change Requests
1. Make the artifacts match the delivered state:
   - In `openspec/changes/e2e-contention-robustness/tasks.md`, tick 4.1 and replace "escalated again" with the owner
     ruling: `accept-and-waive-27s`, escalation `HEL-1298-1791334299309-2c65fc`, with the f8 numbers 20/20 at 8x,
     max 28.0 / p50 27.2.
   - In `root-cause-evidence.md`, add a short "Owner rulings" block citing both escalation ids and answers.
   - In the same file, mark the loaded-host hel910 config (5x) and the "Escalated, not delivered as done" sentence as
     superseded by the quiet-host 8x remeasure and the waiver. Do not delete the batch A 21/25 result, which is honest
     history; label it.
2. Satisfy C8 for hel519 on the merged spec:
   - Regenerate the untracked throttle copy from the current committed `e2e/hel519-recent-navigation.spec.ts` (with the
     HEL-1288 header) and record the hook-only diff.
   - Re-confirm on the current host that the chosen config still reproduces: the unfixed copy (`git show d0cbe62a5~1:...`
     + hook + the same header) must go >= 14% red over >= 20 attempts (C7). If 6x no longer does on the quiet host, climb
     the ladder as was done for hel910.
   - Then record >= 20 consecutive fixed greens for "visiting a source from its list records it under Recent" under that
     config: command, burner PIDs, rate, durations, max/p95.
   - Record the new dev-DB user ids (C5).
   - The alternative is an explicit orchestrator/owner ruling that this upstream header edit does not invalidate the
     greens, recorded in the evidence. Without one of the two, C8 is unmet.

### Non-blocking Suggestions
- The same 4-line comment and heading wait is pasted at three sites (`e2e/hel519-recent-navigation.spec.ts:97-100`,
  `:182-185`, `:224-227`). A small file-local helper such as `visitSourceFromList(page, source)` would remove the repetition.
  This is optional, and it would also trigger C8 again.
- The escalation options offered "accept-waive-27s-bar-with-product-followup", but the recorded answer is
  "accept-and-waive-27s". Confirm with the driver whether the product follow-up should be filed: pipeline-detail boot
  cost, 7 parallel calls, and the duplicate `run-history` GET noted in root-cause-evidence.md.
- Before PR, the design's confirmatory CI run (Risks section) is still outstanding. Note that C2 allows only one CI run at a time.

### Evaluator dev-DB residue (C5): users created by my uncontended run (10, exact; none deleted)
- 4ebc4f62-fd32-4216-84a4-c360ab70400e hel519-pipeline-url-1791340236725-98388@example.test
- 137689ac-4790-44d2-a0ab-7462d094ac7f hel519-source-list-1791340236727-95333@example.test
- dd721b76-6156-4956-a023-99de2e3d084c hel519-pipeline-bf-1791340240520-16157@example.test
- 5f9a9ce2-f06c-4420-aaed-8ba2fb0ae8ce hel519-dashboard-reload-1791340241146-31606@example.test
- 4c3827eb-d702-4969-9c59-3da13beb5ea1 hel519-persist-1791340245361-72043@example.test
- 5e0c445e-49ee-49eb-a11d-55d691b71ef5 hel519-fresh-1791340246599-58791@example.test
- 8cf13055-861b-44ac-a262-97669efb1bfb hel519-typing-1791340249065-76999@example.test
- cb7ce83e-ccfa-4bfc-a491-81c6e243db52 hel519-root-landing-1791340251488-74395@example.test
- 2eca8400-0a36-4cb5-8990-4c0ee0590234 hel910-full-flow-1791340251908-47279@example.com
- 5f8a7f42-227d-4ae6-81a0-4dea022e2156 hel910-existing-output-1791340259509-91263@example.com

Run log: scratchpad `full-uncontended.log` (all passed; no failing-run logs to retain). No load processes were started,
servers were not stopped, nothing was pushed and no CI was triggered.
